import test from 'node:test';
import assert from 'node:assert/strict';
import {residentReport,acknowledgeResidentReport} from '../public/world-dialogue.js';
import {latestConversationExchange} from '../public/conversation-details.js';

test('map reports preserve the specific request and response beyond the old 220-character cutoff',()=>{
  const request='地図の川を修正してください。\n'+('地形に沿って流れる川。'.repeat(40))+'\n橋を最後に確認してください。';
  const answer='## 修正した内容\n\n- 川の流路\n- 街道の橋\n\n```js\nconst river = true;\n```';
  const chat={id:'river',messages:[{id:'request',role:'user',text:request},{id:'reply',role:'assistant',text:answer}]};
  const first=residentReport(chat);
  assert.equal(first.text,request);assert.equal(first.label,'依頼');
  const second=residentReport(chat,null,acknowledgeResidentReport(null,first));
  assert.equal(second.text,answer);assert.equal(second.label,'返答');
  assert.deepEqual(latestConversationExchange(chat),[{label:'最新の依頼',text:request},{label:'最新の返答',text:answer}]);
});

test('a map detail never presents an older response as the answer to a new request',()=>{
  const chat={messages:[{role:'user',text:'古い依頼'},{role:'assistant',text:'古い返答'},
    {role:'user',text:'新しい依頼'},{role:'tool',text:'内部処理'},{role:'assistant',text:'  '}]};
  assert.deepEqual(latestConversationExchange(chat),[{label:'最新の依頼',text:'新しい依頼'}]);
  chat.messages.push({role:'assistant',text:'新しい返答'});
  assert.deepEqual(latestConversationExchange(chat),[{label:'最新の依頼',text:'新しい依頼'},{label:'最新の返答',text:'新しい返答'}]);
  assert.deepEqual(latestConversationExchange({messages:[]}),[]);
});

test('current project questions still take priority over the detailed transcript',()=>{
  const chat={id:'review',project:{jobId:'work'},messages:[{id:'prior',role:'assistant',text:'前の作業報告'}]};
  const project={jobs:[{id:'work'}],events:[{id:'question',jobId:'work',kind:'question',status:'open',question:'配置を確認してください。'}]};
  const report=residentReport(chat,project);
  assert.equal(report.kind,'question');assert.equal(report.label,'確認事項');
  assert.match(report.text,/配置を確認してください/);
});

test('attachment-only requests remain the boundary for the latest answer',()=>{
  const chat={id:'image-review',messages:[{role:'user',text:'古い依頼'},{role:'assistant',text:'古い返答'},
    {id:'image',role:'user',text:'',attachments:[{name:'地図.png'}]}]};
  assert.deepEqual(latestConversationExchange(chat),[{label:'最新の依頼',text:'添付ファイル: 地図\\.png'}]);
  assert.equal(residentReport(chat).text,'添付ファイル: 地図\\.png');
  chat.messages.push({role:'assistant',text:'画像の川についての返答'});
  assert.deepEqual(latestConversationExchange(chat),[{label:'最新の依頼',text:'添付ファイル: 地図\\.png'},{label:'最新の返答',text:'画像の川についての返答'}]);
});
