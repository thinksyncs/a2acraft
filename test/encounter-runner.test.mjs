import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterRunner } from '../encounter-runner.mjs';

const request = {participants: ['gardener', 'maker'], model: 'test-model', locale: 'en'};
const opening = 'Could we reuse rainwater for our garden?';
const task = {title: 'Compare water tanks', description: 'Return a comparison of three tank designs.', assignee: 'self'};
const reply = (proposed = task) => JSON.stringify({message: 'I could compare the designs.', task: proposed});
const decision = accept => JSON.stringify({message: accept ? 'Yes, that comparison would help.' : 'We have no space for a tank.', accept});
const answers = {opening, reply: reply(), decision: decision(true)};

function gate() {
  const {promise, resolve} = Promise.withResolvers();
  return {promise, resolve};
}

function harness({turn, createTask, write, onIdle, saved = null} = {}) {
  let snapshot = structuredClone(saved), time = 1000;
  const calls = [], tasks = [];
  const runner = new EncounterRunner({
    read: async () => snapshot,
    onIdle,
    write: async state => { await write?.(state); snapshot = structuredClone(state); },
    now: () => time,
    turn: async input => {
      calls.push(input);
      return turn ? turn(input) : {output: answers[input.phase]};
    },
    createTask: async input => {
      tasks.push(input);
      if (createTask) return createTask(input);
      await input.onCreated(input.encounterId);
      return {id: input.encounterId, started: true};
    },
  });
  return {runner, calls, tasks, saved: () => structuredClone(snapshot), advance: ms => { time += ms; }};
}

async function run(h, input = request) {
  await h.runner.start(input);
  await h.runner.task;
  return h.runner.public().encounters[0];
}

test('encounter residents actually receive the previous reply and explicitly agree on the exact assigned task', async () => {
  const h = harness();
  await h.runner.load();
  const record = await run(h);
  assert.deepEqual(h.calls.map(c => [c.conversationId, c.phase]), [['gardener', 'opening'], ['maker', 'reply'], ['gardener', 'decision']]);
  assert.ok(h.calls.every(c => c.model === 'test-model' && c.locale === 'en' && c.encounterId === record.id));
  assert.ok(h.calls[1].prompt.includes(opening));
  assert.ok(h.calls[2].prompt.includes('I could compare the designs.'));
  assert.ok(h.calls[2].prompt.includes(task.description));
  assert.equal(record.turns.length, 3);
  assert.equal(h.tasks.length, 1);
  assert.deepEqual(record.task, {id: record.id, assigneeId: 'maker', title: task.title, description: task.description, status: 'started'});
  assert.equal(record.status, 'completed');
  assert.deepEqual(h.saved().encounters[0], record);
});

test('turning off encounters before the first contact persists across restart', async () => {
  const first = harness();
  await first.runner.load();
  assert.equal(first.runner.public().enabled, true);
  await first.runner.configure(false);
  const restarted = harness({saved: first.saved()});
  await restarted.runner.load();
  assert.equal(restarted.runner.public().enabled, false);
  assert.equal(await run(restarted), undefined);
  assert.equal(restarted.calls.length, 0);
  assert.equal(restarted.tasks.length, 0);
});

test('same-chat overlaps, unanswered proposals and explicit rejections cannot dispatch a task', async () => {
  const noProposal = harness({turn: ({phase}) => phase === 'reply' ? reply(null) : opening});
  await noProposal.runner.configure(true);
  await assert.rejects(noProposal.runner.start({...request, participants: ['maker', 'maker']}));
  assert.equal((await run(noProposal)).status, 'completed');
  assert.equal(noProposal.calls.length, 2);
  assert.equal(noProposal.tasks.length, 0);

  const rejected = harness({turn: ({phase}) => phase === 'decision' ? decision(false) : answers[phase]});
  await rejected.runner.configure(true);
  assert.equal((await run(rejected)).task, null);
  assert.equal(rejected.calls.length, 3);
  assert.equal(rejected.tasks.length, 0);
});

test('malformed structured replies never become executable task requests', async () => {
  for (const invalid of ['not JSON', reply({...task, assignee: 'other-chat'}), reply({...task, mode: 'write'}),
    reply({...task, description: ' '}), reply({...task, title: 'x'.repeat(121)})]) {
    const h = harness({turn: ({phase}) => phase === 'reply' ? invalid : answers[phase]});
    await h.runner.configure(true);
    assert.equal((await run(h)).status, 'failed');
    assert.equal(h.tasks.length, 0);
  }
  const h = harness({turn: ({phase}) => phase === 'decision' ? JSON.stringify({message:'sure', accept:'yes'}) : answers[phase]});
  await h.runner.configure(true);
  assert.equal((await run(h)).status, 'failed');
  assert.equal(h.tasks.length, 0);
});

