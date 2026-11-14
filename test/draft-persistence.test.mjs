import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDraftPersistence} from '../public/draft-persistence.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=text=>({drafts:{chat:text},selected:'chat',layout:1,motion:'system'});

test('a rejected unchanged desktop draft remains retryable and is committed only after success',async()=>{
  let count=0;const states=[],errors=[];
  const store=createDraftPersistence({write:async value=>{assert.equal(value.drafts.chat,'keep me');if(++count===1)throw Error('Disk full');},onChange:value=>states.push(value),onError:error=>errors.push(error.message)});
  await store.persist(snapshot('keep me'));
  assert.equal(store.state().pending,true);assert.match(store.state().error.message,/Disk full/);
  await store.retry();
  assert.equal(count,2);assert.equal(store.state().pending,false);assert.equal(store.state().error,null);
  await store.persist(snapshot('keep me'));assert.equal(count,2);
  assert.deepEqual(errors,['Disk full']);assert.equal(states.at(-1).saving,false);
});

test('desktop saves are serialized, immutable, and coalesce typing during an earlier write',async()=>{
  const first=deferred(),second=deferred(),writes=[];
  const store=createDraftPersistence({write:value=>{writes.push(value);return writes.length===1?first.promise:second.promise;}});
  const draft=snapshot('first');const pending=store.persist(draft);await tick();
  draft.drafts.chat='mutated after submission';
  store.persist(snapshot('second'));store.persist(snapshot('latest'));await tick();
  assert.equal(writes.length,1);assert.equal(writes[0].drafts.chat,'first');
  first.resolve();await pending;await tick();
  assert.equal(writes.length,2);assert.equal(writes[1].drafts.chat,'latest');
  second.resolve();await tick();assert.equal(store.state().pending,false);
});

test('repeated renders do not spin on a failing unchanged write; a later save or explicit retry can recover',async()=>{
  let attempts=0,now=0;
  const store=createDraftPersistence({now:()=>now,write:async()=>{if(++attempts<2)throw Error('Temporary failure');}});
  await store.persist(snapshot('draft'));
  for(let i=0;i<10;i++)await store.persist(snapshot('draft'));
  assert.equal(attempts,1);now=1000;await store.persist(snapshot('draft'));
  assert.equal(attempts,2);assert.equal(store.state().pending,false);
});

test('close-time flush waits for the latest edit queued behind an earlier save',async()=>{
  const first=deferred(),second=deferred(),writes=[];
  const store=createDraftPersistence({write:value=>{writes.push(value.drafts.chat);return writes.length===1?first.promise:second.promise;}});
  store.persist(snapshot('first'));await tick();store.persist(snapshot('latest'));
  let flushed=false;const pending=store.flush().then(()=>{flushed=true;});
  first.resolve();await tick();assert.deepEqual(writes,['first','latest']);assert.equal(flushed,false);
  second.resolve();await pending;assert.equal(flushed,true);
});

test('close-time flush rejects an unsaved latest draft and can retry after recovery',async()=>{
  let fail=true;
  const store=createDraftPersistence({write:async()=>{if(fail)throw Error('Disk full');}});
  await store.persist(snapshot('keep this'));
  await assert.rejects(store.flush(),/Disk full/);
  fail=false;await store.flush();assert.equal(store.state().pending,false);
});

// Exercise the actual project-answer branch with a pending request. This is a
// local DOM/API fixture, not an AI execution or a backend/network request.
async function answerFixture({selected='chat',draft='answer',storageRemovalFails=false}={}){
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf("$('#composer').onsubmit = async event => {");
  const end=source.indexOf("$('#stop-btn').onclick",start);
  assert.ok(start>=0&&end>start);
  const pending=deferred(),composer={},prompt={value:draft},notices=[],calls=[];
  const context=vm.createContext({
    $:selector=>selector==='#composer'?composer:selector==='#prompt'?prompt:null,
    sendBlocked:false,pendingSends:new Set(),selected,drafts:{[selected]:draft},steerPending:false,
    chats:[{id:selected,project:{id:'project'}}],state:{projects:{items:[{id:'project',events:[{id:'question',conversationId:selected,kind:'question',status:'open'}]}]}},
    storeKey:'fixture',crypto:{randomUUID:()=> 'request-id'},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){if(storageRemovalFails)throw Error('Storage blocked');}},
    updateComposer(){},persist(){calls.push('persist');},projects:{render(){calls.push('render');}},
    toast:message=>notices.push(message),api:async(route,data)=>{calls.push({route,data});return pending.promise;}
  });
  vm.runInContext(source.slice(start,end),context);
  const response=composer.onsubmit({preventDefault(){}});
  return {context,prompt,pending,response,notices,calls};
}

test('successful project answer preserves a newer draft typed while the request is pending',async()=>{
  const f=await answerFixture();f.prompt.value='next question';f.context.drafts.chat='next question';
  f.pending.resolve({items:[]});await f.response;
  assert.equal(f.prompt.value,'next question');assert.equal(f.context.drafts.chat,'next question');assert.deepEqual(f.notices,[]);
});

test('project answer consumes only its original draft after switching to another conversation',async()=>{
  const f=await answerFixture();f.context.selected='other';f.context.drafts.other='other draft';f.prompt.value='other draft';
  f.pending.resolve({items:[]});await f.response;
  assert.equal(f.context.drafts.chat,'');assert.equal(f.context.drafts.other,'other draft');assert.equal(f.prompt.value,'other draft');
});

test('accepted project answer stays successful when browser storage cleanup fails',async()=>{
  const f=await answerFixture({storageRemovalFails:true});f.pending.resolve({items:[]});await f.response;
  assert.equal(f.context.drafts.chat,'');assert.equal(f.prompt.value,'');assert.deepEqual(f.notices,[]);assert.ok(f.calls.includes('persist'));assert.ok(f.calls.includes('render'));
});
