import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {requestForSend} from '../public/send-delivery.js';

// Exercise the app's map sender and ordinary delivery path together. The RPC
// boundary records the payload so the test never connects to a model.
test('a map message uses normal send for its recipient, preserving the other composer and its attachments', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  function section(start, end) {
    const first = app.indexOf(start), last = app.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return app.slice(first, last);
  }
  const chat = {id:'leader', status:'idle'}, other = {id:'other',status:'idle'};
  const fields = {'#workspace':{hidden:false}, '#model':{value:'sample'}, '#effort':{value:'low'}, '#prompt':{value:'別の下書き'}};
  const state = {connected:true, account:{type:'chatgpt'}, policy:{ok:true}};
  const payloads = [], pendingSends = new Set(), drafts = {leader:'隊長への質問', other:'別の下書き'};
  let files = [], attachmentBusy = false;
  const context = vm.createContext({
    $:selector=>fields[selector], chats:[chat, other], selected:'other', state, drafts, demo:false,
    serverUnavailable:false, steerPending:false, pendingSends, conversationModeRequests:new Map(),
    boardActive:()=>false, partyActive:()=>false, connectionReadiness:{busy:false},
    active:row=>['starting','running','stopping'].includes(row.status),
    attachments:{get:()=>files, busy:()=>attachmentBusy, take:assert.fail},
    sendRequests:{}, requestForSend:(records,id,value)=>requestForSend(records,id,value,()=>'delivery-1'),
    desktopDrafts:{flush:async()=>{}}, persist(){}, renderChats(){}, scrollChatLatest(){}, updateComposer(){},
    api:async(route, body)=>payloads.push([route, JSON.parse(JSON.stringify(body))]),
  });
  const sender = vm.runInContext(
    section('function normalSendUnavailable(', 'function updateComposer()') +
    section('async function sendConversationTurn(', "\n$('#stop-btn').onclick") + '\nsendTeamChatMessage',
    context
  );
  async function blocked() {
    await sender('leader');
    assert.deepEqual(payloads, []);
    assert.equal(drafts.leader, '隊長への質問');
  }
  state.connected = false; await blocked(); state.connected = true;
  state.policy.ok = false; await blocked(); state.policy.ok = true;
  chat.project = {id:'in-progress'}; await blocked(); delete chat.project;
  chat.workMode = 'work'; await blocked(); delete chat.workMode;
  chat.status = 'running'; await blocked(); chat.status = 'idle';
  other.status = 'starting'; await blocked(); other.status = 'idle';
  files = [{id:'attachment'}]; await blocked(); files = [];
  attachmentBusy = true; await blocked(); attachmentBusy = false;
  await sender('leader');
  assert.deepEqual(payloads, [['send', {
    id:'leader', text:'隊長への質問', attachmentIds:[], expectedTurnId:null, model:'sample', effort:'low', requestId:'delivery-1',
  }]]);
  assert.equal(pendingSends.size, 0);
  assert.deepEqual(drafts, {leader:'', other:'別の下書き'});
  assert.equal(fields['#prompt'].value, '別の下書き');
});
