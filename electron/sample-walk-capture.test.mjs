import test from 'node:test';
import assert from 'node:assert/strict';
import {recordWalkingFrames} from './sample-walk-capture.mjs';

test('a fast compositor records the end of a one-minute walk within the frame budget', async () => {
  let elapsed = 0;
  const frames = [];
  const clock = {now: () => elapsed, wait: async milliseconds => { elapsed += milliseconds; }};
  await recordWalkingFrames(() => ({arrived: elapsed >= 60_000}),
    phase => { frames.push(phase); }, clock);
  assert.equal(frames.at(-1), 'arrival');
  assert.ok(elapsed >= 60_000 && elapsed < 61_000);
  assert.ok(frames.length <= 240);
});
