import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {checkPlan} from '../policy.mjs';
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
  const payloads = [], fingerprints = [], pendingSends = new Set(), drafts = {leader:'隊長への質問', other:'別の下書き'};
  let files = [], attachmentBusy = false;
  const squadId = 'todo:waiting-team';
  const sendRequests = {};
  let deliverySequence = 0;
  const context = vm.createContext({
    $:selector=>fields[selector], chats:[chat, other], selected:'other', state, drafts, demo:false,
    serverUnavailable:false, steerPending:false, pendingSends, conversationModeRequests:new Map(),
    boardActive:()=>false, partyActive:()=>false, connectionReadiness:{busy:false},
    active:row=>['starting','running','stopping'].includes(row.status),
    attachments:{get:()=>files, busy:()=>attachmentBusy, take:assert.fail},
    sendRequests, requestForSend:(records,id,value)=>requestForSend(records,id,value,()=>'delivery-'+(++deliverySequence)),
    desktopDrafts:{flush:async()=>{}}, persist(){}, renderChats(){}, scrollChatLatest(){}, updateComposer(){},
    api:async(route, body)=>{
      payloads.push([route, JSON.parse(JSON.stringify(body))]);
      fingerprints.push(JSON.parse(sendRequests[body.id].fingerprint));
    },
  });
  const sender = vm.runInContext(
    section('function buckets()', 'function quotaHtml()') +
    section('function normalSendUnavailable(', 'function updateComposer()') +
    section('async function sendConversationTurn(', "\n$('#stop-btn').onclick") + '\nsendTeamChatMessage',
    context
  );
  async function blocked() {
    await sender('leader',squadId);
    assert.deepEqual(payloads, []);
    assert.equal(drafts.leader, '隊長への質問');
  }
  state.connected = false; await blocked(); state.connected = true;
  const status=()=>vm.runInContext("teamSendStatus('leader')",context);
  state.policy = {ok:false,reason:'処理を実行できません。'};
  assert.equal(status().reason,state.policy.reason);
  assert.equal(status().refreshQuota,undefined);
  await blocked();

  state.policy = checkPlan(state.account,null);
  assert.equal(status().reason,state.policy.reason);
  assert.equal(status().refreshQuota,true);
  await blocked();

  const now=Math.floor(Date.now()/1000),reset=now+3600,otherReset=now+86400;
  state.limits={rateLimitsByLimitId:{
    unrelated:{limitName:'別の枠',primary:{usedPercent:0,resetsAt:otherReset,windowDurationMins:60}},
    codex:{limitName:'Codex',secondary:{usedPercent:100,resetsAt:reset,windowDurationMins:10080}}
  }};
  state.policy=checkPlan(state.account,state.limits);
  const limited=status();
  assert.equal(limited.refreshQuota,true);
  assert.ok(limited.reason.startsWith(state.policy.reason));
  assert.match(limited.reason,/Codex · 7日間の枠 残り0%/);
  const format=t=>new Date(t*1000).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  assert.ok(limited.reason.includes(format(reset)));
  assert.ok(!limited.reason.includes(format(otherReset)));
  assert.ok(!limited.reason.includes('別の枠'));
  await blocked();

  const exhausted=state.limits.rateLimitsByLimitId.codex.secondary;
  exhausted.resetsAt=now-60;
  state.policy=checkPlan(state.account,state.limits);
  assert.equal(status().reason,state.policy.reason, 'expired measurement supplies no future reset or current percentage');
  await blocked();
  state.policy={ok:true};
  chat.project = {id:'in-progress'}; await blocked(); delete chat.project;
  chat.workMode = 'work'; await blocked(); delete chat.workMode;
  chat.status = 'running'; await blocked(); chat.status = 'idle';
  other.status = 'starting'; await blocked(); other.status = 'idle';
  files = [{id:'attachment'}]; await blocked(); files = [];
  attachmentBusy = true; await blocked(); attachmentBusy = false;
  await sender('leader');
  assert.equal(payloads.length, 0, 'a team card must pass the squad it checked');

  // A saved unacknowledged map delivery reuses its ID only for that team.
  const prior = {mapSquadId:squadId,text:drafts.leader,model:'sample',effort:'low',attachmentIds:[],kind:'send',expectedTurnId:null};
  requestForSend(sendRequests,'leader',prior,()=>'restored');
  await sender('leader',squadId);
  assert.deepEqual(payloads, [['send', {
    id:'leader', text:'隊長への質問', mapSquadId:squadId, attachmentIds:[], expectedTurnId:null, model:'sample', effort:'low', requestId:'restored',
  }]]);
  assert.deepEqual(fingerprints[0],prior);

  drafts.leader=prior.text;chat.status='idle';
  requestForSend(sendRequests,'leader',prior,()=>'earlier-team');
  await sender('leader','todo:another-team');
  assert.equal(payloads[1][1].requestId,'delivery-1');
  assert.equal(payloads[1][1].mapSquadId,'todo:another-team');
  assert.equal(fingerprints[1].mapSquadId,'todo:another-team');
  assert.equal(pendingSends.size, 0);
  assert.deepEqual(drafts, {leader:'', other:'別の下書き'});
  assert.equal(fields['#prompt'].value, '別の下書き');
});
