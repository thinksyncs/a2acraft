import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

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
  const initialPage = origin + '/?desktop=1';
  assert.equal((await fetch(initialPage)).status, 403);
  // Match the first native WKWebView navigation: the verified HttpOnly session
  // cookie is present, before an app-specific Codex login has been started.
  const page = await fetch(initialPage, {headers:{Cookie:'chat_ui_session=' + first.token}});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="start-connect"/);
  assert.match(html, /id="open-offline"/);
  const call = api(origin, first.token);
  assert.equal((await (await call('state')).json()).connected, false);
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

test('offline state worker preserves drafts and map after a demo sidecar crash without a server', {timeout:15000}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft-tauri-recovery-'));
  const sessions = [];
  t.after(async () => {
    for (const session of sessions) {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGTERM');
      await session.exited;
    }
    await rm(directory, {recursive:true, force:true});
  });
  const script = await stage(directory);
  const launch = (...args) => {
    const session = start(script, directory, args);
    sessions.push(session);
    return session;
  };
  const original = launch('--demo');
  await original.ready();
  original.child.kill('SIGKILL');
  await original.exited;

  const local = launch('--state-only', '--demo');
  assert.deepEqual(await local.ready(), {type:'ready'});
  const ui = {drafts:{quest:'旅の下書き'}, sendRequests:{}, selected:'quest', layout:1, motion:'system'};
  const items = {'chat-ui-demo-village-view':JSON.stringify({zoom:2})};
  assert.deepEqual((await local.control('uiSave', ui)).result, {ok:true});
  assert.deepEqual((await local.control('mapSave', {demo:true, items})).result, {ok:true});
  assert.ok((await local.control('prepareWorkspace', directory)).error);
  assert.equal(await local.close(), 0);

  const reopened = launch('--demo');
  await reopened.ready();
  assert.deepEqual((await reopened.control('uiRead')).result, ui);
  assert.deepEqual((await reopened.control('mapRead', {demo:true})).result, {version:1, items});
  assert.equal(await reopened.close(), 0);
});

test('Tauri renderer reports only the current flush and resumes only after a native cancellation', async () => {
  const window = new EventTarget();
  const origin = 'http://127.0.0.1:23456';
  const acknowledgements = [];
  window.top = window;
  window.__TAURI__ = {core:{invoke:async (_, {action, value}) => {
    if (action === 'flushComplete') acknowledgements.push([value.id, value.ok]);
  }}};
  const bridge = await readFile(path.join(root, 'src-tauri/bridge.js'), 'utf8');
  runInNewContext(bridge, {window, location:new URL(origin),
    __CHAT_UI_PLATFORM__:'darwin', __CHAT_UI_VERSION__:'test', __CHAT_UI_PRACTICE__:false});
  const saves = [];
  let resumes = 0;
  const unsubscribe = window.desktop.onBeforeClose(shouldSave => {
    if (!shouldSave) { resumes++; return; }
    return new Promise((resolve, reject) => saves.push({resolve, reject}));
  });
  const flush = id => window.dispatchEvent(new CustomEvent('a2acraft-native-close', {detail:id}));
  flush(1);
  flush(2);
  saves[0].reject(Error('late disk result'));
  saves[1].reject(Error('disk full'));
  await delay(0);
  assert.deepEqual(acknowledgements, [[2, false]]);
  assert.equal(resumes, 0);
  window.dispatchEvent(new Event('a2acraft-close-cancelled'));
  assert.equal(resumes, 1);
  flush(3);
  saves[2].resolve();
  await delay(0);
  assert.deepEqual(acknowledgements, [[2, false], [3, true]]);
  flush(4);
  unsubscribe();
  saves[3].resolve();
  await delay(0);
  assert.deepEqual(acknowledgements, [[2, false], [3, true]]);
});
