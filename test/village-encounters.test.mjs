import test from 'node:test';
import assert from 'node:assert/strict';
import {createBumpDetector} from '../public/village-encounters.js';

const actor = (conversationId, x, y = 30) => ({conversationId, x, y});
const view = {left:0, right:200, top:0, bottom:200};

test('distinct chat actors generate a single contact upon entry with separation hysteresis', () => {
  const {sample} = createBumpDetector();
  assert.deepEqual(sample([actor('b',70), actor('a',30)], view), []);
  assert.deepEqual(sample([actor('b',48), actor('a',30)], view), [['a','b']]);
  assert.deepEqual(sample([actor('a',30), actor('b',54)], view), []);
  assert.deepEqual(sample([actor('a',30), actor('b',46)], view), []);
  assert.deepEqual(sample([actor('a',30), actor('b',70)], view), []);
  assert.deepEqual(sample([actor('a',30), actor('b',42)], view), [['a','b']]);
});

test('loading, entering the viewport, resuming and duplicate projections do not generate contacts', () => {
  const {sample,reset} = createBumpDetector();
  const scene = [actor('a',120), actor('a',121), actor('b',120), actor(null,120), actor('invalid',NaN)];
  assert.deepEqual(sample(scene, view), []);
  assert.deepEqual(sample(scene, {...view,right:100}), []);
  assert.deepEqual(sample(scene, view), []);
  reset();
  assert.deepEqual(sample(scene, view), []);
});

test('simultaneous contacts return the closest pair first regardless of actor order', () => {
  for (const reverse of [false,true]) {
    const {sample} = createBumpDetector();
    sample([actor('a',40), actor('b',95), actor('c',150)], view);
    const scene = [actor('a',65), actor('b',80), actor('c',85)];
    assert.deepEqual(sample(reverse ? scene.reverse() : scene, view), [['b','c'],['a','b']]);
  }
});
