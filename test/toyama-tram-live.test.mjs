import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTramLiveHandler} from '../toyama-tram-live.mjs';

// Small full feed for 2026-11-28 with trip T, an unrelated trip and a prior-service-date trip.
const feed = Buffer.from('CgsKAzIuMBj7garYBhImCgFUIiEKDQoBVBoIMjAyNjExMjgSCg0UrhJCFVI4CUMo84Gq2AYSJgoBVSIhCg0KAVUaCDIwMjYxMTI4EgoNFK4SQhVSOAlDKPOBqtgGEiYKAVQiIQoNCgFUGggyMDI2MTEyNxIKDRSuEkIVUjgJQyjzgarYBg==', 'base64');
const epoch = Date.parse('2026-11-28T07:21:31Z');
const service = {
  startDate: '2026-11-27', endDate: '2026-11-28', dayTypes: [0, 1],
  timetables: [[], [{id:'T', times:['16:20:00', '16:21:00', '16:22:00']}]],
  stops: [], shape: [], sources: {},
};

test('live snapshots use the JST service day, filter unrelated observations, and coalesce requests', async () => {
  let calls = 0;
  let clock = epoch;
  const handler = createTramLiveHandler({
    loadSchedule: () => service,
    now: () => clock,
    fetchImpl: async (url, opts) => {
      assert.equal(url, 'https://gtfs-rt-files.buscatch.jp/toyama/chitetsu_tram/VehiclePositions.pb');
      assert.equal(opts.redirect, 'error');
      calls++;
      return new Response(feed);
    },
  });
  const [first, second] = await Promise.all([handler(), handler()]);
  const data = await first.json();
  assert.equal(first.status, 200);
  assert.deepEqual(data, await second.json());
  assert.equal(calls, 1);
  assert.equal(data.serviceDate, '2026-11-28');
  assert.equal(data.observations.length, 1);
  assert.equal(data.observations[0].tripId, 'T');
  assert.ok(Math.abs(data.observations[0].lat - 36.67) < .0001);
  assert.equal(data.observations[0].timestamp, epoch / 1000 - 8);
  clock += 16_000;
  await handler();
  assert.equal(calls, 2);
});

test('stale, malformed and out-of-calendar feeds return a recoverable unavailable response', async () => {
  const badInputs = [
    {clock: epoch + 3600_000}, {bytes: feed.subarray(0, 15)},
    {schedule: {...service, endDate: '2026-11-27'}},
  ];
  for (const {clock = epoch, bytes = feed, schedule = service} of badInputs) {
    const handler = createTramLiveHandler({
      loadSchedule: () => schedule, now: () => clock, fetchImpl: async () => new Response(bytes),
    });
    const result = await handler();
    assert.equal(result.status, 503);
    assert.ok((await result.json()).error);
  }
});