test('concurrent and reversed reports share one encounter; cooldown survives restart', async () => {
  const h = harness(), reverse = {...request, participants: ['maker', 'gardener']};
  await h.runner.configure(true);
  await Promise.all([h.runner.start(request), h.runner.start(reverse), h.runner.start(request)]);
  await h.runner.task;
  assert.equal(h.tasks.length, 1);
  const restored = harness({saved: h.saved()});
  await restored.runner.load();
  restored.advance(61_000);
  await run(restored, reverse);
  assert.equal(restored.calls.length, 0);
  await run(restored, {...request, participants: ['third', 'gardener']});
  assert.equal(restored.tasks.length, 1);
  restored.advance(30 * 60_000);
  await run(restored, reverse);
  assert.equal(restored.tasks.length, 2);
});

test('disabling stops future turns even when enabled again before an old turn returns', async () => {
  const response = gate(), started = gate();
  const h = harness({turn: ({phase}) => {
    if (phase !== 'opening') throw Error('Unexpected model turn');
    started.resolve(); return response.promise;
  }});
  await h.runner.configure(true);
  await h.runner.start(request);
  const running = h.runner.task;
  await started.promise;
  await h.runner.configure(false);
  await h.runner.configure(true);
  response.resolve(opening);
  await running;
  assert.equal(h.calls.length, 1);
  assert.equal(h.runner.public().encounters[0].status, 'interrupted');
  assert.equal(h.tasks.length, 0);
});

test('a saved task remains visible when execution cannot start; recovery never replays a reserved dispatch', async () => {
  const dispatching = gate(), finish = gate();
  const h = harness({createTask: async input => {
    await input.onCreated(input.encounterId);
    dispatching.resolve(); await finish.promise;
    return {id:input.encounterId, started:false, error:'A quest is already running'};
  }});
  await h.runner.configure(true);
  await h.runner.start(request);
  await dispatching.promise;
  const pending = h.saved();
  assert.equal(pending.encounters[0].status, 'dispatching');
  assert.equal(pending.encounters[0].task.status, 'created');
  const restarted = harness({saved: pending});
  await restarted.runner.load();
  const record = await run(restarted);
  assert.equal(record.status, 'interrupted');
  assert.equal(record.task.id, record.id);
  assert.equal(restarted.calls.length, 0);
  finish.resolve();
  await h.runner.task;
  assert.equal(h.runner.public().encounters[0].status, 'failed');
  assert.equal(h.runner.public().encounters[0].task.status, 'created');
});

test('a failed durable admission performs no model or task work', async () => {
  let fail = false;
  const h = harness({write: () => { if (fail) throw Error('storage unavailable'); }});
  await h.runner.configure(true);
  fail = true;
  await assert.rejects(h.runner.start(request), /storage unavailable/);
  assert.deepEqual(h.runner.public().encounters, []);
  assert.equal(h.calls.length, 0);
  fail = false;
  assert.equal((await run(h)).status, 'completed');
});

test('revoked consent during task creation retains the committed todo and never starts it', async () => {
  const entered = gate(), finish = gate();
  let executions = 0;
  const h = harness({createTask: async request => {
    entered.resolve(); await finish.promise;
    await request.onCreated(request.encounterId);
    executions++;
    return {id:request.encounterId, started:true};
  }});
  await h.runner.configure(true);
  await h.runner.start(request);
  await entered.promise;
  await h.runner.configure(false);
  finish.resolve();
  await h.runner.task;
  assert.equal(executions, 0);
  const [record] = h.runner.public().encounters;
  assert.equal(record.task.status, 'created');
  assert.equal(record.status, 'interrupted');
});

test('a no-task conversation notifies idle after its worker is cleared', async () => {
  const notifications = [];
  const h = harness({
    turn: ({phase}) => phase === 'reply' ? reply(null) : opening,
    onIdle: () => notifications.push({active: h.runner.active, task: h.runner.task}),
  });
  await h.runner.configure(true);
  const record = await run(h);
  assert.equal(record.status, 'completed');
  assert.equal(record.task, null);
  assert.deepEqual(notifications, [{active: false, task: null}]);
});
