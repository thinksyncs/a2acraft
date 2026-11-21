import test from 'node:test';
import assert from 'node:assert/strict';
import {residentReport,acknowledgeResidentReport} from '../public/world-dialogue.js';
import {latestConversationExchange,encounterContextRows} from '../public/conversation-details.js';
import {villageConversationContext} from '../public/village-context.js';

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

const snapshot='<external_codex_apps_selected_page_part_1_of_1>Companion Page snapshot part 1 of 1:\n{"page_id":null,"document_view":null}\n</external_codex_apps_selected_page_part_1_of_1>';

test('a page snapshot does not replace a real request in the bubble, map list or full exchange',()=>{
  const chat={id:'map',title:'河口の街',messages:[
    {role:'user',text:snapshot+'\n川に沿って道を曲げてください。'},
    {role:'assistant',text:'河口の道を修正しました。'},
    {role:'user',text:snapshot},
  ]};
  const before=structuredClone(chat);
  const report=residentReport(chat);
  assert.equal(report.text,'川に沿って道を曲げてください。');
  assert.deepEqual(encounterContextRows(chat,report),[
    {label:'話題',text:'河口の街'},
    {label:'最新の依頼',text:report.text},
    {label:'最新の返答',text:'河口の道を修正しました。'},
  ]);
  assert.equal(villageConversationContext(chat).text,report.text);
  assert.deepEqual(chat,before);
  const imageRequest = '# Files mentioned by the user:\n\n## example.png: /tmp/example.png\nImage attachment: true\n\n## My request:\nこの川を見てください。';
  assert.equal(latestConversationExchange({messages:[{role:'user',text:imageRequest}]})[0].text,'この川を見てください。');
});

test('short follow-ups retain the last concrete request and keep earlier replies out of the current turn',()=>{
  const chat={id:'road',title:'Codexから移行 2026-11-14',messages:[
    {role:'user',text:'街の小道を自然に曲げてください。'},
    {role:'assistant',text:'道を修正しました。'},
    {role:'user',text:'続けて。'},
    {role:'user',text:snapshot},
  ]};
  assert.deepEqual(encounterContextRows(chat),[
    {label:'これまでの依頼',text:'街の小道を自然に曲げてください。'},
    {label:'最新の依頼',text:'続けて。'},
    {label:'返答',text:'この依頼への返答はまだありません。'},
  ]);
  const example='\`\`\`xml\n'+snapshot+'\n\`\`\`';
  chat.messages.push({role:'assistant',text:example});
  assert.equal(latestConversationExchange(chat).at(-1).text,example);
});

test('long replies remain available verbatim in details, and wrapper-only chats have an honest empty state',()=>{
  const answer='確認した内容です。\n'.repeat(50);
  const chat={messages:[{role:'user',text:'道を確認して。'},{role:'assistant',text:answer}]};
  assert.match(encounterContextRows(chat).at(-1).text,/…$/u);
  assert.equal(latestConversationExchange(chat).at(-1).text,answer);
  assert.deepEqual(encounterContextRows({title:snapshot,messages:[{role:'user',text:snapshot}]}),[
    {label:'会話',text:'表示できる依頼や返答はまだありません。'},
  ]);
});
