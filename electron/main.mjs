import { app, BrowserWindow, session, ipcMain, shell, dialog, Menu, screen } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, access } from 'node:fs/promises';
import { constants, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {startPreviewServer} from './preview-server.mjs';
import {registeredProjectLink} from './project-links.mjs';
import {createUiStateStore} from './ui-state-store.mjs';
import {createCloseCoordinator} from './close-coordinator.mjs';
import {createMapStateStore} from './map-state.mjs';
import {bundledCodexPath,resolveCodexExecutable} from './codex-runtime.mjs';
import {waitForBackendReady,stopOwnedChild,processDiagnostic,createRuntimeRecovery,relaunchAfterRecovery} from './runtime-recovery.mjs';
import {beginWindowSession,startupPageURL,revealWindow,revealForDialog,fitWindowToWorkArea} from './window-lifecycle.mjs';
import {createWindowDiagnostics} from './window-diagnostics.mjs';
import {createSavedReload,createWindowStateFlusher} from './saved-reload.mjs';
import { isTrustedExternal, isAppUrl, isMainFrame } from './security.mjs';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
// Display branding can change without moving existing conversations or drafts.
app.setPath('userData',path.join(app.getPath('appData'),'personal-chat-ui'));
app.setName('A2ACraft');
const demo = process.argv.includes('--demo');
const smoke = process.argv.includes('--smoke-test');
const recordSampleWalk=process.argv.includes('--record-sample-walk');
const validationPath=process.argv.find(value=>value.startsWith('--validation-data-dir='))?.slice('--validation-data-dir='.length);
if(recordSampleWalk&&(!demo||smoke||validationPath))throw Error('Walk recording requires an isolated demo');
if(validationPath){
  if(!path.isAbsolute(validationPath))throw Error('Validation data directory must be absolute');
  app.setPath('userData',validationPath);
}
if(demo){
  const previewPath=process.argv.find(value=>value.startsWith('--preview-data-dir='))?.slice('--preview-data-dir='.length);
  if(previewPath&&!path.isAbsolute(previewPath))throw Error('Preview data directory must be absolute');
  if(recordSampleWalk){
    if(!previewPath)throw Error('Walk recording requires a new absolute preview directory');
    // Fail if the requested directory already exists, before loading any UI state.
    mkdirSync(previewPath,{mode:0o700});
  }
  app.setPath('userData',previewPath||path.join(app.getPath('userData'),'Demo'));
}
if (smoke) {
  const smokePath = process.argv.find(value => value.startsWith('--smoke-data-dir='))?.slice('--smoke-data-dir='.length);
  if (!smokePath || !path.isAbsolute(smokePath)) throw Error('Smoke test requires an isolated absolute data directory');
  app.setPath('userData', smokePath);
}
let window, backend, previewServer, origin, settings = {}, quitting = false, starting = true, restartRequired = false;
let relaunchRequested = false;
let settingsWriting = Promise.resolve();
let rendererFlushReady = false, rendererFlushWaiter = null;
let windowDiagnostics;
let closingRequest=null;
function fitOwnedWindow(target) {
  if(!target||target.isDestroyed())return;
  fitWindowToWorkArea(target,screen.getDisplayMatching(target.getBounds()).workArea);
}
function revealAppWindow(target) {
  if(!target||target.isDestroyed())return false;
  if(process.platform==='darwin')app.show();
  if(target.isMinimized())target.restore();
  fitOwnedWindow(target);
  return revealWindow(target);
}
const uiStore = createUiStateStore({
  read: () => readFile(path.join(app.getPath('userData'), 'ui-state.json'), 'utf8'),
  write: async snapshot => {
    const file = path.join(app.getPath('userData'), 'ui-state.json');
    await writeFile(file + '.tmp', snapshot, { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
});
const mapStore = createMapStateStore({
  read: () => readFile(path.join(app.getPath('userData'), 'map-state.json'), 'utf8'),
  write: async snapshot => {
    const file = path.join(app.getPath('userData'), 'map-state.json');
    await writeFile(file + '.tmp', snapshot, {mode: 0o600});
    await rename(file + '.tmp', file);
  }
});

function flushRendererDrafts() {
  if (!rendererFlushReady || !window || window.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const id = randomBytes(16).toString('hex');
    const timer = setTimeout(() => finish(Error('画面の下書き保存を確認できませんでした。')), 10000);
    const finish = error => {
      clearTimeout(timer); rendererFlushWaiter = null;
      error ? reject(error) : resolve();
    };
    rendererFlushWaiter = { id, finish };
    try { window.webContents.send('ui:flush', id); } catch (error) { finish(error); }
  });
}

const flushWindowState=createWindowStateFlusher({flushRenderer:flushRendererDrafts,
  flushUi:()=>uiStore.flush(),flushMap:()=>mapStore.flush()});

const coordinatedClose = createCloseCoordinator({
  flush: async () => {
    if (!starting && window && !window.isDestroyed()) {
      await flushWindowState();
    }
    try { await settingsWriting; } catch { await writeSettings(); }
  },
  onFailure: async error => {
    const options = {
      type: 'warning', title: '終了前の保存',
      message: '下書き・地図・設定を保存できませんでした。',
      detail: String(error?.message || error) + '\n保存せずに終了すると、未保存の変更は失われます。',
      buttons: ['戻る', '保存を再試行', '保存せずに終了'], defaultId: 0, cancelId: 0,
      noLink: true
    };
    const result = await revealForDialog(window,parent=>parent?dialog.showMessageBox(parent,options):dialog.showMessageBox(options));
    if (result.response !== 1 && result.response !== 2 && window && !window.isDestroyed()) window.webContents.send('ui:close-cancelled');
    return result.response === 1 ? 'retry' : result.response === 2 ? 'discard' : 'cancel';
  },
  close: async () => {
    quitting = true;
    await Promise.allSettled([stopBackend(), settingsWriting]);
    if(relaunchRequested)relaunchAfterRecovery(app);
    app.exit(process.exitCode || 0);
  }
});

function requestClose() {
  if(closingRequest)return closingRequest;
  closingRequest=coordinatedClose().finally(()=>{closingRequest=null;});
  return closingRequest;
}

function resumeRenderer() {
  if(quitting||closingRequest||!window||window.isDestroyed())return;
  try{window.webContents.send('ui:close-cancelled');}catch{}
}
const requestReload=createSavedReload({
  canReload:()=>!quitting&&!closingRequest&&!starting&&window&&!window.isDestroyed(),
  flush:flushWindowState,
  reload:()=>window.webContents.reload(),
  resume:resumeRenderer,
  onFailure:async stage=>{
    if(quitting||closingRequest)return;
    const options={type:'warning',title:'画面の再読み込み',
      message:stage==='save'?'保存を確認できないため、画面を再読み込みしませんでした。':'下書きと地図は保存しましたが、画面を再読み込みできませんでした。',
      detail:stage==='save'?'下書きと地図を保持するため、現在の画面を残しています。保存先の空き容量や画面の応答を確認し、もう一度「画面を再読み込み」を選んでください。':'「ウィンドウ → 表示を復帰」を試してください。改善しない場合は、アプリを終了して開き直してください。',
      buttons:['画面へ戻る'],defaultId:0,cancelId:0,noLink:true};
    await revealForDialog(window,parent=>parent?dialog.showMessageBox(parent,options):dialog.showMessageBox(options));
  }
});

function closeWithSavedDrafts() {
  void requestClose().catch(error => {
    if (window && !window.isDestroyed()) window.webContents.send('ui:close-cancelled');
    revealForDialog(window,()=>dialog.showErrorBox('終了前の保存',error.message));
  });
}

const recoverRuntime=createRuntimeRecovery({
  present:async detail=>{
    const options={type:'error',title:'A2ACraft',message:'アプリの画面を表示できません。',
      detail:detail+'\n保存済みの会話と設定は保持します。再起動して接続し直してください。',
      buttons:['再起動','終了'],defaultId:0,cancelId:1,noLink:true};
    const parent=window;
    if(revealAppWindow(parent))return (await dialog.showMessageBox(parent,options)).response;
    return (await dialog.showMessageBox(options)).response;
  },
  close:async restart=>{
    relaunchRequested=restart;
    try {
      const closed=await requestClose();
      if(!closed)relaunchRequested=false;
      return closed;
    }catch(error){relaunchRequested=false;throw error;}
  }
});
function reportRuntimeFailure(detail,{rendererLost=false}={}){
  if(quitting)return;
  if(rendererLost){
    rendererFlushReady=false;
    rendererFlushWaiter?.finish(Error('画面との接続が失われました。'));
  }
  void recoverRuntime(detail).catch(()=>{
    relaunchRequested=false;
    dialog.showErrorBox('A2ACraft','終了処理を完了できませんでした。アプリを終了して開き直してください。');
  });
}

function settingsFile() { return path.join(app.getPath('userData'), 'desktop-settings.json'); }
async function readSettings() {
  try {
    const value = JSON.parse(await readFile(settingsFile(), 'utf8'));
    settings = {};
    for (const key of ['codexPath','workDirectory'])
      if(typeof value[key]==='string'&&path.isAbsolute(value[key]))settings[key]=value[key];
    if(typeof value.accessibilitySupportEnabled==='boolean')settings.accessibilitySupportEnabled=value.accessibilitySupportEnabled;
  } catch { settings = {}; }
  await uiStore.load();
  // Failed map reads remain protected: map:read retries and reports the error,
  // and map:save cannot replace the unreadable file with default positions.
  await mapStore.load().catch(() => {});
}
async function writeSettings({requiresRestart=true}={}) {
  const file = settingsFile();
  const snapshot = JSON.stringify(settings, null, 2);
  settingsWriting = settingsWriting.catch(() => {}).then(async () => {
    await writeFile(file + '.tmp', snapshot, { mode: 0o600 });
    await rename(file + '.tmp', file);
  });
  await settingsWriting;
  if(requiresRestart)restartRequired = true;
  return publicSettings();
}
function accessibilityMenuItem(){
  return {id:'screen-reading',label:'画面の読み取りに対応',type:'checkbox',checked:app.isAccessibilitySupportEnabled(),
    click:async item=>{
      const previous=settings.accessibilitySupportEnabled,enabled=item.checked;
      item.enabled=false;
      try{
        app.setAccessibilitySupportEnabled(enabled);
        settings.accessibilitySupportEnabled=enabled;
        await writeSettings({requiresRestart:false});
      }catch{
        if(previous===undefined)delete settings.accessibilitySupportEnabled;
        else settings.accessibilitySupportEnabled=previous;
        dialog.showErrorBox('画面の読み取り','設定を保存できませんでした。次回の起動時に、もう一度この項目を選んでください。');
      }finally{
        item.checked=app.isAccessibilitySupportEnabled();item.enabled=true;
      }
    }};
}
function publicSettings(){return {codexPath:settings.codexPath||'',workDirectory:settings.workDirectory||'',restartRequired};}
async function saveWorkDirectory(directory){
  const backendRoot=app.isPackaged?path.join(process.resourcesPath,'backend'):app.getAppPath();
  const {ensureAgentWorkspace}=await import(pathToFileURL(path.join(backendRoot,'codex-workspace-policy.mjs')).href);
  const result=await ensureAgentWorkspace(directory);
  settings.workDirectory=result.directory;
  return writeSettings();
}
function requireAppFrame(event) {
  if (!isMainFrame(event, window, origin)) throw Error('Untrusted IPC sender');
}
async function openTrustedExternal(url) {
  if (!isTrustedExternal(url)&&!await registeredProjectLink(path.join(app.getPath('userData'),'data'),url)) throw Error('このURLはログイン先や保存された成果に登録されていません。');
  await shell.openExternal(url);
}

function installIpc() {
  const handle = (name, action) => ipcMain.handle(name, async (event, ...args) => {
    requireAppFrame(event);
    return action(...args);
  });
  handle('window:minimize', () => window.minimize());
  handle('window:toggle-maximize', () => {
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
    return { maximized: window.isMaximized() };
  });
  handle('window:close', () => window.close());
  handle('app:open-external', openTrustedExternal);
  handle('settings:read', publicSettings);
  handle('ui:read', () => uiStore.read());
  handle('map:read', (value = {}) => mapStore.read(demo || value.demo === true));
  handle('map:save', value => {
    if (quitting) throw Error('Application is shutting down');
    return mapStore.save({...value, demo: demo || value?.demo === true});
  });
  handle('ui:flush-ready', () => { rendererFlushReady = true; });
  handle('ui:flush-complete', result => {
    if (!rendererFlushWaiter || result?.id !== rendererFlushWaiter.id) return;
    rendererFlushWaiter.finish(result.error ? Error(String(result.error).slice(0, 500)) : null);
  });
  handle('ui:save', async value => {
    if (quitting) throw Error('Application is shutting down');
    return uiStore.save(value);
  });
  handle('settings:choose-codex', async () => {
    const choice = await dialog.showOpenDialog(window, {
      title: 'Codex CLI の実行ファイルを選択',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: '実行ファイル', extensions: ['exe'] }] } : {})
    });
    if (choice.canceled || !choice.filePaths.length) return { codexPath: settings.codexPath || '', restartRequired };
    const chosen = choice.filePaths[0];
    if (!path.isAbsolute(chosen) || !(await stat(chosen)).isFile()) throw Error('実行ファイルを選択してください。');
    // Windows .cmd scripts are not executables accepted by spawn without a shell.
    // Keep shell execution disabled. Choose the native codex.exe instead.
    if (process.platform === 'win32' && !chosen.toLowerCase().endsWith('.exe')) throw Error('Codex のネイティブ codex.exe を選択してください。');
    if (process.platform !== 'win32') await access(chosen, constants.X_OK);
    settings.codexPath = chosen;
    return writeSettings();
  });
  handle('settings:reset-codex', async () => { delete settings.codexPath; return writeSettings(); });
  handle('settings:choose-workspace', async () => {
    const choice=await dialog.showOpenDialog(window,{
      title:'A2ACraftの専用作業フォルダを選択',
      defaultPath:settings.workDirectory||path.join(app.getPath('userData'),'data','workspace'),
      properties:['openDirectory','createDirectory']
    });
    if(choice.canceled||!choice.filePaths.length)return publicSettings();
    return saveWorkDirectory(choice.filePaths[0]);
  });
  handle('settings:set-workspace', directory => saveWorkDirectory(directory));
}

