import { COLORS, FRESH_MS, STALE_MS } from "./config.js";

export const DEMO_LINES = [
  { id: "A", mode: "metro", destination: "Perrache", color: "#f5a82e", points: [[4.8085,45.7679],[4.8162,45.7672],[4.8315,45.7632],[4.8357,45.7578],[4.8418,45.7562],[4.8521,45.7528],[4.8641,45.7584]] },
  { id: "B", mode: "metro", destination: "Saint-Genis-Laval", color: "#388fd0", points: [[4.858,45.782],[4.8535,45.768],[4.850,45.760],[4.843,45.751],[4.839,45.741],[4.830,45.729],[4.820,45.713]] },
  { id: "D", mode: "metro", destination: "Gare de Vénissieux", color: "#60be71", points: [[4.808,45.778],[4.814,45.771],[4.827,45.762],[4.8357,45.7578],[4.848,45.750],[4.866,45.741],[4.880,45.732]] },
  { id: "T1", mode: "tram", destination: "Debourg", color: "#a9f16d", points: [[4.860,45.785],[4.857,45.778],[4.853,45.771],[4.848,45.762],[4.838,45.755],[4.827,45.748],[4.825,45.741],[4.831,45.730]] },
  { id: "T2", mode: "tram", destination: "Saint-Priest", color: "#ba8cff", points: [[4.824,45.749],[4.835,45.751],[4.847,45.751],[4.863,45.746],[4.879,45.743],[4.899,45.740]] },
  { id: "T4", mode: "tram", destination: "La Doua", color: "#ff8dbe", points: [[4.857,45.783],[4.853,45.772],[4.850,45.760],[4.858,45.748],[4.866,45.738],[4.875,45.728]] },
  { id: "C3", mode: "bus", destination: "Vaulx-en-Velin", color: "#ffbf69", points: [[4.821,45.758],[4.830,45.761],[4.842,45.767],[4.857,45.771],[4.868,45.774],[4.892,45.776]] },
  { id: "C10", mode: "bus", destination: "Bellecour", color: "#ffc06e", points: [[4.798,45.693],[4.812,45.718],[4.821,45.736],[4.831,45.748],[4.833,45.757]] },
  { id: "C1", mode: "bus", destination: "Cité Internationale", color: "#ffc06e", points: [[4.824,45.757],[4.835,45.762],[4.845,45.769],[4.859,45.783],[4.865,45.787]] },
  { id: "F1", mode: "funicular", destination: "Saint-Just", color: "#72e8e0", points: [[4.825,45.761],[4.816,45.758],[4.807,45.757]] }
];

