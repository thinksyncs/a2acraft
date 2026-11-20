import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {buildResidentContext, residentPartyKey} from '../public/resident-companions.js';
import {deliverSend} from '../send-delivery.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
// Execute the actual routes and send/steer functions with in-memory storage
// and a captured RPC boundary. No server, process, model or network is started.
async function fixture({running = false} = {}) {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const section = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return source.slice(first, last);
  };
  const send = section('async function send(c,', '\nlet partyWaiter='),
    steer = section('async function steer(c,', '\nasync function attachContexts');
  const routes = ['/api/send', '/api/steer'].map(route => {
    const line = source.split('\n').find(line => line.startsWith("   if(p==='" + route + "')"));
    assert.ok(line); return line;
  }).join('\n');
  const recipient = {id: 'resident', title: '村人', status: running ? 'running' : 'idle', threadId: 'thread', turnId: running ? 'turn-current' : null, model: 'model', messages: []};
  const companion = {id: 'engineer', title: '実装相談', characterName: 'リナ', messages: [{role: 'user', text: '下書きを保持する'}, {role: 'assistant', text: '起動失敗時も保存を確認'}]};
  const conversations = [recipient, companion, {id: 'other', title: '無関係', messages: [{role: 'user', text: 'UNSELECTED_SECRET'}]}];
  const party = {leaderId: 'engineer', members: [{conversationId: 'engineer', role: '実装と検証'}]};
  const parties = {active: false, currentId: 'none', state: {party}}, calls = [], saves = [], released = [];
  const context = vm.createContext({
    buildResidentContext, deliverSend, randomUUID, conversations, parties, c: recipient,
    historyImportIds: new Set(), conversationWorkspaces: {snapshot: () => ({turn: {sandboxPolicy: {type: 'readOnly'}}})},
    projects: {active: new Map()}, assertBoardAvailable() {}, hasScheduledRun: () => false,
    scheduledStarting: null, workQuestWaiter: null, teamsWaiter: null, startingTodo: false,
    state: {account: {}, limits: {}, connected: true, login: null, models: [{model: 'model'}]},
    changed: async chat => {saves.push(plain(chat));}, emit() {}, refresh: async () => {},
    checkPlan: () => ({ok: true}), rememberScheduledQuotaStop() {}, prepareImportedHistoryInput: async () => [],
    attachments: {reserve: async () => [], input: () => [], public: value => value, release: rows => released.push(rows)},
    contextBoard: {reserve: async () => [], release: rows => released.push(rows)},
    contextInput: (_rows, text) => [{type: 'text', text}], checkImageModel() {}, equippedSkills: async () => [],
    skillInput: () => [], ensureThread: async () => {}, consumeShot() {}, publicSkill: value => value,
    commitAttachments: async () => {}, attachContexts: async () => {},
    rpc: async (method, params) => {calls.push({method, params: plain(params)}); return {turn: {id: 'accepted-turn'}};},
    json: (_response, status, value) => ({status, value}), res: {},
  });
  vm.runInContext(send + '\n' + steer + '\nasync function dispatch(p,b){\n' + routes + '\nthrow Error("Missing fixture route");}', context);
  const visit = {source: 'village', partyKey: residentPartyKey(party)};
  const body = {id: recipient.id, text: '何から改善しますか？', model: 'model', effort: 'medium', requestId: 'resident-request', residentVisit: visit};
  return {context, calls, saves, released, recipient, companion, parties, body,
    dispatch: (route, input = body) => context.dispatch(route, input)};
}

test('actual send route forwards companion context to turn/start and stores only bounded provenance', async () => {
  const f = await fixture();
  assert.equal((await f.dispatch('/api/send')).status, 200);
  assert.equal(f.calls.length, 1);
  const {method, params} = f.calls[0];
  assert.equal(method, 'turn/start');
  assert.match(params.input[0].text, /下書きを保持する/);
  assert.match(params.input[0].text, /実装と検証/);
  assert.doesNotMatch(JSON.stringify(params.input), /UNSELECTED_SECRET/);
  assert.equal(params.input.at(-1).text, f.body.text);
  assert.equal(params.sandboxPolicy.type, 'readOnly');
  assert.equal(f.recipient.messages.length, 1);
  const message = f.recipient.messages[0];
  assert.equal(message.text, f.body.text);
  assert.equal(message.residentContext.companions[0].name, 'リナ');
  assert.equal(message.residentContext.companions[0].role, '実装と検証');
  assert.doesNotMatch(JSON.stringify(message.residentContext), /下書きを保持する|起動失敗時も保存を確認/);
  assert.equal(message.delivery.requestId, f.body.requestId);
  assert.equal(f.released.length, 2);
});

test('actual steer route preserves the turn target and adds the current companion perspective', async () => {
  const f = await fixture({running: true});
  await f.dispatch('/api/steer', {...f.body, expectedTurnId: 'turn-current'});
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'turn/steer');
  assert.equal(f.calls[0].params.expectedTurnId, 'turn-current');
  assert.match(f.calls[0].params.input[0].text, /下書きを保持する/);
  assert.equal(f.calls[0].params.input.at(-1).text, f.body.text);
  assert.equal(f.recipient.messages[0].steer, true);
  assert.equal(f.recipient.messages[0].residentContext.companions[0].id, 'engineer');
});

test('ordinary chat sends do not implicitly share the configured party history', async () => {
  const f = await fixture(), {residentVisit, ...body} = f.body;
  await f.dispatch('/api/send', body);
  assert.deepEqual(f.calls[0].params.input, [{type: 'text', text: f.body.text}]);
  assert.equal('residentContext' in f.recipient.messages[0], false);
});

test('stale resident formation stops before RPC and before changing the conversation', async () => {
  const f = await fixture();
  f.parties.state.party.members[0].role = '別の役割';
  await assert.rejects(f.dispatch('/api/send'), /仲間が変わりました/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.recipient.messages.length, 0);
  assert.equal(f.recipient.status, 'idle');
});

test('an accepted request stays idempotent after the party changes and cannot resend with a forged visit', async () => {
  const f = await fixture();
  await f.dispatch('/api/send');
  f.parties.state.party.members[0].role = '別の役割';
  await f.dispatch('/api/send');
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.dispatch('/api/send', {...f.body, residentVisit: {...f.body.residentVisit, partyKey: residentPartyKey(f.parties.state.party)}}), /同じ送信ID/);
  assert.equal(f.calls.length, 1);
});