async function startBackend(token) {
  const backendRoot = app.isPackaged ? path.join(process.resourcesPath, 'backend') : app.getAppPath();
  if(demo){
    const {staticFiles}=await import(pathToFileURL(path.join(backendRoot,'public-assets.mjs')).href);
    if(quitting)return;
    previewServer=await startPreviewServer({root:path.join(backendRoot,'public'),assets:staticFiles,token});
    origin=previewServer.origin;
    return;
  }
  const dataDir = path.join(app.getPath('userData'), 'data');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if(quitting)return;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '0', CHAT_UI_DESKTOP: '1', CHAT_UI_SESSION_TOKEN: token, CHAT_UI_DATA_DIR: dataDir, CHAT_UI_PACKAGE_ROOT: app.getAppPath() };
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
  if(settings.workDirectory)env.CHAT_UI_WORKSPACE_DIR=settings.workDirectory;
  else delete env.CHAT_UI_WORKSPACE_DIR;
  // GUI launches on macOS typically have a shorter PATH than a login shell.
  // An explicit saved path or CODEX_BIN always takes precedence.
  env.CODEX_BIN=await resolveCodexExecutable({configured:settings.codexPath,environment:process.env.CODEX_BIN,
    bundled:bundledCodexPath({packaged:app.isPackaged,resourcesPath:process.resourcesPath,appPath:app.getAppPath()})});
  if(quitting)return;
  backend = spawn(process.execPath, [path.join(backendRoot, 'backend-bootstrap.mjs')], {
    cwd: dataDir, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
  });
  const child = backend;
  const started = await waitForBackendReady(child);
  origin = started.origin;
  child.on('exit', (code,signal) => {
    if (!starting)reportRuntimeFailure('GUIサーバーとの接続が終了しました。 '+processDiagnostic({code,signal}));
  });
  child.on('error', error=>reportRuntimeFailure('GUIサーバーとの接続でエラーが発生しました。 '+processDiagnostic({code:error?.code})));

}

