"use strict";
import {test} from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {clockSeconds, scenarioTimes, lineGeometry, movement, latestObservation} from "../public/toyama-tram/model.js";
const replay = JSON.parse(readFileSync(new URL("../public/toyama-tram/data/replay.json", import.meta.url)));
const trip = replay.trips.find(t => t.id === replay.replayTripId);
const scheduled = trip.times.map(clockSeconds);
const geometry = lineGeometry(replay.stops, replay.shape);

test("the delayed slower tram reaches each stop along the real shape", () => {
  const modified = scenarioTimes(scheduled, 600, 2);
  assert.equal(modified[0], scheduled[0] + 600);
  assert.equal(modified.at(-1), scheduled[0] + 600 + 2*(scheduled.at(-1)-scheduled[0]));
  assert.equal(movement(scheduled[0],modified,geometry.offsets).phase, "waiting");
  for (let i=0; i<3; i++) {
    const state = movement(modified[i],modified,geometry.offsets);
    assert.equal(state.offset, geometry.offsets[i]);
    const [x,y] = geometry.at(state.offset);
    const [sx,sy] = geometry.meterPoint(replay.stops[i].lat,replay.stops[i].lon);
    assert.ok(Math.hypot(x-sx,y-sy)<5);
  }
  assert.equal(movement(modified.at(-1),modified,geometry.offsets).phase, "arrived");
});
test("samples remain tied to their trip and cannot appear before the measurement", () => {
  const sample = replay.observations[0];
  assert.equal(latestObservation(replay.observations,trip.id,sample.timestamp-1), null);
  assert.deepEqual(latestObservation(replay.observations,trip.id,sample.timestamp), sample);
  assert.equal(latestObservation(replay.observations,"unknown",sample.timestamp+5000), null);
});
test("the route ends have bounded distance and GTFS next-day hours are preserved", () => {
  assert.equal(clockSeconds("25:30:00"),91800);
  assert.ok(geometry.nearest(geometry.meterPoint(36.71,137.25)).distance > 3000);
  assert.ok(geometry.offsets[0]<geometry.offsets[1] && geometry.offsets[1]<geometry.offsets[2]);
});
