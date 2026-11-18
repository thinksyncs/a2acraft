import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWindowDiagnostics} from './window-diagnostics.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const forbidden=()=>{throw Error('Renderer content must never be queried');};
class WindowFixture extends EventEmitter {
  constructor(id=7) {
    super();this.id=id;this.destroyed=false;this.visible=true;this.minimized=false;
    this.focused=true;this.fullScreen=false;
    this.webContents=Object.assign(new EventEmitter(),{
      destroyed:false,loading:false,crashed:false,
      isDestroyed(){return this.destroyed;},isLoadingMainFrame(){return this.loading;},isCrashed(){return this.crashed;},
      getURL:forbidden,getTitle:forbidden,executeJavaScript:forbidden,capturePage:forbidden
    });
  }
  isDestroyed(){return this.destroyed;}
  isVisible(){return this.visible;}
  isMinimized(){return this.minimized;}
  isFocused(){return this.focused;}
  isFullScreen(){return this.fullScreen;}
  getBounds(){return {x:12,y:32,width:1560,height:1060,privateField:'never-record'};}
}
function setup(overrides={}) {
  const window=new WindowFixture(),reports=[],dialogs=[];
  const diagnostics=createWindowDiagnostics({getWindow:()=>window,version:'0.4.8',
    now:()=>new Date('2026-11-16T01:02:03Z'),logPath:'/sample/logs/window-diagnostics.json',
    writeReport:async report=>reports.push(report),present:async(parent,options)=>dialogs.push({parent,options}),...overrides});
  diagnostics.observe(window);
  return {window,reports,dialogs,diagnostics};
}

test('native state and lifecycle events are observable without inspecting renderer content',()=>{
  const {window,diagnostics,reports}=setup();
  window.minimized=true;window.visible=false;window.focused=false;
  window.webContents.loading=true;window.webContents.emit('did-start-loading');
  window.emit('unresponsive');
  const loading=diagnostics.snapshot();
  assert.deepEqual(loading.window,{electronId:7,destroyed:false,visible:false,minimized:true,focused:false,fullScreen:false,
    bounds:{x:12,y:32,width:1560,height:1060},workArea:null,fullyWithinWorkArea:null});
  assert.deepEqual(loading.renderer,{destroyed:false,loading:true,crashed:false,loadState:'loading',responsiveness:'unresponsive',lastErrorCode:null});
  window.webContents.loading=false;window.webContents.emit('did-finish-load');window.emit('responsive');
  const loaded=diagnostics.snapshot();
  assert.equal(loaded.renderer.loadState,'loaded');assert.equal(loaded.renderer.responsiveness,'responsive');
  assert.equal(loaded.renderer.loading,false);assert.equal(loaded.appVersion,'0.4.8');
  assert.deepEqual(loaded.events.map(event=>event.event),['created','loading','unresponsive','loaded','responsive']);
  assert.equal(reports.length,0,'observing state must not persist a report automatically');
});

test('load diagnostics retain only the main-frame error number and bound lifecycle history',()=>{
  const {window,diagnostics}=setup(),contents=window.webContents;
  contents.emit('did-fail-load',{},-3,'private-abort','https://private.example/?token=secret',true);
  contents.emit('did-fail-load',{},-102,'private-frame','https://private.example/frame',false);
  assert.equal(diagnostics.snapshot().renderer.loadState,'created');
  contents.emit('did-fail-load',{},-102,'private-failure','https://private.example/?token=secret',true);
  assert.equal(diagnostics.snapshot().renderer.lastErrorCode,-102);
  contents.emit('render-process-gone',{}, {reason:'private-reason',exitCode:73});
  assert.equal(diagnostics.snapshot().renderer.loadState,'renderer-gone');
  for(let i=0;i<32;i++)window.emit('focus','private-title');
  const report=diagnostics.snapshot();
  assert.equal(report.events.length,24);assert.ok(report.events[0].sequence>1);
  assert.doesNotMatch(JSON.stringify(report),/private|token|secret|never-record/);
  report.events[0].event='changed-by-caller';
  assert.equal(diagnostics.snapshot().events[0].event,'focus');
});

