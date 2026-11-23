import {ui} from '../public/interface-language.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createUiStateStore} from '../electron/ui-state-store.mjs';
import {createDraftPersistence,mergeRecoveredDrafts} from '../public/draft-persistence.js';
import {recoverSendDrafts} from '../public/send-delivery.js';

const snapshot=drafts=>({drafts,sendRequests:{},selected:'chat',layout:1,motion:'system'});

test('corrupt JSON or invalid saved draft state remains byte-for-byte unchanged through save and close',async()=>{
  for(const original of ['{"drafts":{"chat":"keep this"}',JSON.stringify({...snapshot({chat:'keep this'}),layout:99})]){
    let bytes=original,writes=0;
    const store=createUiStateStore({read:async()=>bytes,write:async value=>{writes++;bytes=value;}});
    await store.load();assert.match((await store.read()).loadError,/元のデータを保護/);
    await assert.rejects(store.save(snapshot({chat:'new draft'})),/元のデータを保護/);
    await assert.rejects(store.flush(),/元のデータを保護/);
    assert.equal(writes,0);assert.equal(bytes,original);
  }
});

test('permission and I/O read errors block replacement; only a missing file permits initial save',async()=>{
  for(const code of ['EACCES','EIO']){
    let writes=0;
    const store=createUiStateStore({read:async()=>{throw Object.assign(Error('unreadable'),{code});},write:async()=>{writes++;}});
    assert.ok((await store.read()).loadError);
    await assert.rejects(store.save(snapshot({chat:'new'})));await assert.rejects(store.flush());assert.equal(writes,0);
  }
  let saved;
  const fresh=createUiStateStore({read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},write:async value=>{saved=JSON.parse(value);}});
  assert.equal((await fresh.read()).layout,1);await fresh.save(snapshot({chat:'new'}));assert.equal(saved.drafts.chat,'new');
});

test('an explicit reread after file repair recovers saved data without writing over it',async()=>{
  let bytes='{invalid',writes=0;
  const store=createUiStateStore({read:async()=>bytes,write:async value=>{writes++;bytes=value;}});
  assert.ok((await store.read()).loadError);
  bytes=JSON.stringify(snapshot({chat:'saved text',other:'another saved draft'}));const repaired=bytes;
  const recovered=await store.read();assert.equal(recovered.loadError,undefined);assert.equal(recovered.drafts.chat,'saved text');
  assert.equal(writes,0);assert.equal(bytes,repaired);
  await store.save(mergeRecoveredDrafts(recovered,snapshot({chat:'new text'})));
  assert.equal(JSON.parse(bytes).drafts.chat,'saved text\n\nnew text');assert.equal(JSON.parse(bytes).drafts.other,'another saved draft');
});

test('a failed disk write retains the latest in-memory draft instead of rereading older disk state',async()=>{
  let fail=true;const old=JSON.stringify(snapshot({chat:'old'}));let bytes=old;
  const store=createUiStateStore({read:async()=>bytes,write:async value=>{if(fail)throw Error('Disk full');bytes=value;}});
  await store.load();await assert.rejects(store.save(snapshot({chat:'latest'})),/Disk full/);
  assert.equal((await store.read()).drafts.chat,'latest');assert.equal(bytes,old);
  fail=false;await store.flush();assert.equal(JSON.parse(bytes).drafts.chat,'latest');
});

test('draft recovery combines saved and current drafts without duplicating or dropping either',()=>{
  const saved=snapshot({chat:'saved',other:'other'}),current=snapshot({chat:'new',empty:''});
  const merged=mergeRecoveredDrafts(saved,current);
  assert.deepEqual(merged.drafts,{chat:'saved\n\nnew',other:'other'});
  assert.deepEqual(mergeRecoveredDrafts(saved,merged).drafts,merged.drafts);
});

async function bootFixture(getUiState){
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function boot() {'),end=source.indexOf('\nfunction subscribeEvents()',start);assert.ok(start>=0&&end>start);
  const prompt={value:''},errors=[],calls=[];
  const context=vm.createContext({ui, 
    desktop:{getUiState},demo:false,desktopDraftReadError:null,showDraftSaveError:error=>errors.push(error.message),
    drafts:{chat:'local buffer'},sendRequests:{},selected:'chat',layout:1,motionPreference:'system',applyMotion(){},
    subscribeEvents(){calls.push('subscribe');},fetch:async()=>{calls.push('history');return {ok:true,json:async()=>({conversations:[{id:'chat',messages:[]}],attachmentDrafts:[]})};},
    state:{},chats:[],contextBoard:[],attachments:{hydrate(){}},recoverSendDrafts,persist(){calls.push('persist');},
    historyLoaded:false,historyLoadError:'',projectSample:false,subagentSample:false,
    $:()=>prompt,updateState(){},renderChats(){calls.push('render');}
  });
  vm.runInContext(source.slice(start,end),context);await context.boot();
  return {context,prompt,errors,calls};
}

test('actual boot continues loading conversation history when saved drafts cannot be read',async()=>{
  for(const getUiState of [async()=>({...snapshot({}),loadError:'Protected draft file'}),async()=>{throw Error('IPC read failed');}]){
    const f=await bootFixture(getUiState);
    assert.equal(f.context.historyLoaded,true);assert.equal(f.context.chats[0].id,'chat');
    assert.equal(f.context.drafts.chat,'local buffer');assert.equal(f.prompt.value,'local buffer');
    assert.ok(f.context.desktopDraftReadError);assert.equal(f.errors.length,1);assert.ok(f.calls.includes('history'));assert.ok(f.calls.includes('render'));
  }
});

test('actual read-retry preserves new typing, merges repaired drafts, and only then resumes saving',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function retryDesktopDrafts(){'),end=source.indexOf('\nlet closeFocus=',start);assert.ok(start>=0&&end>start);
  let bytes='{broken',writes=0;
  const store=createUiStateStore({read:async()=>bytes,write:async value=>{bytes=value;writes++;}});await store.load();
  const prompt={value:'new typing'},errors=[];let context;
  const writer=createDraftPersistence({write:async value=>{if(context.desktopDraftReadError)throw context.desktopDraftReadError;return store.save(value);}});
  context=vm.createContext({ui, 
    desktopDraftReadError:Error('Protected draft file'),desktopDraftReloading:false,desktopDrafts:writer,
    desktop:{getUiState:()=>store.read()},draftSaveRetry:{},document:{body:{inert:false},activeElement:{focus(){}}},
    drafts:{chat:'new typing'},sendRequests:{},chats:[{id:'chat',messages:[]}],selected:'chat',layout:1,motionPreference:'system',
    recoverSendDrafts,mergeRecoveredDrafts,$:()=>prompt,renderChats(){},showDraftSaveError:error=>errors.push(error.message),
    persist(){writer.persist(snapshot(context.drafts));}
  });
  vm.runInContext(source.slice(start,end),context);
  await context.retryDesktopDrafts();assert.equal(writes,0);assert.equal(bytes,'{broken');assert.equal(context.document.body.inert,false);
  bytes=JSON.stringify(snapshot({chat:'saved typing',other:'saved other'}));
  await context.retryDesktopDrafts();
  assert.equal(context.desktopDraftReadError,null);assert.equal(prompt.value,'saved typing\n\nnew typing');
  assert.equal(JSON.parse(bytes).drafts.chat,prompt.value);assert.equal(JSON.parse(bytes).drafts.other,'saved other');
  assert.equal(context.document.body.inert,false);assert.equal(errors.length,1);assert.equal(writes,1);
});
