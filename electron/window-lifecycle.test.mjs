import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {revealWindow, waitForWindowLoad, createStartupWindow} from './window-lifecycle.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

class WindowFixture extends EventEmitter {
  constructor(options={}) {
    super();this.options=options;this.visible=options.show===true;
    this.minimized=false;this.destroyed=false;this.focused=false;this.calls=[];
    this.load=deferred();this.urls=[];
    this.webContents=new EventEmitter();
    this.webContents.setWindowOpenHandler=handler=>{this.openHandler=handler;};
    this.webContents.stop=()=>{this.calls.push('stop');};
  }
  isDestroyed(){return this.destroyed;}
  isMinimized(){return this.minimized;}
  isVisible(){return this.visible;}
  restore(){this.calls.push('restore');this.minimized=false;}
  show(){assert.equal(this.destroyed,false);this.calls.push('show');this.visible=true;}
  focus(){assert.equal(this.destroyed,false);this.calls.push('focus');this.focused=true;}
  loadURL(url){this.urls.push(url);return this.load.promise;}
  destroy(){this.destroyed=true;this.visible=false;this.emit('closed');}
}

test('reopening a hidden or minimized window explicitly restores, shows and focuses it',()=>{
  const hidden=new WindowFixture();
  assert.equal(revealWindow(hidden),true);assert.equal(hidden.visible,true);assert.equal(hidden.focused,true);
  assert.deepEqual(hidden.calls,['show','focus']);
  hidden.calls=[];hidden.minimized=true;hidden.visible=false;
  assert.equal(revealWindow(hidden),true);
  assert.deepEqual(hidden.calls,['restore','show','focus']);assert.equal(hidden.minimized,false);
  const closed=new WindowFixture();closed.destroy();
  assert.equal(revealWindow(closed),false);assert.deepEqual(closed.calls,[]);
  assert.equal(revealWindow(null),false);
});

test('a completed load shows the app even when ready-to-show was never emitted',async()=>{
  const window=new WindowFixture();
  const loaded=waitForWindowLoad(window,'http://127.0.0.1:4317/?desktop=1',{timeoutMs:1000});
  window.load.resolve();await loaded;
  assert.equal(window.visible,true);assert.equal(window.focused,true);
  assert.equal(window.listenerCount('closed'),0);
});

test('quit requested during loading prevents the completed window from reappearing',async()=>{
  const window=new WindowFixture();let quitting=false;
  const loaded=waitForWindowLoad(window,'http://127.0.0.1:4317/',{timeoutMs:1000,canReveal:()=>!quitting});
  await tick();assert.equal(window.urls.length,1);
  quitting=true;window.load.resolve();await loaded;
  assert.equal(window.visible,false);assert.equal(window.focused,false);
  assert.deepEqual(window.calls,[]);assert.equal(window.listenerCount('closed'),0);
});

test('a stalled renderer load fails with a bounded diagnostic and cannot reveal itself later',async()=>{
  const window=new WindowFixture();
  const loaded=waitForWindowLoad(window,'http://127.0.0.1:4317/private-conversation?token=never-print',{timeoutMs:5});
  await assert.rejects(loaded,error=>{
    assert.equal(typeof error.publicDiagnostic,'string');
    assert.match(error.publicDiagnostic,/タイムアウト/);
    assert.doesNotMatch(error.publicDiagnostic,/private-conversation|never-print|127\.0\.0\.1|token=/);
    return true;
  });
  assert.equal(window.listenerCount('closed'),0);
  window.load.resolve();await tick();
  assert.equal(window.visible,false);assert.equal(window.focused,false);
});

test('closing during page load cancels the wait and late completion never touches the closed window',async()=>{
  const window=new WindowFixture();
  const loaded=waitForWindowLoad(window,'http://127.0.0.1:4317/',{timeoutMs:1000});
  window.destroy();await assert.rejects(loaded);
  assert.equal(window.listenerCount('closed'),0);
  window.load.resolve();await tick();
  assert.deepEqual(window.calls,[]);
});

test('load failure rejects and removes the close listener without showing an incomplete app',async()=>{
  const window=new WindowFixture(),failure=Object.assign(Error('load failed'),{code:'ERR_CONNECTION_REFUSED'});
  const loaded=waitForWindowLoad(window,'http://127.0.0.1:4317/',{timeoutMs:1000});
  window.load.reject(failure);await assert.rejects(loaded,error=>error===failure);
  assert.equal(window.listenerCount('closed'),0);assert.equal(window.visible,false);
});

test('a synchronous load failure also cleans up, and a destroyed window is never navigated',async()=>{
  const window=new WindowFixture(),failure=Error('synchronous load failure');
  window.loadURL=()=>{throw failure;};
  await assert.rejects(waitForWindowLoad(window,'http://127.0.0.1:4317/',{timeoutMs:1000}),error=>error===failure);
  assert.equal(window.listenerCount('closed'),0);
  const closed=new WindowFixture();closed.destroy();
  await assert.rejects(waitForWindowLoad(closed,'http://127.0.0.1:4317/'));
  assert.deepEqual(closed.urls,[]);assert.deepEqual(closed.calls,[]);
});

test('startup has a visible isolated window before its page is ready and delegates closing',async()=>{
  let closed=0;
  const window=createStartupWindow(WindowFixture,{onClose:()=>{closed++;}});
  assert.equal(window.visible,true);
  const prefs=window.options.webPreferences;
  assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);
  assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);
  assert.equal(prefs.preload,undefined);
  assert.equal(typeof prefs.partition,'string');assert.ok(prefs.partition.length>0);
  assert.doesNotMatch(prefs.partition,/^persist:/);
  assert.deepEqual(window.openHandler({url:'https://unrelated.example'}),{action:'deny'});
  assert.match(window.urls[0],/^data:text\/html;charset=utf-8,/);
  const html=decodeURIComponent(window.urls[0].split(',').slice(1).join(','));
  assert.match(html,/default-src 'none'/);assert.doesNotMatch(html,/<script\b/i);
  let navigationPrevented=false;
  window.webContents.emit('will-navigate',{preventDefault(){navigationPrevented=true;}},'https://unrelated.example');
  assert.equal(navigationPrevented,true);
  let prevented=false;window.emit('close',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(closed,1);assert.equal(window.destroyed,false);
  window.load.resolve();await tick();
});
