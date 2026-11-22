import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Reproduce the packaged location of sidecar.mjs. Only the Node companion is
// required for this test; its sibling modules are the checked-in product code.
async function stage(directory) {
  const bundle = path.join(directory, 'backend');
  await mkdir(bundle);
  await copyFile(path.join(root, 'src-tauri/sidecar.mjs'), path.join(bundle, 'sidecar.mjs'));
  for (const file of ['backend-bootstrap.mjs', 'codex-workspace-policy.mjs', 'electron', 'public', 'public-assets.mjs']) {
    await symlink(path.join(root, file), path.join(bundle, file));
  }
  return path.join(bundle, 'sidecar.mjs');
}

function start(script, directory, args = []) {
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [script, ...args], {
    stdio:['pipe', 'pipe', 'pipe'],
    cwd:directory,
    env:{
      PATH:path.dirname(process.execPath) + path.delimiter + '/usr/bin' + path.delimiter + '/bin',
      OPENSSL_CONF:'/dev/null', PORT:'0', CHAT_UI_DESKTOP:'1', CHAT_UI_READY_STDOUT:'1',
      CHAT_UI_SESSION_TOKEN:token, CHAT_UI_DATA_DIR:path.join(directory, 'data'),
      CODEX_BIN:path.join(root, 'test/fake-codex.mjs'),
      A2ACRAFT_FIXTURE_CONTROL:path.join(directory, 'fixture.json')
    }
  });
  const exited = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let request = 0;
  child.stderr.resume();
  async function readFrame(match) {
    while (true) {
      const line = await lines.next();
      assert(!line.done, 'Desktop companion exited before its response');
      if (!line.value.startsWith('{')) continue;
      const frame = JSON.parse(line.value);
      if (match(frame)) return frame;
    }
  }
  return {
    token, exited, child,
    ready:() => readFrame(frame => frame.type === 'ready'),
    async control(action, value = null) {
      const id = ++request;
      child.stdin.write(JSON.stringify({id, action, value}) + '\n');
      return readFrame(frame => frame.type === 'desktop-response' && frame.id === id);
    },
    async close() {
      child.stdin.end();
      return exited;
    }
  };
}

function api(origin, token) {
  const headers = {Origin:origin, Cookie:'chat_ui_session=' + token, 'X-Chat-UI':'1', 'Content-Type':'application/json'};
  return (route, body) => fetch(origin + '/api/' + route, body === undefined ? {headers} :
    {method:'POST', headers, body:JSON.stringify(body)});
}

test('Tauri companion runs a protected chat turn, flushes on stdin EOF, and restores map and draft', {timeout:20000}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft-tauri-'));
  const processes = [];
  t.after(async () => {
    for (const session of processes) {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGTERM');
      await session.exited;
    }
    await rm(directory, {recursive:true, force:true});
  });
  const script = await stage(directory);
  await writeFile(path.join(directory, 'fixture.json'), JSON.stringify({autoComplete:true}));
  const first = start(script, directory);
  processes.push(first);
  const {port, origin} = await first.ready();
  assert.equal(origin, 'http://127.0.0.1:' + port);
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  const call = api(origin, first.token);
  const connected = await (await call('connect', {})).json();
  assert.equal(connected.account?.type, 'chatgpt');
  assert.equal(connected.policy.ok, true);
  assert.equal(connected.models[0].model, 'fixture-model');
  const {id} = await (await call('conversations', {title:'Tauri conversation'})).json();
  assert(id);
  const question = 'Confirm desktop delivery';
  assert.equal((await call('send', {id, text:question, model:'fixture-model'})).status, 200);
  let chat;
  for (let attempt = 0; attempt < 100; attempt++) {
    chat = (await (await call('state')).json()).conversations.find(item => item.id === id);
    if (chat.status === 'completed') break;
    await delay(25);
  }
  assert.equal(chat.status, 'completed');
  assert.deepEqual(chat.messages.map(({role, text}) => [role,text]), [['user',question], ['assistant','Fixture result 1']]);
  const draft = '未送信\nRPG';
  const state = {drafts:{[id]:draft}, sendRequests:{}, selected:id, layout:4, motion:'system'};
  const items = {'chat-ui-village-view':JSON.stringify({zoom:2})};
  assert.deepEqual((await first.control('uiSave', state)).result, {ok:true});
  assert.deepEqual((await first.control('mapSave', {demo:false, items})).result, {ok:true});
  assert.ok((await first.control('mapRead', {demo:true})).error);
  assert.equal(await first.close(), 0);

  const second = start(script, directory);
  processes.push(second);
  const reopened = await second.ready();
  assert.equal((await api(reopened.origin, first.token)('state')).status, 403);
  const recovered = await (await api(reopened.origin, second.token)('state')).json();
  assert.equal(recovered.connected, false);
  assert.deepEqual(recovered.conversations.find(item => item.id === id).messages, chat.messages);
  assert.deepEqual((await second.control('uiRead')).result, state);
  assert.deepEqual((await second.control('mapRead', {demo:false})).result, {version:1, items});
  assert.equal(await second.close(), 0);
});

test('Closing a Tauri window during startup leaves no running backend', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft-tauri-eof-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const script = await stage(directory);
  for (const [name, args] of [['live', []], ['demo', ['--demo']]]) {
    await t.test(name, async () => {
      const session = start(script, directory, args);
      try {
        const code = await Promise.race([session.close(), delay(10000, 'timed out', {ref:false})]);
        assert.equal(code, 0, 'The application owner closed its pipe before startup completed');
      } finally {
        if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGTERM');
        await session.exited;
      }
    });
  }
});
