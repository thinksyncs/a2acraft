import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverSend} from '../send-delivery.mjs';
import {requestForSend,sendWasAccepted,recoverSendDrafts,restoreSendDraft} from '../public/send-delivery.js';

const input={requestId:'request-1',kind:'send',text:'hello',model:'model',effort:'medium',attachmentIds:[]};
test('lost HTTP response is recognized for text-only messages and replay does not dispatch again',async()=>{
  const chat={id:'chat',messages:[]};let calls=0;
  await deliverSend(chat,input,async delivery=>{calls++;chat.messages.push({role:'user',text:input.text,delivery});});
  const reopened=JSON.parse(JSON.stringify(chat));
  assert(sendWasAccepted([reopened],'chat','request-1'));
  await deliverSend(reopened,input,()=>{calls++;});assert.equal(calls,1);
  await assert.rejects(deliverSend(reopened,{...input,text:'changed'},()=>{}),/内容が変わ/);
});
test('concurrent retries share the same pending delivery',async()=>{
  const chat={messages:[]};let calls=0,finish;const wait=new Promise(resolve=>finish=resolve);
  const execute=async delivery=>{calls++;await wait;chat.messages.push({role:'user',text:'hello',delivery});return 'done';};
  const first=deliverSend(chat,input,execute),second=deliverSend(chat,input,execute);
  await Promise.resolve();assert.equal(calls,1);finish();
  assert.deepEqual(await Promise.all([first,second]),['done','done']);
});
test('a rejected pre-dispatch request remains retryable, but reused IDs cannot change intent',async()=>{
  const chat={messages:[]};
  await assert.rejects(deliverSend(chat,input,async()=>{throw Error('not connected');}),/not connected/);
  await deliverSend(chat,input,async delivery=>chat.messages.push({role:'user',text:'hello',delivery}));
  await assert.rejects(deliverSend(chat,{...input,kind:'steer'},()=>{}),/内容が変わ/);
  await assert.rejects(deliverSend(chat,{...input,requestId:'../bad'},()=>{}),/送信ID/);
});
test('receipt remains replayable if later persistence acknowledgement fails',async()=>{
  const chat={messages:[]};let count=0;
  await assert.rejects(deliverSend(chat,input,async delivery=>{count++;chat.messages.push({role:'user',text:'hello',delivery});throw Error('disk full');}),/disk full/);
  await deliverSend(chat,input,()=>{count++;});assert.equal(count,1);
});
test('frontend keeps the retry identity across reload and recovers unacknowledged text',()=>{
  const records={},drafts={},chats=[{id:'chat',messages:[]}];
  const id=requestForSend(records,'chat',input,()=> 'retry-1');
  const restored=JSON.parse(JSON.stringify(records));
  assert.equal(requestForSend(restored,'chat',input,()=> 'wrong'),id);
  recoverSendDrafts(restored,chats,drafts);assert.equal(drafts.chat,'hello');
  recoverSendDrafts(restored,chats,drafts);assert.equal(drafts.chat,'hello');
  drafts.chat='a newer question';recoverSendDrafts(restored,chats,drafts);assert.equal(drafts.chat,'hello\n\na newer question');
  chats[0].messages.push({role:'user',delivery:{requestId:id}});
  recoverSendDrafts(restored,chats,drafts);assert.deepEqual(restored,{});assert.equal(drafts.chat,'a newer question');
});
test('matching attachments supports old accepted messages without misclassifying text-only messages',()=>{
  const chats=[{id:'chat',messages:[{role:'user',text:'hello',attachments:[{id:'file'}]}]}];
  assert.equal(sendWasAccepted(chats,'chat','new'),false);
  assert.equal(sendWasAccepted(chats,'chat','new',[{id:'file'}]),true);
  assert.equal(sendWasAccepted(chats,'chat',undefined),false);
  chats[0].messages[0].delivery={requestId:'different'};
  assert.equal(sendWasAccepted(chats,'chat','new',[{id:'file'}]),false);
});
test('later receipt consumes only automatically restored text and preserves user edits',()=>{
  const records={},drafts={chat:'next'},chats=[{id:'chat',messages:[]}];
  requestForSend(records,'chat',input,()=> 'retry');
  drafts.chat=restoreSendDraft(records,'chat','hello',drafts.chat);
  const reopened=JSON.parse(JSON.stringify(records));
  chats[0].messages.push({role:'user',delivery:{requestId:'retry'}});
  recoverSendDrafts(reopened,chats,drafts);assert.equal(drafts.chat,'next');
  drafts.chat='edited by the user';recoverSendDrafts(records,chats,drafts);assert.equal(drafts.chat,'edited by the user');
});
test('unmarked identical new question is kept when an earlier request was accepted',()=>{
  const records={},drafts={chat:'hello'},chats=[{id:'chat',messages:[{role:'user',delivery:{requestId:'retry'}}]}];
  requestForSend(records,'chat',input,()=> 'retry');recoverSendDrafts(records,chats,drafts);
  assert.equal(drafts.chat,'hello');assert.deepEqual(records,{});
});
test('malformed retry records do not disable new request identities or break draft recovery',()=>{
  const records={chat:{fingerprint:JSON.stringify(input)}};
  assert.equal(requestForSend(records,'chat',input,()=> 'valid'),'valid');
  assert.doesNotThrow(()=>recoverSendDrafts({chat:{fingerprint:'null'}},[{id:'chat',messages:[]}],{}));
});
