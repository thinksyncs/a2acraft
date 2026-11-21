import test from 'node:test';
import assert from 'node:assert/strict';
import {villageConversationContext,nearbyVillageConversations} from '../public/village-context.js';
import {villageDemoActivityState,villageDemoChats} from '../public/village-demo.js';
import {latestConversationExchange} from '../public/conversation-details.js';

test('Map context uses the latest actual user request, not tool/system or an older response',()=>{
  const result=villageConversationContext({messages:[
    {role:'user',text:'古い依頼'}, {role:'assistant',text:'古い結果'},
    {role:'user',text:'道路を\n曲げてください'}, {role:'tool',text:'private tool output'},
    {role:'system',text:'hidden instruction'}]});
  assert.deepEqual(result,{label:'直近の依頼',text:'道路を 曲げてください'});
  assert.deepEqual(villageConversationContext({messages:[{role:'tool',text:'not a chat'}]}),
    {label:'会話',text:'履歴を開いて内容を確認できます。'});
});

test('Map context changes with camera location and omits unplaced residents',()=>{
  const residents=['near','far','missing'].map(conversationId=>({conversationId}));
  const homes=new Map([['near',{x:10,y:20}],['far',{x:4000,y:3000}]]);
  assert.deepEqual(nearbyVillageConversations({residents,homes,point:{x:0,y:0}}).map(p=>p.conversationId),['near','far']);
  assert.equal(nearbyVillageConversations({residents,homes,point:{x:3900,y:3000},limit:1})[0].conversationId,'far');
  assert.deepEqual(nearbyVillageConversations({residents,homes,point:{x:NaN,y:0}}),[]);
});

test('every assigned sample resident answers a request about their actual quest and role',()=>{
  const chats=villageDemoChats();
  const assigned=chats.filter(chat=>chat.messages.at(-1).id===chat.id+'-assignment');
  const quests=villageDemoActivityState({}).todos.items;
  assert.equal(assigned.length,9);
  for(const resident of assigned){
    const quest=quests.find(quest=>quest.runs.some(run=>run.steps.some(step=>step.conversationId===resident.id)));
    const step=quest.runs.flatMap(run=>run.steps).find(step=>step.conversationId===resident.id);
    const [request,answer]=latestConversationExchange(resident);
    assert.ok(request.text.includes(quest.title)&&request.text.includes(step.role),resident.title);
    assert.equal(villageConversationContext(resident).text,request.text);
    assert.ok(answer.text.includes(quest.title)&&answer.text.includes(step.role),resident.title);
    if(step.output)assert.ok(answer.text.startsWith(step.output.replace(/^【サンプル成果】/u,'')));
  }
});
