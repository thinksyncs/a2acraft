import {ui} from '../public/interface-language.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDraftPersistence} from '../public/draft-persistence.js';
import {requestForSend,sendWasAccepted,restoreSendDraft} from '../public/send-delivery.js';
import {validateUiState} from '../electron/security.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the actual submit handler with a local DOM and in-memory API. No
// backend, model, shell, account, or external network is used by this fixture.
async function fixture({write,files=[]}={}){
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf("$('#composer').onsubmit = async event => {");
  const end=source.indexOf("$('#stop-btn').onclick",start);assert.ok(start>=0&&end>start);
  const pending=deferred(),composer={},prompt={value:'original'},calls=[],notices=[],restores=[],snapshots=[];
  const server={conversations:[{id:'chat',status:'idle',messages:[]}]};
  let context,sequence=0,fetchCount=0;
  const desktopDrafts=write?createDraftPersistence({write}):null;
  context=vm.createContext({ui, 
    $:selector=>({'#composer':composer,'#prompt':prompt,'#model':{value:'model'},'#effort':{value:'medium'}})[selector],
    residentVisitForChat:()=>null,
    demo:false,sendBlocked:false,pendingSends:new Set(),selected:'chat',drafts:{chat:'original'},sendRequests:{},steerPending:false,
    chats:[{id:'chat',status:'idle',messages:[]}],state:{policy:{ok:true}},desktopDrafts,
    requestForSend:(...args)=>requestForSend(...args,()=> 'request-'+(++sequence)),sendWasAccepted,restoreSendDraft,
    attachments:{take:()=>files,restore:(id,value)=>restores.push({id,files:value})},
    updateComposer(){},renderChats(){},scrollChatLatest(){},updateState(){},
    persist(){const value=JSON.parse(JSON.stringify({drafts:context.drafts,sendRequests:context.sendRequests,selected:context.selected,layout:1,motion:'system'}));snapshots.push(value);desktopDrafts?.persist(value);},
    toast:message=>notices.push(message),
    api:async(route,data)=>{calls.push({route,data});return pending.promise;},
    fetch:async()=>{fetchCount++;return {ok:true,json:async()=>JSON.parse(JSON.stringify(server))};}
  });
  vm.runInContext(source.slice(start,end),context);
  return {context,prompt,pending,calls,notices,restores,snapshots,server,desktopDrafts,fetchCount:()=>fetchCount,submit:()=>composer.onsubmit({preventDefault(){}})};
}

test('resident visits reach the API and durable retry identity with the submitted formation',async()=>{
  const f=await fixture(),visit={source:'village',partyKey:'current-party'};
  f.context.residentVisitForChat=id=>id==='chat'?visit:null;
  const response=f.submit();await tick();
  assert.deepEqual(f.calls[0].data.residentVisit,visit);
  assert.deepEqual(JSON.parse(f.context.sendRequests.chat.fingerprint).residentVisit,visit);
  f.pending.resolve({ok:true});await response;
});

test('lost HTTP acknowledgement recognizes a text-only receipt without restoring it over a newer draft',async()=>{
  const f=await fixture(),response=f.submit();await tick();
  assert.equal(f.calls.length,1);const id=f.calls[0].data.requestId;
  f.context.drafts.chat='next question';f.prompt.value='next question';
  f.server.conversations[0].messages.push({role:'user',text:'original',delivery:{requestId:id}});
  f.pending.reject(Error('Lost response'));await response;
  assert.equal(f.context.drafts.chat,'next question');assert.equal(f.prompt.value,'next question');
  assert.equal(Object.keys(f.context.sendRequests).length,0);assert.equal(f.restores.length,0);assert.equal(f.fetchCount(),1);
  assert.match(f.notices[0],/受け付けられています/);assert.equal(f.calls.length,1);
});

test('an unaccepted request restores its text before newer typing and records exactly what recovery inserted',async()=>{
  const f=await fixture(),response=f.submit();await tick();
  f.context.drafts.chat='next question';f.prompt.value='next question';
  f.pending.reject(Error('Not accepted'));await response;
  assert.equal(f.context.drafts.chat,'original\n\nnext question');assert.equal(f.prompt.value,'original\n\nnext question');
  assert.equal(f.context.sendRequests.chat.restoredDraft,'original\n\nnext question');assert.equal(f.calls.length,1);
});

test('disk failure stops before dispatch, preserves attachments and draft, and retries with the same identity after recovery',async()=>{
  let fail=true,writes=0;
  const f=await fixture({files:[{id:'attachment'}],write:async()=>{writes++;if(fail)throw Error('Disk full');}});
  await f.submit();
  assert.equal(f.calls.length,0);assert.equal(f.fetchCount(),0);assert.equal(f.context.chats[0].status,'idle');
  assert.equal(f.prompt.value,'original');assert.equal(f.context.drafts.chat,'original');assert.equal(f.restores[0].files[0].id,'attachment');
  const originalId=f.context.sendRequests.chat.requestId;
  fail=false;const response=f.submit();await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].data.requestId,originalId);assert.ok(writes>=2);
  f.pending.resolve({ok:true});await response;
  assert.equal(f.context.drafts.chat,'');assert.equal(Object.keys(f.context.sendRequests).length,0);
});

test('typing during a slow desktop save is preserved and saved before request dispatch',async()=>{
  const first=deferred(),writes=[];
  const f=await fixture({write:async value=>{writes.push(value);if(writes.length===1)await first.promise;}});
  const response=f.submit();await tick();assert.equal(f.calls.length,0);
  f.context.drafts.chat='next question';f.prompt.value='next question';f.context.persist();
  first.resolve();await tick();assert.equal(f.calls.length,1);assert.equal(writes.at(-1).drafts.chat,'next question');
  f.pending.resolve({ok:true});await response;
  assert.equal(f.prompt.value,'next question');assert.equal(f.context.drafts.chat,'next question');
});

test('send failure in a background conversation does not replace the selected conversation draft',async()=>{
  const f=await fixture(),response=f.submit();await tick();
  f.context.selected='other';f.context.drafts.other='other draft';f.prompt.value='other draft';
  f.pending.reject(Error('Not accepted'));await response;
  assert.equal(f.context.drafts.chat,'original');assert.equal(f.context.drafts.other,'other draft');assert.equal(f.prompt.value,'other draft');
});

test('a second send cannot overwrite a pending identity when a running update arrives before the first HTTP response',async()=>{
  const f=await fixture(),response=f.submit();await tick();
  const firstId=f.context.sendRequests.chat.requestId;
  f.context.chats[0].status='running';f.context.chats[0].turnId='turn';f.context.drafts.chat='next';f.prompt.value='next';
  await f.submit();assert.equal(f.calls.length,1);assert.equal(f.context.sendRequests.chat.requestId,firstId);assert.equal(f.prompt.value,'next');
  f.pending.resolve({ok:true});await response;assert.equal(f.context.pendingSends.size,0);assert.equal(f.context.drafts.chat,'next');
});

test('visiting more than 128 chats does not let empty draft entries block the next real draft save',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function persist() {'),end=source.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);
  const drafts=Object.fromEntries(Array.from({length:150},(_,i)=>['chat-'+i,'']));drafts.current='keep me';let saved;
  vm.runInNewContext(source.slice(start,end)+'\npersist();',{
    drafts,sendRequests:{},selected:'current',layout:1,motionPreference:'system',storeKey:'fixture',
    localStorage:{setItem(){}},desktopDrafts:{persist:value=>{saved=validateUiState(value);}}
  });
  assert.deepEqual(saved.drafts,{current:'keep me'});assert.equal(drafts.current,'keep me');
});