function createDesktopSession(){
  const desktopSession = session.fromPartition('chat-ui-' + randomBytes(12).toString('hex'));
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.on('will-download', event => event.preventDefault());
  const startupURL = startupPageURL();
  desktopSession.webRequest.onBeforeRequest((details, callback) => {
    const isStartupPage = !origin && details.resourceType === 'mainFrame' && details.url === startupURL;
    callback({cancel: !isStartupPage && !isAppUrl(details.url, origin)});
  });
  return desktopSession;
}

async function stopBackend() {
  if(previewServer){await previewServer.close();previewServer=null;return;}
  await stopOwnedChild(backend);
}

function createWindow(desktopSession) {
  window = new BrowserWindow({
    width: 1560, height: 1060, minWidth: 920, minHeight: 620,
    title: 'A2ACraft · Toppy', backgroundColor: '#060b12',
    show: false, autoHideMenuBar: true,
    frame: process.platform === 'darwin', titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 15 } } : {}),
    webPreferences: { preload: path.join(electronRoot, 'preload.cjs'), session: desktopSession,
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      spellcheck: false, devTools: !app.isPackaged }
  });
  // Native captures can clip a window outside its display. Constrain only our
  // window before first show and when restoring it, without reloading drafts.
  fitOwnedWindow(window);
  const fittedWindow=window;
  fittedWindow.on('show',()=>fitOwnedWindow(fittedWindow));
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault(); closeWithSavedDrafts();
  });
  window.webContents.on('did-start-loading', () => { rendererFlushReady = false; });
  window.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{
    if(origin&&isMainFrame&&code!==-3)reportRuntimeFailure('画面の読み込みに失敗しました。 '+processDiagnostic({code}),{rendererLost:true});
  });
  window.webContents.on('render-process-gone',(_event,details)=>{
    reportRuntimeFailure('画面の処理が終了しました。 '+processDiagnostic({code:details?.exitCode}),{rendererLost:true});
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(window.webContents.getURL(), origin)) openTrustedExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault();
      if (isAppUrl(window.webContents.getURL(), origin)) openTrustedExternal(url).catch(() => {});
    }
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event, details) => {
    const url = typeof details === 'string' ? details : details?.url;
    if (url && !isAppUrl(url, origin)) event.preventDefault();
  });
  const windowState = () => { if (!window.isDestroyed()) window.webContents.send('window:state', { maximized: window.isMaximized() }); };
  window.on('maximize', windowState); window.on('unmaximize', windowState);
  // Provide an app-owned surface immediately and keep its native identity for
  // the entire session, including a slow settings or backend startup.
  return beginWindowSession(window, revealAppWindow);
}

