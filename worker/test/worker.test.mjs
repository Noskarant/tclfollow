import {test} from "node:test";
import assert from "node:assert/strict";
import worker, { durationSeconds, mapActivity, buildSnapshot } from "../src/index.js";
test("decode delay", () => { assert.equal(durationSeconds("PT1M15S"),75); assert.equal(durationSeconds("-PT2M"),-120); });
test("map activity", () => {
  const a = { RecordedAtTime:"2026-11-23T18:00:00Z", MonitoredVehicleJourney:{VehicleRef:{value:"v1"}, LineRef:{value:"C3"}, VehicleLocation:{Latitude:45.75,Longitude:4.84}}};
  assert.equal(mapActivity(a).vehicleId, "v1");
});
test("deduplicate snapshot", () => {
  const j = { VehicleRef:{value:"v1"}, VehicleLocation:{Latitude:45.75, Longitude:4.84}};
  const data = {Siri:{ServiceDelivery:{VehicleMonitoringDelivery:[{VehicleActivity:[{MonitoredVehicleJourney:j},{MonitoredVehicleJourney:j}]}]}}};
  assert.equal(buildSnapshot(data).vehicles.length,1);
});
test("missing secrets explicit, not simulated", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/vehicles"), {});
  assert.equal(response.status,503);
  assert.equal((await response.json()).apiStatus,"CONFIG_REQUIRED");
});
test("unknown URL not found", async () => {
  const response = await worker.fetch(new Request("https://example.com/unknown"), {});
  assert.equal(response.status,404);
});
