import {getLocale, setLocale} from '../public/i18n.js';
import {chatText} from '../public/i18n-chat.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function updateConversationMode(chat) {');
const end=source.indexOf("\n$('#conversation-mode').onchange",start);
assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture(values={}){
  const elements=new Map(),calls=[],pending=deferred();let context;
  const node=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
  context=vm.createContext({chatText,
    chats:[{id:'one',status:'idle',messages:[]}],selected:'one',demo:false,serverUnavailable:false,
    drafts:{one:'Do not alter this draft'},pendingSends:new Set(),conversationModeRequests:new Map(),...values,
    $:node,setText:(id,text)=>{node(id).textContent=text;},
    active:chat=>['starting','running','stopping'].includes(chat?.status),
    updateComposer(){context.updateConversationMode(context.chats.find(chat=>chat.id===context.selected));},
    api:async(route,data)=>{calls.push({route,...data});return pending.promise;}
  });
  vm.runInContext(source.slice(start,end),context);
  context.updateComposer();return {context,node,calls,pending};
}

test('scope starts read-only, changes only after acknowledgement, and preserves a newer draft',async()=>{
  const f=fixture();assert.equal(f.node('#conversation-mode').value,'chat');
  const save=f.context.changeConversationMode('work');
  assert.equal(f.calls[0].route,'conversation-mode');assert.equal(f.calls[0].mode,'work');
  assert.equal(f.context.chats[0].workMode,undefined);assert.equal(f.node('#conversation-mode').disabled,true);
  assert.equal(f.context.conversationModeRequests.has('one'),true);
  f.context.drafts.one='A newer draft';f.pending.resolve({id:'one',workMode:'work'});await save;
  assert.equal(f.context.chats[0].workMode,'work');assert.equal(f.context.drafts.one,'A newer draft');
  assert.equal(f.context.conversationModeRequests.has('one'),false);assert.equal(f.node('#conversation-mode').disabled,false);
});

test('failed scope save stays unresolved until retry succeeds',async()=>{
  const f=fixture(),save=f.context.changeConversationMode('work');f.pending.reject(Error('Connection lost'));await save;
  assert.equal(f.context.chats[0].workMode,undefined);assert.equal(f.node('#conversation-mode').value,'chat');
  assert.equal(f.context.conversationModeRequests.has('one'),true);assert.equal(f.node('#conversation-mode-retry').hidden,false);
  assert.match(f.node('#conversation-mode-error').textContent,/Connection lost/);
  f.context.api=async()=>({id:'one',workMode:'work'});await f.context.changeConversationMode('work');
  assert.equal(f.context.conversationModeRequests.has('one'),false);assert.equal(f.node('#conversation-mode-retry').hidden,true);
});

test('scope cannot change during a turn or a pending send, or on project/demo conversations',async()=>{
  for(const values of [
    ...['starting','running','stopping'].map(status=>({chats:[{id:'one',status}]})),
    {pendingSends:new Set(['one'])},{chats:[{id:'one',project:{id:'project'}}]},{demo:true}
  ]){
    const f=fixture(values);assert.equal(f.node('#conversation-mode').disabled,true);
    await f.context.changeConversationMode('work');assert.equal(f.calls.length,0);
  }
});

test('a slow save applies to its original conversation after selection changes',async()=>{
  const f=fixture({chats:[{id:'one',status:'idle'},{id:'two',status:'idle'}]}),save=f.context.changeConversationMode('work');
  f.context.selected='two';f.context.drafts.two='Other conversation draft';f.context.updateComposer();
  f.pending.resolve({id:'one',workMode:'work'});await save;
  assert.equal(f.context.selected,'two');assert.equal(f.context.chats[0].workMode,'work');
  assert.equal(f.context.chats[1].workMode,undefined);assert.equal(f.node('#conversation-mode').value,'chat');
  assert.equal(f.context.drafts.two,'Other conversation draft');
});

test('switching to English updates the scope explanation without saving or changing the draft',async t=>{
  const old=getLocale();t.after(()=>setLocale(old));
  const f=fixture(), draft='未送信の下書き　Send exactly as typed';
  f.context.drafts.one=draft;
  await setLocale('en');f.context.updateComposer();
  assert.equal(f.node('#conversation-mode-note').textContent,'Chat mode leaves files unchanged.');
  const save=f.context.changeConversationMode('work');
  assert.deepEqual(f.calls,[{route:'conversation-mode',id:'one',mode:'work'}]);
  f.pending.resolve({id:'one',workMode:'work'});await save;
  assert.match(f.node('#conversation-mode-note').textContent,/dedicated folder/);
  await setLocale('ja');f.context.updateComposer();
  assert.match(f.node('#conversation-mode-note').textContent,/専用フォルダ/);
  assert.equal(f.context.drafts.one,draft);
  assert.equal(f.calls.length,1);
});
