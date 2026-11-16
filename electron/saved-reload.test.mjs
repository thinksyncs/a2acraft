import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavedReload,createWindowStateFlusher} from './saved-reload.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function setup(overrides={}) {
  const events=[];
  const flush=createWindowStateFlusher({flushRenderer:async()=>events.push('renderer'),
    flushUi:async()=>events.push('ui'),flushMap:async()=>events.push('map')});
  const request=createSavedReload({canReload:()=>true,flush,reload:async()=>events.push('reload'),
    resume:async()=>events.push('resume'),onFailure:async stage=>events.push('failure:'+stage),...overrides});
  return {request,events,flush};
}

test('explicit reload waits for renderer drafts and both persisted stores',async()=>{
  const {request,events}=setup();
  assert.deepEqual(events,[],'constructing the menu cannot reload automatically');
  assert.equal(await request(),true);
  assert.deepEqual(events,['renderer','ui','map','reload']);
});

test('failure in any persistence stage keeps the page and resumes interaction before reporting it',async()=>{
  for(const failed of ['renderer','ui','map']) {
    const events=[];
    const write=stage=>async()=>{events.push(stage);if(stage===failed)throw Error('private-draft-or-path');};
    const flush=createWindowStateFlusher({flushRenderer:write('renderer'),flushUi:write('ui'),flushMap:write('map')});
    const request=createSavedReload({canReload:()=>true,flush,reload:()=>events.push('reload'),
      resume:()=>events.push('resume'),onFailure:(...args)=>{assert.deepEqual(args,['save']);events.push('failure');}});
    assert.equal(await request(),false);
    assert.deepEqual(events,[...['renderer','ui','map'].slice(0,['renderer','ui','map'].indexOf(failed)+1),'resume','failure']);
  }
});

test('an unacknowledged renderer flush never reaches reload, including after late completion',async()=>{
  const acknowledgement=deferred();let expired=false;
  const timeout=new Promise((_,reject)=>setTimeout(()=>{expired=true;reject(Error('flush timed out'));},5));
  const {request,events}=setup({flush:()=>Promise.race([acknowledgement.promise,timeout])});
  assert.equal(await request(),false);assert.equal(expired,true);
  acknowledgement.resolve();await tick();
  assert.deepEqual(events,['resume','failure:save']);
});

test('repeated menu requests share one save, reload and failure dialog, then allow retry',async()=>{
  const save=deferred(),dialog=deferred();let saves=0,reloads=0,prompts=0;
  const request=createSavedReload({canReload:()=>true,flush:()=>{saves++;return save.promise;},
    reload:()=>{reloads++;},resume:()=>{},onFailure:()=>{prompts++;return dialog.promise;}});
  const first=request(),second=request();assert.equal(first,second);
  save.reject(Error('save failed'));await tick();
  assert.equal(request(),first);assert.equal(saves,1);assert.equal(prompts,1);assert.equal(reloads,0);
  dialog.resolve();assert.equal(await first,false);
  assert.equal(await request(),false);assert.equal(saves,2);assert.equal(prompts,2);assert.equal(reloads,0);
});

test('close and reload share a pending flush instead of replacing the renderer acknowledgement',async()=>{
  const acknowledgement=deferred(),events=[];let closing=false;
  const flush=createWindowStateFlusher({flushRenderer:async()=>{events.push('renderer');await acknowledgement.promise;},
    flushUi:async()=>events.push('ui'),flushMap:async()=>events.push('map')});
  const request=createSavedReload({canReload:()=>!closing,flush,reload:()=>events.push('reload'),
    resume:()=>{if(!closing)events.push('resume');},onFailure:()=>events.push('failure')});
  const reload=request();closing=true;
  const closeSave=flush(),secondCloseSave=flush();assert.equal(closeSave,secondCloseSave);
  acknowledgement.resolve();await closeSave;
  assert.equal(await reload,false);assert.deepEqual(events,['renderer','ui','map']);
});

test('quitting or startup prevents reload before persistence, and closing during persistence also prevents reload',async()=>{
  const blocked=setup({canReload:()=>false});assert.equal(await blocked.request(),false);assert.deepEqual(blocked.events,[]);
  let allowed=true;const save=deferred();
  const later=setup({canReload:()=>allowed,flush:()=>save.promise});
  const result=later.request();allowed=false;save.resolve();
  assert.equal(await result,false);assert.deepEqual(later.events,['resume']);
});

test('a failed native reload preserves saved state and resumes the renderer without leaking its error',async()=>{
  const {request,events}=setup({reload:()=>{throw Error('private-native-failure');}});
  assert.equal(await request(),false);
  assert.deepEqual(events,['renderer','ui','map','resume','failure:reload']);
});

test('concurrent successful reload requests perform one reload and a later request saves fresh state',async()=>{
  const save=deferred();let calls=0;
  const {request,events}=setup({flush:()=>save.promise,reload:()=>{calls++;}});
  const first=request(),second=request();assert.equal(first,second);save.resolve();
  assert.equal(await first,true);assert.equal(calls,1);
  assert.equal(await request(),true);assert.equal(calls,2);assert.deepEqual(events,[]);
});
