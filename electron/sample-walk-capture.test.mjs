import test from 'node:test';
import assert from 'node:assert/strict';
import {createSamplePresentation, recordWalkingFrames, recordResidentMeeting} from './sample-walk-capture.mjs';
import {startupPageURL} from './window-lifecycle.mjs';

const origin = 'http://127.0.0.1:4317';
const sampleURL = origin + '/?desktop=1&demo=1&village=sample&subagents=sample&walk=resident';
function presentationFixture() {
  const state = {url:'about:blank', visible:false, minimized:true, loading:true, closed:false};
  const window = {isVisible:() => state.visible, isMinimized:() => state.minimized, isDestroyed:() => state.closed,
    webContents:{getURL:() => state.url, isDestroyed:() => false, isCrashed:() => false, isLoadingMainFrame:() => state.loading}};
  return {state, window};
}

test('Finder launch can progress from a hidden startup page to a visible sample and recover a later hide', async () => {
  const {window, state} = presentationFixture(), report = {}, shows = [];
  let t = 0;
  const timing = {now:() => t, wait:async ms => {
    t += ms; state.url = t < 500 ? startupPageURL() : sampleURL;
    if (t >= 300) state.visible = true;
    if (t >= 750) state.loading = false;
  }};
  const ensure = createSamplePresentation(window, origin, report, timing,
    () => { shows.push(t); state.minimized = false; });
  await ensure();
  assert.ok(t >= 750);
  assert.deepEqual(report.presentation, {page:'sample', visible:true, minimized:false, loading:false});
  state.visible = false;
  await ensure();
  assert.equal(shows.length, 2);
  state.url = startupPageURL();
  await assert.rejects(ensure(), /navigated/);
});

test('capture readiness refuses the wrong page, origin, missing sample flags or closed window', async () => {
  for (const url of [origin + '/', sampleURL.replace('demo=1','demo=0'), sampleURL.replace('4317','9999'), 'data:text/html,other']) {
    const {state, window} = presentationFixture(), report = {};
    state.url = url;
    await assert.rejects(createSamplePresentation(window, origin, report)(), /navigated/);
    assert.equal(report.presentation.page, 'unexpected');
  }
  const {state, window} = presentationFixture();
  state.closed = true;
  await assert.rejects(createSamplePresentation(window, origin, {})(), /closed/);
});

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

function encounter({wrongReply = false, nearby = false, noMeeting = false} = {}) {
  let time = 0, phase = 'arrival', returnedAt = 0;
  const resident = 'village-demo-4', actions = [], captures = [];
  const timing = {now:() => time, wait:async ms => {time += ms;}};
  async function read(action, id, question) {
    assert.equal(id, resident);
    assert.ok(question);
    if (action !== 'read') actions.push(action);
    if (action === 'return' || action === 'close') returnedAt = time;
    if (action !== 'read') phase = action;
    const visibleChat = ['talk','type','send'].includes(phase);
    const permittedMeeting = !noMeeting && phase === (nearby ? 'close' : 'return') && time - returnedAt >= 3_000;
    return {
      chatId:visibleChat ? id : '', arrived:phase === 'nearby', draft:phase === 'type',
      // An old reply present before the new user message is insufficient.
      sent:phase === 'send' && !wrongReply, reply:phase === 'send' ? '用意しておきましょう。' : '',
      ambient:permittedMeeting ? ['ユアン　次は何を？','スピカ　最新の返答より「雨具を。」'] : [],
    };
  }
  return {actions, captures, run:() => recordResidentMeeting(read, phase => captures.push(phase), resident, timing)};
}

test('records the resident composer, its reply and an ambient exchange following the return to town', async () => {
  const direct = encounter();
  await direct.run();
  assert.deepEqual(direct.actions, ['talk','type','send','return']);
  assert.deepEqual(direct.captures, ['chat-input','chat-reply','ambient']);
  const walkToNeighbor = encounter({nearby:true});
  await walkToNeighbor.run();
  assert.deepEqual(walkToNeighbor.actions, ['talk','type','send','return','nearby','close']);
  assert.deepEqual(walkToNeighbor.captures, direct.captures);
});

test('the recorder fails when no new reply or spontaneous exchange is visible', async () => {
  const stale = encounter({wrongReply:true});
  await assert.rejects(stale.run(), /No completed reply/);
  assert.deepEqual(stale.captures, ['chat-input']);
  const silent = encounter({noMeeting:true});
  await assert.rejects(silent.run(), /No spontaneous companion exchange/);
  assert.deepEqual(silent.captures, ['chat-input','chat-reply']);
});
