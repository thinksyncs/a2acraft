import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmbientMeetings} from '../public/village-ambient.js';

const actor = (conversationId, x, y) => ({conversationId, name:conversationId, x, y});
const leader = {...actor('リーダー', 30, 40), isLeader:true};
const scout = actor('探検家', 40, 40);
const baker = actor('パン屋', 70, 40);
const viewport = {left:0, right:200, top:0, bottom:200};
const ask = 'りんごを使うパンの材料は？';
const reply = '生地には小麦粉を使います。';
const chat = {id:'パン屋', title:'果物パン', messages:[
  {role:'user', text:ask}, {role:'assistant', text:reply},
  {role:'assistant', text:'<external_codex_apps_selected_page_part_1_of_1>secret</external_codex_apps_selected_page_part_1_of_1>'},
]};
const scene = {party:{members:[leader, scout]}, residents:[leader, scout, baker], viewport, time:4_000};

test('only an accompanying party member speaks to a nearby visible outsider, quoting their saved exchange', () => {
  const lookup = [];
  const update = createAmbientMeetings(id => {lookup.push(id); return structuredClone(chat);});
  const result = update(scene);
  assert.deepEqual(lookup, ['パン屋']);
  assert.equal(result.companionName, '探検家');
  assert.equal(result.residentName, 'パン屋');
  assert.match(result.question, /果物パン/);
  assert.match(result.answer, /返答.*生地には小麦粉/);
  assert.doesNotMatch(result.answer, /secret/);
  const other = createAmbientMeetings(() => chat);
  assert.equal(other({...scene, residents:[leader, scout, {...baker, x:180}]}), null);
  assert.equal(other({...scene, time:6_000, viewport:{...viewport, right:60}}), null);
  assert.equal(other({...scene, time:10_000, party:{members:[leader]}}), null);
});

test('manual conversation or paused animation hides the exchange immediately and prevents a replay burst', () => {
  const update = createAmbientMeetings(() => chat);
  assert.ok(update(scene));
  assert.equal(update({...scene, blocked:true, time:4_001}), null);
  assert.equal(update({...scene, time:5_000}), null);
  assert.equal(update({...scene, time:35_000}), null);
  assert.ok(update({...scene, time:80_000}));
  assert.equal(update({...scene, time:80_002, residents:[{...baker,x:170,y:190}]}), null);
});

test('a pass without a usable saved turn produces no dialogue', () => {
  const update = createAmbientMeetings(() => ({...chat, messages:[]}));
  assert.equal(update(scene), null);
});
