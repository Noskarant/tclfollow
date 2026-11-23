/* TCL Follow / Cloudflare Worker. Only read-only endpoints.
   Official SIRI-Lite VehicleMonitoring upstream. Credentials never reach browsers. */
const API = {
  vehicles: "https://data.grandlyon.com/siri-lite/2.0/vehicle-monitoring.json",
  routes: {
    metro: "https://data.grandlyon.com/fr/geoserv/ogc/features/v1/collections/sytral:tcl_sytral.tcllignemf_2_0_0/items?f=application/geo%2Bjson&crs=EPSG:4326&startIndex=0&sortby=gid",
    tram: "https://data.grandlyon.com/fr/geoserv/ogc/features/v1/collections/sytral:tcl_sytral.tcllignetram_2_0_0/items?f=application/geo%2Bjson&crs=EPSG:4326&startIndex=0&sortby=gid",
    bus: "https://data.grandlyon.com/fr/geoserv/ogc/features/v1/collections/sytral:tcl_sytral.tcllignebus_2_0_0/items?f=application/geo%2Bjson&crs=EPSG:4326&startIndex=0&sortby=gid",
    rhonexpress: "https://data.grandlyon.com/fr/geoserv/ogc/features/v1/collections/sytral:rx_rhonexpress.rxligne_2_0_0/items?f=application/geo%2Bjson&crs=EPSG:4326&startIndex=0&sortby=gid",
    stops: "https://data.grandlyon.com/fr/geoserv/ogc/features/v1/collections/sytral:tcl_sytral.tclarret/items?f=application/geo%2Bjson&crs=EPSG:4326&startIndex=0"
  }
};
const emptyFC = { type: "FeatureCollection", features: [] };
const localCache = new Map();
const ROUTE_TTL = 86400, VEHICLE_TTL = 10;
function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map(x => x.trim());
  const selected = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : "";
  return {
    ...(selected ? { "Access-Control-Allow-Origin": selected } : {}),
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}
function respond(data, request, env, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? "public, max-age=" + maxAge : "no-store", ...cors(request, env) }
  });
}
export function durationSeconds(input) {
  if (typeof input !== "string") return null;
  const m = /^(-)?P(?:([0-9.]+)D)?(?:T(?:([0-9.]+)H)?(?:([0-9.]+)M)?(?:([0-9.]+)S)?)?$/i.exec(input);
  if (!m) return null;
  return (m[1] ? -1 : 1) * ((+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0));
}
export function mapActivity(activity) {
  const j = activity?.MonitoredVehicleJourney;
  if (!j || !j.VehicleLocation) return null;
  const lat = Number(j.VehicleLocation.Latitude), lon = Number(j.VehicleLocation.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !j.VehicleRef?.value) return null;
  return {
    vehicleId: String(j.VehicleRef.value),
    lineId: String(j.LineRef?.value ?? ""),
    direction: j.DirectionRef?.value ?? null,
    latitude: lat, longitude: lon,
    bearing: j.Bearing ?? null, delay: j.Delay ?? null,
    recordedAtTime: activity.RecordedAtTime ?? null,
    destinationName: j.DestinationRef?.value ?? j.DestinationName?.[0]?.value ?? null,
    validUntilTime: activity.ValidUntilTime ?? null,
    dataSource: j.DataSource ?? null
  };
}
export function buildSnapshot(root) {
  const delivery = root?.Siri?.ServiceDelivery;
  const block = delivery?.VehicleMonitoringDelivery;
  const activity = Array.isArray(block) ? block.flatMap(x => Array.isArray(x.VehicleActivity) ? x.VehicleActivity : []) : [];
  if (!Array.isArray(block)) return { vehicles: [], apiResponseTimestamp: null, lastFetchTime: new Date().toISOString(), apiStatus: "INVALID_RESPONSE" };
  const unique = new Map();
  for (const item of activity) {
    const v = mapActivity(item);
    if (!v) continue;
    const old = unique.get(v.vehicleId);
    if (!old || (!old.recordedAtTime && v.recordedAtTime) || (v.recordedAtTime && v.recordedAtTime > old.recordedAtTime)) unique.set(v.vehicleId, v);
  }
  return { vehicles: [...unique.values()], apiResponseTimestamp: delivery.ResponseTimestamp ?? null, lastFetchTime: new Date().toISOString(), apiStatus: "OK" };
}
async function getCached(key, ttl, producer) {
  const now = Date.now();
  const hit = localCache.get(key);
  if (hit && now < hit.expires) return hit.data;
  const data = await producer();
  if (localCache.size > 24) localCache.clear();
  localCache.set(key, { data, expires: now + ttl * 1000 });
  return data;
}
async function retrieve(url, headers = {}) {
  const resp = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error("Amont HTTP " + resp.status);
  return resp.json();
}
function credentials(env) {
  if (!env.GRANDLYON_API_USERNAME || !env.GRANDLYON_API_PASSWORD) return null;
  return "Basic " + btoa(env.GRANDLYON_API_USERNAME + ":" + env.GRANDLYON_API_PASSWORD);
}
export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    if (!["GET", "HEAD"].includes(request.method)) return respond({ error: "Method not allowed" }, request, env, 405);
    if (path === "/healthz") return respond({ ok: true, source: "TCL Follow", configured: Boolean(credentials(env)), time: new Date().toISOString() }, request, env);
    if (path === "/api/vehicles") {
      const auth = credentials(env);
      if (!auth) return respond({ vehicles: [], apiStatus: "CONFIG_REQUIRED", lastFetchTime: new Date().toISOString(), apiResponseTimestamp: null }, request, env, 503);
      try {
        const result = await getCached("vehicles", VEHICLE_TTL, async () => buildSnapshot(await retrieve(API.vehicles, { Authorization: auth })));
        return respond(result, request, env, 200, 5);
      } catch (e) {
        return respond({ vehicles: [], apiStatus: "API_DOWN", apiResponseTimestamp: null, lastFetchTime: new Date().toISOString(), error: "Flux de positions temporairement indisponible" }, request, env, 502);
      }
    }
    const match = /^\/api\/lines\/([a-z]+)$/.exec(path);
    if (match) {
      const mode = match[1], upstream = API.routes[mode];
      if (!upstream) return respond({ status: "NOT_FOUND" }, request, env, 404);
      try {
        const data = await getCached("line-" + mode, ROUTE_TTL, () => retrieve(upstream));
        if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Invalid GeoJSON");
        return respond({ geojson: data, status: "OK" }, request, env, 200, 1800);
      } catch (e) {
        return respond({ geojson: emptyFC, status: "API_DOWN" }, request, env, 502);
      }
    }
    return respond({ error: "Not found" }, request, env, 404);
  }
};
