import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createUiStateWriter} from '../electron/ui-state-writer.mjs';
import {createCloseCoordinator} from '../electron/close-coordinator.mjs';
import {validateUiState} from '../electron/security.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('desktop writer retries a rejected snapshot without losing later state',async()=>{
  let state='latest',count=0;const writes=[];
  const writer=createUiStateWriter(async snapshot=>{writes.push(snapshot);if(++count===1)throw Error('Disk full');});
  await assert.rejects(writer.save('earlier'),/Disk full/);
  await writer.flush(()=>state);
  assert.deepEqual(writes,['earlier','latest']);
  await writer.flush(()=>state);assert.equal(writes.length,2);
});

test('desktop close flush drains edits received during an atomic write in order',async()=>{
  const first=deferred(),writes=[];let state='first';
  const writer=createUiStateWriter(async snapshot=>{writes.push(snapshot);if(writes.length===1)await first.promise;});
  const pending=writer.flush(()=>state);await tick();
  state='latest';first.resolve();await pending;
  assert.deepEqual(writes,['first','latest']);
});

test('failed save and return keep the app and backend open; a later close can recover',async()=>{
  let fail=true,closed=0,prompts=0;
  const requestClose=createCloseCoordinator({flush:async()=>{if(fail)throw Error('Disk full');},onFailure:async()=>{prompts++;return 'cancel';},close:async()=>{closed++;}});
  assert.equal(await requestClose(),false);assert.equal(prompts,1);assert.equal(closed,0);
  fail=false;assert.equal(await requestClose(),true);assert.equal(closed,1);
});

test('retry does not stop the backend before the retried save succeeds',async()=>{
  const events=[];let attempts=0;
  const requestClose=createCloseCoordinator({
    flush:async()=>{events.push('save');if(++attempts===1)throw Error('Disk full');events.push('saved');},
    onFailure:async()=>{events.push('retry');return 'retry';},
    close:async()=>{events.push('stop-backend');events.push('exit');}
  });
  assert.equal(await requestClose(),true);
  assert.deepEqual(events,['save','retry','save','saved','stop-backend','exit']);
});

test('only explicit discard can close after a failed save',async()=>{
  let closed=0;
  const requestClose=createCloseCoordinator({flush:async()=>{throw Error('Disk full');},onFailure:async()=> 'discard',close:async()=>{closed++;}});
  assert.equal(await requestClose(),true);assert.equal(closed,1);
});

test('concurrent native close and menu quit share a single pending save dialog',async()=>{
  const answer=deferred();let prompts=0,closed=0;
  const requestClose=createCloseCoordinator({flush:async()=>{throw Error('Disk full');},onFailure:async()=>{prompts++;return answer.promise;},close:async()=>{closed++;}});
  const first=requestClose(),second=requestClose();assert.equal(first,second);await tick();assert.equal(prompts,1);
  answer.resolve('cancel');await first;assert.equal(closed,0);
});

test('preload acknowledges renderer save failure and resumes the renderer when close is cancelled',async()=>{
  const source=await readFile(new URL('../electron/preload.cjs',import.meta.url),'utf8');
  const listeners=new Map(),calls=[];let desktop;
  const ipcRenderer={
    invoke:async(name,value)=>{calls.push({name,value});},
    on:(name,callback)=>listeners.set(name,callback),
    removeListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);}
  };
  vm.runInNewContext(source,{require:()=>({ipcRenderer,contextBridge:{exposeInMainWorld:(_name,value)=>{desktop=value;}}}),process:{platform:'darwin',versions:{electron:'fixture'}}});
  const states=[];
  const unsubscribe=desktop.onBeforeClose(async closing=>{states.push(closing);if(closing)throw Error('Disk full');});
  await listeners.get('ui:flush')({notExposed:true},'request-id');
  assert.deepEqual(states,[true]);assert.equal(calls[0].name,'ui:flush-ready');
  assert.equal(calls[1].name,'ui:flush-complete');assert.equal(calls[1].value.id,'request-id');assert.equal(calls[1].value.error,'Disk full');
  listeners.get('ui:close-cancelled')();await tick();assert.deepEqual(states,[true,false]);
  unsubscribe();assert.equal(listeners.size,0);
});

const validState=()=>({drafts:{chat:'draft'},sendRequests:{chat:{requestId:'123-request',fingerprint:'{"text":"draft"}'}},selected:'chat',layout:1,motion:'system'});

test('desktop state retains pending send identity across serialization and accepts older saved drafts',()=>{
  const value=validState();value.sendRequests.chat.restoredDraft='draft';assert.deepEqual(validateUiState(JSON.parse(JSON.stringify(value))),value);
  delete value.sendRequests;assert.deepEqual(validateUiState(value).sendRequests,{});
});

test('pending send state rejects oversized or malformed entries and shares the aggregate storage bound',()=>{
  for(const request of [null,[],{requestId:'bad request',fingerprint:'ok'},{requestId:'ok',fingerprint:'x'.repeat(70001)},{requestId:'ok',fingerprint:'ok',restoredDraft:'x'.repeat(65537)}]){
    const state=validState();state.sendRequests.chat=request;assert.throws(()=>validateUiState(state),/Invalid (pending send|recovered draft)/);
  }
  const state=validState();state.sendRequests=Object.fromEntries(Array.from({length:129},(_,i)=>['chat'+i,{requestId:'ok',fingerprint:'ok'}]));
  assert.throws(()=>validateUiState(state),/Too many/);
  state.sendRequests=Object.fromEntries(Array.from({length:16},(_,i)=>['chat'+i,{requestId:'ok',fingerprint:'x'.repeat(70000)}]));
  assert.throws(()=>validateUiState(state),/1 MB/);
  state.sendRequests=JSON.parse('{"__proto__":{"requestId":"ok","fingerprint":"ok"}}');
  assert.throws(()=>validateUiState(state),/Invalid pending send/);
});