test('destroyed windows and unavailable native methods produce a structural report safely',()=>{
  const {window,diagnostics}=setup();
  window.isVisible=()=>{throw Error('private-os-error');};
  window.getBounds=()=>({x:Infinity,y:4,width:'private',height:10});
  window.webContents.isCrashed=()=>{throw Error('private-renderer-error');};
  assert.equal(diagnostics.snapshot().window.visible,null);
  assert.deepEqual(diagnostics.snapshot().window.bounds,{x:null,y:4,width:null,height:10});
  assert.equal(diagnostics.snapshot().renderer.crashed,null);
  window.destroyed=true;
  window.isMinimized=forbidden;window.getBounds=forbidden;
  window.emit('closed');
  const report=diagnostics.snapshot();
  assert.equal(report.window.destroyed,true);assert.equal(report.window.electronId,null);
  assert.equal(report.renderer.destroyed,true);assert.equal(report.renderer.loadState,'closed');
  assert.equal(window.listenerCount('responsive'),0);assert.equal(window.webContents.listenerCount('did-finish-load'),0);
});

test('observing a replacement window detaches the old window and resets renderer state',()=>{
  let current;
  const {window,diagnostics}=setup({getWindow:()=>current});current=window;
  window.emit('unresponsive');
  current=new WindowFixture(9);diagnostics.observe(current);
  window.emit('responsive');window.webContents.emit('did-start-loading');
  const report=diagnostics.snapshot();
  assert.equal(report.window.electronId,9);assert.equal(report.renderer.loadState,'created');
  assert.equal(report.renderer.responsiveness,'unknown');
  assert.equal(window.listenerCount('responsive'),0);assert.equal(window.webContents.listenerCount('did-start-loading'),0);
});

test('explicit diagnostics save the state before the native dialog changes focus',async()=>{
  let observed;
  const {window,diagnostics,reports}=setup({present:async(parent,options)=>{
    observed={parent,options};window.focused=false;
  }});
  const result=await diagnostics.show();
  assert.equal(result.saved,'saved');assert.equal(reports.length,1);
  assert.equal(result.report.window.focused,true);assert.equal(window.focused,false);
  assert.equal(observed.parent,window);assert.equal(observed.options.title,'表示の診断');
  assert.match(observed.options.detail,/ウィンドウID: 7/);
  assert.match(observed.options.detail,/応答の通知: 未検出/);
  assert.match(observed.options.detail,/保存先: \/sample\/logs\/window-diagnostics.json/);
  assert.doesNotMatch(JSON.stringify(reports),/URL|session|cookie|chat|never-record/);
});

test('a stalled or failed report write cannot prevent the native diagnostic dialog',async()=>{
  const stalled=setup({writeReport:()=>new Promise(()=>{}),timeoutMs:5});
  const result=await stalled.diagnostics.show();
  assert.equal(result.saved,'timed-out');assert.equal(stalled.dialogs.length,1);
  assert.match(stalled.dialogs[0].options.detail,/時間内に完了しませんでした/);
  const failed=setup({writeReport:()=>{throw Error('private-path-with-secret');}});
  assert.equal((await failed.diagnostics.show()).saved,'failed');
  assert.match(failed.dialogs[0].options.detail,/保存できませんでした/);
  assert.doesNotMatch(JSON.stringify(failed.dialogs[0].options),/private-path|secret/);
});

test('repeated menu activation coalesces an open native dialog and permits the next request after dismissal',async()=>{
  let closeDialog,calls=0;
  const {diagnostics,reports}=setup({present:()=>{calls++;return new Promise(resolve=>{closeDialog=resolve;});}});
  const first=diagnostics.show(),second=diagnostics.show();
  assert.equal(first,second);await tick();assert.equal(calls,1);assert.equal(reports.length,1);
  closeDialog();await first;
  const next=diagnostics.show();await tick();assert.equal(calls,2);assert.equal(reports.length,2);
  closeDialog();await next;
});