async function loadProductWindow(navigate) {
  const url = new URL(origin);
  url.searchParams.set('desktop', '1');
  if (demo) { url.searchParams.set('demo', '1'); url.searchParams.set('village', 'sample'); url.searchParams.set('projects','sample'); url.searchParams.set('subagents','sample'); }
  if(recordSampleWalk){url.searchParams.delete('projects');url.searchParams.set('walk','resident');}
  await navigate(url.href,{canReveal:()=>!quitting});
  if(quitting)return;
  starting = false;
  if(recordSampleWalk){
    const {captureSampleWalk}=await import('./sample-walk-capture.mjs');
    const ok=await captureSampleWalk(window,{origin,profile:app.getPath('userData'),version:app.getVersion(),reveal:revealAppWindow});
    if(!ok)process.exitCode=1;
  }
  if (smoke) await smokeCheck();
}

async function smokeCheck() {
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const terminalResponse = await fetch('/api/terminal/start', {method:'POST',headers:{'Content-Type':'application/json','X-Chat-UI':'1'},body:JSON.stringify({cols:80,rows:24})});
      const terminalSession = await terminalResponse.json();
      const terminalCloseStatus = terminalResponse.ok ? (await fetch('/api/terminal/close', {method:'POST',headers:{'Content-Type':'application/json','X-Chat-UI':'1'},body:JSON.stringify({id:terminalSession.id})})).status : null;
      const terminalAssets = await Promise.all(['/vendor/xterm.mjs','/vendor/addon-fit.mjs','/vendor/xterm.css'].map(async url => (await fetch(url)).status));
      const villagePreview = new URL(location.href).searchParams.get('village') === 'sample';
      const visibleVillage = () => Boolean(document.querySelector('#village-canvas')?.getClientRects().length);
      if (villagePreview) for (let i=0;i<100&&!visibleVillage();i++) await new Promise(resolve=>setTimeout(resolve,20));
      return {
      title: document.title,
      electron: window.desktop?.isElectron === true,
      nodeExposed: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
      sessionCookieExposed: document.cookie.includes('chat_ui_session'),
      apiStatus: (await fetch('/api/state')).status,
      titlebar: Boolean(document.querySelector('[data-window-action="close"]')),
      panels: document.querySelectorAll('.chat-panel').length,
      villagePreview,
      villageVisible: visibleVillage(),
      terminalStatus: terminalResponse.status,
      terminalCloseStatus,
      terminalAssets
    }; })()`);
    const prefs = window.webContents.getLastWebPreferences();
    const unauthorized = await fetch(origin + '/api/state');
    const secure = result.electron && !result.nodeExposed && !result.sessionCookieExposed && result.apiStatus === 200 && unauthorized.status === 403 && prefs.contextIsolation && prefs.sandbox && !prefs.nodeIntegration;
    const terminalOk = result.terminalStatus === 200 && result.terminalCloseStatus === 200 && result.terminalAssets.every(status => status === 200);
    console.log('ELECTRON_SMOKE ' + JSON.stringify({ ...result, unauthorizedStatus: unauthorized.status, secure }));
    if (!secure || !terminalOk || result.villagePreview && !result.villageVisible) process.exitCode = 1;
  } catch (error) { console.error('ELECTRON_SMOKE_FAILED ' + error.message); process.exitCode = 1; }
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  const revealApp=()=>{
    if(quitting)return;
    revealAppWindow(window);
  };
  app.on('second-instance',revealApp);
  app.on('activate',revealApp);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); closeWithSavedDrafts();
  });
  app.whenReady().then(async () => {
    const desktopSession=createDesktopSession();
    const navigate = createWindow(desktopSession);
    await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
    if(quitting)return;
    await readSettings();
    if(quitting)return;
    installIpc();
    const supportsScreenReading=['darwin','win32'].includes(process.platform);
    if(supportsScreenReading&&settings.accessibilitySupportEnabled===true)app.setAccessibilitySupportEnabled(true);
    const diagnosticPath=path.join(app.getPath('logs'),'window-diagnostics.json');
    windowDiagnostics=createWindowDiagnostics({getWindow:()=>window,version:app.getVersion(),logPath:diagnosticPath,
      getWorkArea:target=>screen.getDisplayMatching(target.getBounds()).workArea,
      writeReport:async report=>{
        await mkdir(path.dirname(diagnosticPath),{recursive:true,mode:0o700});
        await writeFile(diagnosticPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
      },
      present:(parent,options)=>{
        // The diagnostic snapshot is already recorded before this recovery.
        return revealAppWindow(parent)?dialog.showMessageBox(parent,options):dialog.showMessageBox(options);
      }});
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: '編集', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '表示', submenu: [
        {label:'画面を再読み込み',accelerator:'CmdOrCtrl+R',click:()=>{void requestReload().catch(()=>{
          resumeRenderer();revealForDialog(window,()=>dialog.showErrorBox('画面の再読み込み','画面を再読み込みできませんでした。現在の画面で保存状態を確認してください。'));
        });}},
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
        ...(supportsScreenReading?[{type:'separator'},accessibilityMenuItem()]:[])] },
      { label: 'ウィンドウ', submenu: [
        {label:'表示を復帰',click:()=>{if(!quitting)revealApp();}},
        {label:'表示の診断',click:()=>{void windowDiagnostics.show().catch(()=>dialog.showErrorBox('表示の診断','診断画面を開けませんでした。'));}},
        {type:'separator'},{ role: 'minimize' }, { role: 'close' }] }
    ]));
    app.on('accessibility-support-changed',(_event,enabled)=>{
      const item=Menu.getApplicationMenu()?.getMenuItemById('screen-reading');
      if(item)item.checked=enabled;
    });
    windowDiagnostics.observe(window);
    const token=randomBytes(32).toString('hex');
    await startBackend(token);
    if(quitting)return;
    await desktopSession.cookies.set({url:origin,name:'chat_ui_session',value:token,path:'/',httpOnly:true,sameSite:'strict'});
    if(quitting)return;
    await loadProductWindow(navigate);
  }).catch(error => {
    process.exitCode=1;
    reportRuntimeFailure(error.publicDiagnostic||'アプリを起動できませんでした。 '+processDiagnostic({code:error?.code}));
  });
}
