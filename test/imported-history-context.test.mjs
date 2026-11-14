import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp, realpath, readFile, writeFile, readdir, rm, symlink, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {prepareImportedHistoryInput, IMPORTED_HISTORY_PREVIEW_CHARS} from '../imported-history-context.mjs';
import {ConversationWorkspaces} from '../conversation-workspace.mjs';
import {moduleFixture} from './modules-fixture.mjs';

async function temporary(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'a2a-history-context-')));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
const chat = messages => ({id: 'import-test', migration: {method: 'rollout', contextSent: false}, messages});
const archivePath = input => JSON.parse(input[0].text.match(/全文の履歴ファイル: (.+)\n/)[1]);
const rollout = text => [
  {type: 'session_meta', payload: {id: 'long-rollout-fixture'}},
  {type: 'event_msg', payload: {type: 'user_message', message: text}},
  {type: 'event_msg', payload: {type: 'agent_message', message: 'The latest visible answer.'}}
].map(JSON.stringify).join('\n');

test('long imported histories preserve the full transcript and bound the model input', async t => {
  const cwd = await temporary(t);
  const messages = [{role: 'user', text: 'EARLY SPECIFICATION\n' + '大陸の地形'.repeat(50000)},
    {role: 'assistant', text: 'Latest visible answer'}, {role: 'tool', text: 'Never carry tool output'}];
  const value = chat(messages), input = await prepareImportedHistoryInput(value, {cwd});
  assert.ok(input[0].text.length < IMPORTED_HISTORY_PREVIEW_CHARS + 2000);
  assert.match(input[0].text, /直近の抜粋/);
  assert.match(input[0].text, /Latest visible answer/);
  assert.doesNotMatch(input[0].text, /EARLY SPECIFICATION|Never carry tool output/);
  const file = archivePath(input), rows = (await readFile(file, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(rows, messages.slice(0, 2));
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.equal(value.migration.contextSent, false, 'Preparation is not proof of a successful turn');
  assert.deepEqual(await prepareImportedHistoryInput(value, {cwd}), input, 'Retry verifies and reuses the immutable archive');
});

test('a large latest message has a labelled bounded excerpt while its full text remains local', async t => {
  const cwd = await temporary(t), text = '\u0001'.repeat(250000) + 'LATEST-END';
  const input = await prepareImportedHistoryInput(chat([{role: 'user', text}]), {cwd});
  assert.ok(input[0].text.length < IMPORTED_HISTORY_PREVIEW_CHARS + 2000);
  assert.match(input[0].text, /末尾の抜粋/); assert.match(input[0].text, /LATEST-END/);
  assert.equal(JSON.parse((await readFile(archivePath(input), 'utf8')).trimEnd()).text, text);
});

test('local-thread imports and successfully sent context do not reread or resend history', async () => {
  for (const migration of [undefined, {method: 'local'}, {method: 'rollout', contextSent: true}])
    assert.deepEqual(await prepareImportedHistoryInput({migration}, {}), []);
});

test('invalid identifiers and archive locations fail before filesystem preparation', async t => {
  const cwd = await temporary(t), value = chat([{role: 'user', text: 'Keep'}]);
  await assert.rejects(prepareImportedHistoryInput({...value, id: '../escape'}, {cwd}), /conversation ID/);
  await assert.rejects(prepareImportedHistoryInput(value, {cwd, historyDirectory: path.dirname(cwd)}), /作業フォルダ内/);
  assert.deepEqual(await readdir(cwd), []);
});

test('altered files and symlink archives are preserved and block the next turn', async t => {
  const cwd = await temporary(t), value = chat([{role: 'user', text: 'Original visible history'}]);
  const first = await prepareImportedHistoryInput(value, {cwd}), file = archivePath(first);
  await writeFile(file, 'modified by user');
  await assert.rejects(prepareImportedHistoryInput(value, {cwd}), /上書きせず/);
  assert.equal(await readFile(file, 'utf8'), 'modified by user');
  await rm(file);
  const target = path.join(cwd, 'ordinary-target.txt'); await writeFile(target, 'untouched'); await symlink(target, file);
  await assert.rejects(prepareImportedHistoryInput(value, {cwd}));
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});

test('consultation and work modes retain the same per-conversation archive location', async t => {
  const directory = await temporary(t), scopes = new ConversationWorkspaces({directory});
  const value = chat([{role: 'user', text: 'Earlier instruction'}]);
  const consultation = scopes.snapshot(value), work = scopes.snapshot({...value, workMode: 'work'});
  assert.equal(consultation.historyDirectory, work.historyDirectory);
  const first = await prepareImportedHistoryInput(value, consultation), second = await prepareImportedHistoryInput(value, work);
  assert.equal(archivePath(first), archivePath(second));
  assert.ok(archivePath(second).startsWith(work.cwd + path.sep));
});

test('imported long history continues once, survives restart, and remains accessible after work-mode selection', async t => {
  const f = await moduleFixture(t, {localWork: true});
  const imported = await f.post('history/codex/file', {name: 'rollout-fixture.jsonl', text: rollout('INITIAL SPEC\n' + 'x'.repeat(210000))});
  assert.equal(imported.status, 200);
  const id = imported.body.conversations[0].id;
  const send = () => f.post('send', {id, text: 'Continue this development', model: 'fixture-model'});
  assert.equal((await send()).status, 200);
  await f.until(state => state.conversations.find(value => value.id === id)?.status === 'completed');
  let turns = (await f.log()).filter(call => call.method === 'turn/start');
  const file = archivePath(turns[0].params.input);
  assert.match(await readFile(file, 'utf8'), /INITIAL SPEC/);
  await f.restart();
  assert.equal((await f.post('conversation-mode', {id, mode: 'work'})).status, 200);
  assert.equal((await send()).status, 200);
  await f.until(state => state.conversations.find(value => value.id === id)?.status === 'completed');
  turns = (await f.log()).filter(call => call.method === 'turn/start');
  assert.equal(turns.length, 2);
  assert.doesNotMatch(JSON.stringify(turns[1].params.input), /全文の履歴ファイル/);
  assert.ok(file.startsWith(turns[1].params.cwd + path.sep));
});

test('archive preparation failure prevents thread creation and model submission', async t => {
  const f = await moduleFixture(t);
  const imported = await f.post('history/codex/file', {name: 'rollout-fixture.jsonl', text: rollout('Preserve this history')});
  const id = imported.body.conversations[0].id;
  await writeFile(path.join(f.dir, 'data', 'workspace', 'chats'), 'ordinary file blocks directory creation');
  const result = await f.post('send', {id, text: 'Continue', model: 'fixture-model'});
  assert.equal(result.status, 400);
  assert.equal((await f.log()).filter(call => ['thread/start', 'turn/start'].includes(call.method)).length, 0);
  assert.equal((await f.state()).conversations.find(value => value.id === id).migration.contextSent, false);
});