test('diagnostics remain available before a main window exists',async()=>{
  const {diagnostics,dialogs}=setup({getWindow:()=>undefined,version:'private-version'});
  const {report}=await diagnostics.show();
  assert.equal(report.appVersion,'unknown');assert.equal(report.window.destroyed,true);
  assert.equal(dialogs[0].parent,undefined);assert.doesNotMatch(dialogs[0].options.detail,/private-version/);
});

test('own-display geometry distinguishes clipped windows and is captured before dialog recovery',async()=>{
  let bounds={x:166,y:494,width:1440,height:789},receivedWindow;
  const area={x:0,y:30,width:1440,height:870,id:'never-record-display',scaleFactor:2};
  const {window,diagnostics,reports,dialogs}=setup({
    getWorkArea:target=>{receivedWindow=target;return area;},
    present:async(parent,options)=>{
      // The main process fits the owned parent at this point, after snapshot.
      bounds={x:0,y:111,width:1440,height:789};dialogs.push({parent,options});
    }
  });
  window.getBounds=()=>({...bounds});
  const result=await diagnostics.show();
  assert.equal(receivedWindow,window);
  assert.deepEqual(result.report.window.workArea,{x:0,y:30,width:1440,height:870});
  assert.equal(result.report.window.fullyWithinWorkArea,false);
  assert.deepEqual(reports[0].window.bounds,{x:166,y:494,width:1440,height:789});
  assert.equal(diagnostics.snapshot().window.fullyWithinWorkArea,true);
  assert.match(dialogs[0].options.detail,/画面の作業領域: 0, 30 \/ 1440 × 870/);
  assert.match(dialogs[0].options.detail,/ウィンドウ全体が作業領域内: いいえ/);
  assert.doesNotMatch(JSON.stringify(result.report),/never-record-display|scaleFactor/);
});

test('own-display containment supports negative coordinates and checks every edge',()=>{
  const area={x:-1920,y:-1050,width:1920,height:1080};
  const {window,diagnostics}=setup({getWorkArea:()=>area});
  let bounds={...area};window.getBounds=()=>({...bounds});
  assert.equal(diagnostics.snapshot().window.fullyWithinWorkArea,true);
  for(const outside of [{...area,x:area.x-1},{...area,y:area.y-1},
    {...area,width:area.width+1},{...area,height:area.height+1}]) {
    bounds=outside;assert.equal(diagnostics.snapshot().window.fullyWithinWorkArea,false);
  }
});

test('missing or invalid work-area metadata remains unknown without leaking provider values',()=>{
  const area={x:0,y:30,width:1440,height:870};
  for(const value of [null,{}, {...area,x:Infinity},{...area,y:1.5},{...area,width:0},
    {...area,height:'private-height'},{...area,height:-1}]) {
    const {diagnostics}=setup({getWorkArea:()=>value});
    const report=diagnostics.snapshot();
    assert.equal(report.window.workArea,null);assert.equal(report.window.fullyWithinWorkArea,null);
    assert.doesNotMatch(JSON.stringify(report),/private-height/);
  }
  const {diagnostics}=setup({getWorkArea:()=>{throw Error('private-display-error');}});
  assert.equal(diagnostics.snapshot().window.workArea,null);
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()),/private-display-error/);
  const invalidBounds=setup({getWorkArea:()=>area});
  invalidBounds.window.getBounds=()=>({x:0,y:30,width:NaN,height:400});
  assert.equal(invalidBounds.diagnostics.snapshot().window.fullyWithinWorkArea,null);
});

test('work-area provider is never called for a missing or destroyed window',()=>{
  let calls=0;const provider=()=>{calls++;return {x:0,y:0,width:1440,height:900};};
  const {window,diagnostics}=setup({getWorkArea:provider});
  window.destroyed=true;
  assert.equal(diagnostics.snapshot().window.workArea,null);
  const missing=setup({getWindow:()=>undefined,getWorkArea:provider});
  assert.equal(missing.diagnostics.snapshot().window.workArea,null);
  assert.equal(missing.diagnostics.snapshot().window.fullyWithinWorkArea,null);
  assert.equal(calls,0);
});
