import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fitWindowBounds, fitWindowToWorkArea, revealWindow, revealForDialog, waitForWindowLoad, startupPageURL, beginWindowSession} from './window-lifecycle.mjs';
import {createCloseCoordinator} from './close-coordinator.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

class WindowFixture extends EventEmitter {
  constructor(options={}) {
    super();this.options=options;this.visible=options.show===true;
    this.minimized=false;this.destroyed=false;this.focused=false;this.calls=[];
    this.fullScreen=false;this.maximized=false;this.simpleFullScreen=false;
    this.bounds={x:0,y:30,width:1440,height:789};
    this.minimum=[920,620];
    this.load=deferred();this.urls=[];
    this.webContents=new EventEmitter();
    this.webContents.setWindowOpenHandler=handler=>{this.openHandler=handler;};
    this.webContents.stop=()=>{this.calls.push('stop');};
  }
  isDestroyed(){return this.destroyed;}
  isMinimized(){return this.minimized;}
  isVisible(){return this.visible;}
  isFullScreen(){return this.fullScreen;}
  isMaximized(){return this.maximized;}
  isSimpleFullScreen(){return this.simpleFullScreen;}
  getBounds(){return {...this.bounds};}
  getMinimumSize(){return [...this.minimum];}
  setMinimumSize(width,height){this.calls.push('setMinimumSize');this.minimum=[width,height];}
  setBounds(bounds,animate){
    assert.equal(animate,false);this.calls.push('setBounds');
    this.bounds={...bounds,width:Math.max(bounds.width,this.minimum[0]),height:Math.max(bounds.height,this.minimum[1])};
  }
  restore(){this.calls.push('restore');this.minimized=false;}
  show(){assert.equal(this.destroyed,false);this.calls.push('show');this.visible=true;}
  focus(){assert.equal(this.destroyed,false);this.calls.push('focus');this.focused=true;}
  loadURL(url){this.urls.push(url);return this.load.promise;}
  destroy(){this.destroyed=true;this.visible=false;this.emit('closed');}
}

test('fitting right and bottom overflow retains size and keeps all edges in the work area',()=>{
  const bounds=Object.freeze({x:317,y:511,width:1440,height:789});
  const workArea=Object.freeze({x:0,y:30,width:1440,height:870});
  assert.deepEqual(fitWindowBounds(bounds,workArea),{x:0,y:111,width:1440,height:789});
  const window=new WindowFixture();window.bounds={...bounds};
  assert.equal(fitWindowToWorkArea(window,workArea),true);
  assert.deepEqual(window.bounds,{x:0,y:111,width:1440,height:789});
  assert.deepEqual(window.calls,['setBounds']);
  assert.equal(fitWindowToWorkArea(window,workArea),false);
  assert.deepEqual(window.calls,['setBounds'],'repeated recovery does not resize an already fitted window');
});

test('an in-bounds window is unchanged and receives no native move or resize',()=>{
  const window=new WindowFixture(),bounds=window.getBounds();
  assert.deepEqual(fitWindowBounds(bounds,{x:0,y:30,width:1440,height:870}),bounds);
  assert.equal(fitWindowToWorkArea(window,{x:0,y:30,width:1440,height:870}),false);
  assert.deepEqual(window.bounds,bounds);assert.deepEqual(window.calls,[]);
});

test('fitting handles left and top overflow, oversized windows and negative display coordinates',()=>{
  assert.deepEqual(fitWindowBounds({x:-40,y:-50,width:800,height:600},{x:0,y:30,width:1440,height:870}),
    {x:0,y:30,width:800,height:600});
  assert.deepEqual(fitWindowBounds({x:317,y:511,width:1560,height:1060},{x:0,y:30,width:1440,height:870}),
    {x:0,y:30,width:1440,height:870});
  const secondary={x:-1920,y:-1050,width:1920,height:1080};
  assert.deepEqual(fitWindowBounds({x:-500,y:-200,width:1000,height:700},secondary),
    {x:-1000,y:-670,width:1000,height:700});
  assert.deepEqual(fitWindowBounds({x:-2200,y:-1200,width:1000,height:700},secondary),
    {x:-1920,y:-1050,width:1000,height:700});
});