function project(p) {
  const latitude = p[1] * Math.PI / 180;
  return [p[0] * 111320 * Math.cos(latitude), p[1] * 111320];
}
export function distance(a, b) {
  const x = project(a), y = project(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1]);
}
export function interpolate(a, b, amount) {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
}
export function routePosition(points, progress) {
  if (!points || points.length < 2) return { lng: 4.8357, lat: 45.7578, bearing: 0 };
  const segments = points.slice(1).map((p, i) => distance(points[i], p));
  const length = segments.reduce((a, b) => a + b, 0) || 1;
  let left = ((progress % 1) + 1) % 1 * length;
  for (let i = 0; i < segments.length; i++) {
    if (left <= segments[i] || i === segments.length - 1) {
      const f = Math.min(1, left / (segments[i] || 1));
      const p = interpolate(points[i], points[i + 1], f);
      const deltaLng = (points[i + 1][0] - points[i][0]) * Math.cos(p[1] * Math.PI / 180);
      const deltaLat = points[i + 1][1] - points[i][1];
      const bearing = (Math.atan2(deltaLng, deltaLat) * 180 / Math.PI + 360) % 360;
      return { lng: p[0], lat: p[1], bearing };
    }
    left -= segments[i];
  }
  return { lng: points[0][0], lat: points[0][1], bearing: 0 };
}
const demoDefinitions = DEMO_LINES.flatMap((line, ix) =>
  Array.from({ length: line.mode === "bus" ? 7 : line.mode === "funicular" ? 2 : 5 }, (_, j) => ({
    id: "demo-" + line.id + "-" + j, line: line.id, mode: line.mode,
    destination: line.destination, color: line.color, offset: j / (line.mode === "funicular" ? 2 : 7) + ix * 0.07,
    reverse: j % 2 === 1, speed: line.mode === "metro" ? 0.0017 : line.mode === "bus" ? 0.00115 : 0.0015,
    points: line.points
  }))
);
export function makeDemoVehicles(time = Date.now()) {
  const t = time / 1000;
  return demoDefinitions.map((v) => {
    const raw = ((t * v.speed / 10 + v.offset) % 2 + 2) % 2;
    const fraction = raw <= 1 ? raw : 2 - raw;
    const pos = routePosition(v.points, v.reverse ? 1 - fraction : fraction);
    return {
      id: v.id, line: v.line, mode: v.mode, destination: v.destination, color: v.color,
      lng: pos.lng, lat: pos.lat, bearing: (pos.bearing + ((v.reverse ? 1 : 0) ^ (raw > 1 ? 1 : 0) ? 180 : 0)) % 360,
      delaySeconds: null, recordedAt: new Date(time).toISOString(),
      source: "demo", quality: "demo", isDemo: true
    };
  });
}
export function parseDelay(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const m = value.match(/^(-)?P(?:([0-9.]+)D)?(?:T(?:([0-9.]+)H)?(?:([0-9.]+)M)?(?:([0-9.]+)S)?)?$/i);
  if (!m) return null;
  const sec = (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0);
  return sec * (m[1] ? -1 : 1);
}
export function getLineName(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "?";
  const pieces = value.split(":").filter(Boolean);
  const end = pieces[pieces.length - 1];
  const candidate = /^(SYTRAL|LOC|TCL)$/i.test(end) && pieces.length > 1 ? pieces[pieces.length - 2] : end;
  return (candidate || "?").replace(/^TCL_?/i, "").replace(/^Line_?/i, "").trim() || "?";
}
export function getMode(line, raw = "") {
  const s = String(line).toUpperCase();
  if (/^(F[12]|FUN)/.test(s)) return "funicular";
  if (/^(T[1-9]|RX|RHON)/.test(s)) return "tram";
  if (/^(M[ABCD]|METRO)/.test(s)) return "metro";
  if (/^[ABCD]$/.test(s) && /metro|subway/i.test(raw)) return "metro";
  if (/^[ABCD]$/.test(s)) return "metro";
  return "bus";
}
export function normalizeVehicle(v) {
  const lng = Number(v.longitude ?? v.lng ?? v.lon ?? v.VehicleLocation?.Longitude);
  const lat = Number(v.latitude ?? v.lat ?? v.VehicleLocation?.Latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < 45 || lat > 46.5 || lng < 3.5 || lng > 6) return null;
  const line = getLineName(v.lineId ?? v.line ?? v.LineRef?.value);
  const mode = getMode(line, String(v.mode || v.dataSource || ""));
  const rawId = v.vehicleId ?? v.id ?? v.VehicleRef?.value;
  const rawDestination = String(v.destinationName ?? v.destination ?? "");
  const destinationRef = String(v.destinationRef ?? (rawDestination.includes("StopArea:") ? rawDestination : ""));
  const destinationId = destinationRef.match(/StopArea:SP:(\d+)/i)?.[1] || null;
  const destination = /ActIV:|StopArea:|:SYTRAL$/i.test(rawDestination) || !rawDestination ? "Direction non renseignée" : rawDestination;
  if (rawId == null) return null;
  const bearingValue = Number(v.bearing ?? v.Bearing);
  return {
    id: String(rawId), line, mode, destination, destinationId,
    lng, lat, bearing: Number.isFinite(bearingValue) ? ((bearingValue % 360) + 360) % 360 : 0,
    color: COLORS[line] || COLORS[mode], delaySeconds: parseDelay(v.delay ?? v.Delay),
    recordedAt: v.recordedAtTime ?? v.recordedAt ?? null,
    source: "siri", quality: "observed", isDemo: false
  };
}
export function normalizePayload(data) {
  if (!data || !Array.isArray(data.vehicles)) throw new Error("Format de positions inattendu");
  const unique = new Map();
  for (const input of data.vehicles) {
    const v = normalizeVehicle(input);
    if (v) {
      const previous = unique.get(v.id);
      if (!previous || (!previous.recordedAt && v.recordedAt) || (v.recordedAt && previous.recordedAt && v.recordedAt > previous.recordedAt)) unique.set(v.id, v);
    }
  }
  return { vehicles: [...unique.values()], status: String(data.apiStatus || "UNKNOWN"), fetchedAt: data.lastFetchTime || new Date().toISOString(), observedAt: data.apiResponseTimestamp || null };
}
export function getQuality(vehicle, now = Date.now()) {
  if (vehicle?.isDemo) return "demo";
  if (!vehicle) return "unknown";
  const age = now - new Date(vehicle.recordedAt || 0).getTime();
  if (!Number.isFinite(age) || age < 0) return "unknown";
  if (age > STALE_MS) return "stale";
  if (age > FRESH_MS) return "estimated";
  return "observed";
}
export function delayLabel(seconds) {
  if (seconds == null) return "Non communiqué";
  const m = Math.round(Math.abs(seconds) / 60);
  if (m === 0) return "À l’heure";
  return seconds > 0 ? "+" + m + " min" : "−" + m + " min";
}
export function formatClock(date) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
export function geojsonForDemo(mode) {
  return { type: "FeatureCollection", features: DEMO_LINES.filter(v => mode === "all" || v.mode === mode).map(v => ({
    type: "Feature", properties: { line: v.id, mode: v.mode, color: v.color, demo: true },
    geometry: { type: "LineString", coordinates: v.points }
  })) };
}
export function lineFromProperties(properties = {}) {
  return getLineName(properties.line || properties.ligne || properties.nom || properties.nom_ligne || properties.code || properties.numligne || properties.code_ligne || properties.ligne_code);
}
export function extractGeoJSON(response) {
  const raw = response?.geojson || response;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Tracés GeoJSON invalides");
  return data;
}
export function safeApiUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("URL HTTPS requise");
  if (url.username || url.password) throw new Error("Ne pas mettre d'identifiants dans l'URL");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
