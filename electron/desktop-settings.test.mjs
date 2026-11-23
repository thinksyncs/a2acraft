import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {nativeMenuTemplate, systemInterfaceLanguage} from './native-menu.mjs';
import {createDesktopSettings} from './desktop-settings.mjs';

test('desktop preferences survive a new session and preserve other settings', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft-settings-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const file = path.join(directory, 'desktop-settings.json');
  await writeFile(file, JSON.stringify({interfaceLanguage:'fr', workDirectory:directory, accessibilitySupportEnabled:true}));
  const store = createDesktopSettings(file);
  await store.load();
  assert.equal(store.read().interfaceLanguage, null);
  for (const value of [null, 'EN', 'en-US', {language:'ja'}]) {
    await assert.rejects(store.setInterfaceLanguage(value), /Unsupported interface language/);
  }
  assert.equal(JSON.parse(await readFile(file)).interfaceLanguage, 'fr');
  const [first, last] = await Promise.all([store.setInterfaceLanguage('en'), store.setInterfaceLanguage('ja')]);
  assert.equal(first.interfaceLanguage, 'en');
  assert.equal(last.interfaceLanguage, 'ja');
  assert.equal(last.restartRequired, false);
  const next = createDesktopSettings(file);
  await next.load();
  assert.equal(next.read().interfaceLanguage, 'ja');
  assert.equal(next.read().workDirectory, directory);
  assert.equal(next.accessibilitySupportEnabled, true);
  await Promise.all([next.update({codexPath:directory}), next.setInterfaceLanguage('en')]);
  assert.deepEqual(JSON.parse(await readFile(file)), {
    interfaceLanguage:'en', workDirectory:directory, codexPath:directory, accessibilitySupportEnabled:true
  });
  assert.equal(next.read().restartRequired, true);
});

test('a failed write leaves the committed preference intact and can be retried', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft-settings-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const file = path.join(directory, 'new-directory', 'desktop-settings.json');
  const store = createDesktopSettings(file);
  await store.load();
  await assert.rejects(store.setInterfaceLanguage('en'), {code:'ENOENT'});
  assert.equal(store.read().interfaceLanguage, null);
  await mkdir(path.dirname(file));
  await store.flush();
  assert.equal(store.read().interfaceLanguage, 'en');
  assert.equal(JSON.parse(await readFile(file)).interfaceLanguage, 'en');
});

test('both desktop bridges forward only the language action to their native host', async () => {
  const calls = [];
  const location = new URL('http://127.0.0.1:4317/');
  let desktop;
  runInNewContext(await readFile(new URL('./preload.cjs', import.meta.url), 'utf8'), {
    location, process:{platform:'darwin',versions:{electron:'test'}},
    require:() => ({
      contextBridge:{exposeInMainWorld:(_name, value) => { desktop = value; }},
      ipcRenderer:{invoke:(...args) => { calls.push(args); }}
    })
  });
  await desktop.setInterfaceLanguage('en');
  const window = {__TAURI__:{core:{invoke:(name, {action,value}) => { calls.push([name,action,value]); }}}};
  window.top = window;
  runInNewContext(await readFile(new URL('../src-tauri/bridge.js', import.meta.url), 'utf8'), {
    window, location, __CHAT_UI_PLATFORM__:'darwin', __CHAT_UI_VERSION__:'test', __CHAT_UI_PRACTICE__:false
  });
  await window.desktop.setInterfaceLanguage('ja');
  assert.deepEqual(calls, [['settings:set-interface-language','en'],['desktop_request','settingsSetInterfaceLanguage','ja']]);
});

test('translated menus retain every shortcut, native role, and handler', () => {
  const handler = () => {};
  const build = lang => nativeMenuTemplate({
    platform:'darwin', text:(ja,en) => lang === 'ja' ? ja : en, reload:handler, recover:handler, diagnose:handler,
    reading:{id:'screen-reading', type:'checkbox', checked:true, click:handler}
  });
  const ja = build('ja'), en = build('en');
  assert.deepEqual(ja.map(item => item.label), [undefined,'編集','表示','ウィンドウ']);
  assert.deepEqual(en.map(item => item.label), [undefined,'Edit','View','Window']);
  const controls = menu => menu.flatMap(group => group.submenu ?? [group]).map(({label, ...control}) => control);
  assert.deepEqual(controls(ja), controls(en));
  assert.deepEqual(en[2].submenu[0], {id:'saved-reload',label:'Reload Window',accelerator:'CmdOrCtrl+R',click:handler});
  assert.equal(en[3].submenu[0].click, handler);
  assert.equal(systemInterfaceLanguage(['fr-CA','ja-JP','en-US']), 'ja');
  assert.equal(systemInterfaceLanguage(['fr']), 'en');
});
