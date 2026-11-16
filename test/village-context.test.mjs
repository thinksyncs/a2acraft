import test from 'node:test';
import assert from 'node:assert/strict';
import {villageConversationContext,nearbyVillageConversations} from '../public/village-context.js';

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