test('invalid geometry is ignored without moving the native window',()=>{
  const valid={x:0,y:30,width:1440,height:870};
  for(const invalid of [null,{}, {...valid,x:NaN},{...valid,y:Infinity},{...valid,width:0},
    {...valid,height:-1},{...valid,width:'1440'}]){
    assert.equal(fitWindowBounds(valid,invalid),null);
    assert.equal(fitWindowBounds(invalid,valid),null);
    const window=new WindowFixture();
    assert.equal(fitWindowToWorkArea(window,invalid),false);assert.deepEqual(window.calls,[]);
  }
});

test('a smaller display caps the native minimum before fitting instead of leaving the window clipped',()=>{
  const window=new WindowFixture(),workArea={x:-800,y:30,width:800,height:580};
  assert.equal(fitWindowToWorkArea(window,workArea),true);
  assert.deepEqual(window.minimum,[800,580]);
  assert.deepEqual(window.bounds,{x:-800,y:30,width:800,height:580});
  assert.deepEqual(window.calls,['setMinimumSize','setBounds']);
  assert.equal(fitWindowToWorkArea(window,workArea),false);
  assert.deepEqual(window.calls,['setMinimumSize','setBounds']);
});

test('fitting remains available when optional native minimum-size APIs are absent',()=>{
  const window=new WindowFixture();window.bounds.x=317;
  window.getMinimumSize=undefined;window.setMinimumSize=undefined;
  assert.equal(fitWindowToWorkArea(window,{x:0,y:30,width:1440,height:870}),true);
  assert.equal(window.bounds.x,0);assert.deepEqual(window.calls,['setBounds']);
});

test('fitting never changes a missing, destroyed, maximized or fullscreen window',()=>{
  const workArea={x:0,y:30,width:1440,height:870};
  assert.equal(fitWindowToWorkArea(null,workArea),false);
  for(const state of ['destroyed','maximized','fullScreen','simpleFullScreen']){
    const window=new WindowFixture();window[state]=true;
    window.getBounds=()=>{throw Error('protected window geometry must not be read');};
    assert.equal(fitWindowToWorkArea(window,workArea),false);assert.deepEqual(window.calls,[]);
  }
});

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

test('save failure dialogs reveal their hidden or minimized parent before asking for a decision',async()=>{
  for(const minimized of [false,true]) {
    const window=new WindowFixture();window.minimized=minimized;
    const answer={response:0};
    const result=await revealForDialog(window,async parent=>{
      assert.equal(parent,window);assert.equal(window.visible,true);
      assert.equal(window.minimized,false);assert.equal(window.focused,true);
      assert.deepEqual(window.calls,minimized?['restore','show','focus']:['show','focus']);
      return answer;
    });
    assert.equal(result,answer,'the native decision is preserved without auto-retry or discard');
  }
});

test('a failed save cancelled from the revealed window leaves the window and backend available',async()=>{
  const window=new WindowFixture();window.minimized=true;let closed=0;
  const close=createCloseCoordinator({flush:async()=>{throw Error('Save failed');},
    onFailure:async()=>{
      const result=await revealForDialog(window,async parent=>{
        assert.equal(parent,window);assert.equal(window.focused,true);return {response:0};
      });
      return result.response===0?'cancel':'discard';
    },close:async()=>{closed++;window.destroy();}});
  assert.equal(await close(),false);assert.equal(closed,0);
  assert.equal(window.destroyed,false);assert.equal(window.visible,true);assert.equal(window.minimized,false);
});

test('failure dialogs remain available without touching a closed or missing parent window',async()=>{
  const closed=new WindowFixture();closed.destroy();
  for(const window of [closed,null,undefined]) {
    let shown=0;
    assert.deepEqual(await revealForDialog(window,async parent=>{
      shown++;assert.equal(parent,undefined);return {response:0};
    }),{response:0});
    assert.equal(shown,1);
  }
  assert.deepEqual(closed.calls,[]);
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

test('the visible startup window can navigate to the product without replacing its native handle',async()=>{
  const window=new WindowFixture();
  const startupURL=startupPageURL();
  assert.match(startupURL,/^data:text\/html;charset=utf-8,/);
  const html=decodeURIComponent(startupURL.slice(startupURL.indexOf(',')+1));
  assert.match(html,/default-src 'none'/);
  assert.doesNotMatch(html,/<script\b|<iframe\b/i);
  const navigate=beginWindowSession(window);
  assert.equal(window.visible,true);
  const productURL='http://127.0.0.1:4317/?desktop=1';
  const loaded=navigate(productURL);
  window.load.resolve();
  await loaded;
  assert.deepEqual(window.urls,[startupURL,productURL]);
  assert.equal(window.visible,true);
  assert.equal(window.destroyed,false);
});
