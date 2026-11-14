import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {waitForBackendReady,stopOwnedChild,processDiagnostic,createRuntimeRecovery} from './runtime-recovery.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function childFixture({exits=true}={}){
  const child=new EventEmitter();
  Object.assign(child,{pid:42,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough(),signals:[]});
  child.kill=signal=>{
    child.signals.push(signal);
    if(exits||signal==='SIGKILL')queueMicrotask(()=>{child.signalCode=signal;child.emit('exit',null,signal);});
    return true;
  };
  return child;
}

test('backend drains both pipes before ready and removes startup listeners after a valid loopback handshake',async()=>{
  const child=childFixture(),ready=waitForBackendReady(child);
  child.stdout.write(Buffer.alloc(128*1024));child.stderr.write(Buffer.alloc(128*1024));
  await tick();
  assert.equal(child.stdout.readableLength,0);assert.equal(child.stderr.readableLength,0);
  child.emit('message',{type:'ready',port:4317,origin:'https://unrelated.example'});
  assert.equal(child.listenerCount('message'),1);
  child.emit('message',{type:'ready',port:4317,origin:'http://127.0.0.1:4317'});
  assert.equal((await ready).port,4317);
  for(const event of ['message','exit','error'])assert.equal(child.listenerCount(event),0);
  assert.deepEqual(child.signals,[]);
});

test('startup timeout stops only the passed child and cleans up even if it needs a forceful stop',async()=>{
  const owned=childFixture({exits:false}),unrelated=childFixture();
  await assert.rejects(waitForBackendReady(owned,{timeoutMs:5,stopOptions:{graceMs:5}}),error=>{
    assert.match(error.publicDiagnostic,/timeout=5ms/);return true;
  });
  assert.deepEqual(owned.signals,['SIGTERM','SIGKILL']);assert.deepEqual(unrelated.signals,[]);
  for(const event of ['message','exit','error'])assert.equal(owned.listenerCount(event),0);
});

test('startup timeout reports only the latest allowlisted progress identifier',async()=>{
  const child=childFixture(),ready=waitForBackendReady(child,{timeoutMs:10});
  child.emit('message',{type:'startup-progress',stage:'history'});
  child.emit('message',{type:'startup-progress',stage:'world-layout',path:'/private/never-print',account:'never-print-account'});
  child.emit('message',{type:'startup-progress',stage:'Bearer never-print-secret'});
  child.emit('message',{type:'startup-progress',stage:{toString(){return 'never-print-object';}}});
  await assert.rejects(ready,error=>{
    assert.match(error.publicDiagnostic,/stage=world-layout$/);
    assert.doesNotMatch(error.publicDiagnostic,/private|never-print|Bearer|account/);return true;
  });
  for(const event of ['message','exit','error'])assert.equal(child.listenerCount(event),0);
  const early=childFixture();
  await assert.rejects(waitForBackendReady(early,{timeoutMs:5}),error=>/stage=bootstrap$/.test(error.publicDiagnostic));
});

test('startup and spawn diagnostics exclude payloads and retain only process status',async()=>{
  const child=childFixture(),ready=waitForBackendReady(child);
  child.emit('message',{type:'startup-error',code:'EACCES',message:'Bearer never-print-this-secret'});
  await assert.rejects(ready,error=>{
    assert.match(error.publicDiagnostic,/code=EACCES/);
    assert.doesNotMatch(error.publicDiagnostic,/Bearer|secret/);return true;
  });
  const failed=childFixture();failed.pid=undefined;
  const failure=waitForBackendReady(failed);
  failed.emit('error',Object.assign(Error('never-print-this-path'),{code:'ENOENT'}));
  await assert.rejects(failure,error=>{
    assert.match(error.publicDiagnostic,/code=ENOENT/);assert.doesNotMatch(error.publicDiagnostic,/never-print/);return true;
  });
  assert.equal(processDiagnostic({code:'arbitrary secret',signal:'SIGTERM'}),'code=unknown, signal=SIGTERM');
  const exited=childFixture();exited.exitCode=2;
  await stopOwnedChild(exited);assert.deepEqual(exited.signals,[]);
});

test('simultaneous renderer and backend failures share one explicit restart choice',async()=>{
  const choice=deferred(),shown=[],closed=[];
  const report=createRuntimeRecovery({present:detail=>{shown.push(detail);return choice.promise;},close:async restart=>{closed.push(restart);return true;}});
  const first=report('load failed'),second=report('backend exited');
  assert.equal(first,second);assert.equal(shown.length,1);assert.deepEqual(closed,[]);
  choice.resolve(0);assert.equal(await first,true);assert.deepEqual(closed,[true]);
});

test('recovery quit does not queue a restart and cancelled close allows a later recovery',async()=>{
  const closed=[];let attempts=0;
  const report=createRuntimeRecovery({present:async()=>1,close:async restart=>{closed.push(restart);return ++attempts>1;}});
  assert.equal(await report('first'),false);assert.equal(await report('retry'),true);
  assert.deepEqual(closed,[false,false]);
});
