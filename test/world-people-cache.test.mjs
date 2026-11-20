import test from 'node:test';
import assert from 'node:assert/strict';
import {peopleMesh} from '../public/world-3d-mesh.js';
import {personMesh} from '../public/world-character-model.js';

const direct = people => {
  const out = [];
  for (const person of people) personMesh(out, {...person,
    gait: Math.round(Math.max(-1, Math.min(1, Number.isFinite(person.gait) ? person.gait : 0)))}, Boolean(person.hero));
  return new Float32Array(out);
};
function sameMesh(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    const tolerance = i % 9 < 3 ? .00004 : .000001;
    assert.ok(Math.abs(actual[i] - expected[i]) < tolerance,
      `attribute ${i}: ${actual[i]} differs from ${expected[i]}`);
  }
}

test('cached poses preserve direct geometry, facing, color and scale at current world positions', () => {
  const people = ['hero', 'mage', 'priest', 'martial-artist'].flatMap((appearance, index) =>
    [-.9, -.3, .2, .8].map((gait, pose) => ({id: `actor-${index}`, seed: 437 + index,
      appearance, kind: index === 3 ? 'subagent' : 'agent', scale: index === 3 ? .58 : 1,
      hero: index === 0, color: '#478cb5', statusColor: '#bfd195', gait,
      x: 70 + pose * 34, y: -85 + index * 21, heading: pose * Math.PI / 5})));
  const before = structuredClone(people);
  sameMesh(peopleMesh(people), direct(people));
  const moved = people.map(person => ({...person, x: person.x + 103, y: person.y - 41, heading: person.heading + .72}));
  sameMesh(peopleMesh(moved), direct(moved));
  assert.deepEqual(people, before);
});

test('changed visual properties invalidate poses while private conversation fields are never read', () => {
  const person = {conversationId: 'stable-visual-person', appearance: {id: 'mage'}, kind: 'agent',
    role: '調査', x: 90, y: 80, heading: .6, gait: .1, color: '#478cb5'};
  for (const field of ['messages', 'text', 'title', 'context', 'history']) Object.defineProperty(person, field,
    {get() {throw new Error('conversation field read');}});
  const original = peopleMesh([person]);
  for (const change of [{color: '#c37549'}, {gait: .9}, {appearance: 'priest'}, {scale: .58},
    {kind: 'subagent', statusColor: '#eed585'}, {seed: 'new-appearance-seed'}]) {
    const changed = {...person, ...change};
    const result = peopleMesh([changed]);
    assert.notDeepEqual(result, original);
    sameMesh(result, direct([changed]));
  }
  assert.deepEqual(peopleMesh([person]), original);
});

test('evicted and reused poses still reproduce their own geometry and output buffers are independent', () => {
  const person = {id: 'returning-person', kind: 'agent', appearance: 'hero', x: 40, y: 90, heading: .3};
  const first = peopleMesh([person]);
  const crowd = Array.from({length: 520}, (_, index) => ({...person, seed: 'cache-pressure-' + index,
    appearance: ['hero', 'mage', 'priest'][index % 3], gait: index % 3 - 1}));
  peopleMesh(crowd);
  const returned = peopleMesh([person]);
  assert.deepEqual(returned, first);
  returned.fill(0);
  assert.deepEqual(peopleMesh([person]), first);
  sameMesh(peopleMesh([{...person, gait: Infinity, heading: NaN, scale: Infinity}]),
    direct([{...person, gait: Infinity, heading: NaN, scale: Infinity}]));
  assert.equal(peopleMesh([]).length, 0);
});
