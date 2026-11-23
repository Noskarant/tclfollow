import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDelay, routePosition, normalizeVehicle, normalizePayload, getQuality, makeDemoVehicles, safeApiUrl, extractGeoJSON } from "../src/data.js";
test("parse ISO 8601 delay", () => {
  assert.equal(parseDelay("PT2M30S"), 150);
  assert.equal(parseDelay("-PT1M"), -60);
  assert.equal(parseDelay("bad"), null);
});
test("route interpolates", () => {
  const p = routePosition([[4,45],[4.1,45]], .5);
  assert.ok(p.lng > 4.04 && p.lng < 4.06);
});
test("SIRI rejects invalid coordinates", () => {
  assert.equal(normalizeVehicle({ vehicleId:"x", latitude:0, longitude:0 }), null);
  assert.equal(normalizeVehicle({ vehicleId:"x", latitude:45.76, longitude:4.83, lineId:"C3" }).mode, "bus");
});
test("payload deduplicates vehicles", () => {
  const payload = { vehicles:[{vehicleId:"x",latitude:45.76,longitude:4.83,lineId:"C3"},{vehicleId:"x",latitude:45.761,longitude:4.83,lineId:"C3"}],apiStatus:"OK" };
  assert.equal(normalizePayload(payload).vehicles.length,1);
});
test("demo cannot be mistaken for real", () => {
  const demo = makeDemoVehicles(0);
  assert.ok(demo.length > 20);
  assert.ok(demo.every(x => x.isDemo && getQuality(x) === "demo"));
});
test("stale observation", () => {
  assert.equal(getQuality({recordedAt:"2020-01-01T00:00:00Z"}, Date.now()),"stale");
});
test("security of API URL", () => {
  assert.throws(() => safeApiUrl("http://example.com"));
  assert.throws(() => safeApiUrl("https://user:pass@example.com"));
  assert.equal(safeApiUrl("https://example.com/"),"https://example.com");
});
test("geojson parse", () => {
  assert.equal(extractGeoJSON({geojson:'{"type":"FeatureCollection","features":[]}'}).type,"FeatureCollection");
});
