import {ui} from './interface-language.js';

const kinds={
 message:'会話', 'todo-created':'TODO登録', 'todo-completed':'TODO完了',
 'todo-run-started':'TODOの処理開始', 'todo-run-completed':'TODOの処理完了', 'todo-run-failed':'TODOの処理失敗・中断',
 'quest-started':'クエスト開始', 'quest-completed':'クエスト完了',
 'quest-step-started':'役割の開始', 'quest-step-completed':'役割の完了', 'quest-step-failed':'役割の失敗・中断',
 'context-shared':'コンテキスト共有', 'context-attached':'共有内容の送信'
};
const countKeys={
 message:'messages','todo-created':'todosCreated','todo-completed':'todosCompleted',
 'todo-run-started':'todoRunsStarted','todo-run-completed':'todoRunsCompleted','todo-run-failed':'todoRunsFailed',
 'quest-started':'questsStarted','quest-completed':'questsCompleted',
 'quest-step-started':'stepsStarted','quest-step-completed':'stepsCompleted','quest-step-failed':'stepsFailed',
 'context-shared':'contextShared','context-attached':'contextAttached'
};
const rows=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const preview=value=>{const valueText=text(value).trim();return valueText.length>500?valueText.slice(0,499)+'…':valueText;};
function timestamp(value){
 // Strings without an offset do not identify an instant and must stay undated.
 if(typeof value==='string'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
 if(typeof value==='string'){const date=value.slice(0,10);if(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return null;}
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const result=typeof value==='number'?value:Date.parse(value);
 return Number.isFinite(result)&&Math.abs(result)<=8640000000000000?result:null;
}
function dateFormatter(date,timeZone){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('日付をYYYY-MM-DD形式で指定してください。');
 if(typeof timeZone!=='string'||!timeZone.trim())throw Error('タイムゾーンを確認してください。');
 try{return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}catch{throw Error('タイムゾーンを確認してください。');}
}
export function validateDailyReportDate(date,timeZone='Asia/Tokyo'){dateFormatter(date,timeZone);return {date,timeZone};}
function localDate(formatter,value){
 const parts=Object.fromEntries(formatter.formatToParts(value).map(part=>[part.type,part.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}

/** A local record of observed events; reading a report never starts a model turn. */
export function buildDailyReport({date,timeZone='Asia/Tokyo',conversations=[],todos={items:[]},party={},contextBoard=[]}={}){
 const formatter=dateFormatter(date,timeZone),activities=[],undated=[],current=[],seen=new Set();
 const counts=Object.fromEntries([...new Set([...Object.values(countKeys),'userMessages','assistantMessages'])].map(key=>[key,0]));
 const add=(event,value)=>{
  if(seen.has(event.id))return;seen.add(event.id);
  const instant=timestamp(value);
  if(instant===null){undated.push({...event,reason:value===undefined||value===null?'missing-timestamp':'invalid-timestamp'});return;}
  if(localDate(formatter,instant)!==date)return;
  activities.push({...event,timestamp:instant});counts[countKeys[event.kind]]++;
  if(event.kind==='message')counts[event.role==='user'?'userMessages':'assistantMessages']++;
 };
 for(const [chatIndex,chat] of rows(conversations).entries()){
  if(!chat||typeof chat!=='object')continue;
  const chatId=text(chat?.id)||String(chatIndex),target={type:'chat',id:chatId},title=text(chat?.title)||'会話';
  for(const [index,message] of rows(chat?.messages).entries()){
   if(!['user','assistant'].includes(message?.role))continue;
   add({id:'message:'+chatId+':'+(text(message.id)||index),kind:'message',title,detail:preview(message.text),status:message.role==='user'?'sent':'recorded',role:message.role,target},message.createdAt);
  }
  if(['starting','running','stopping','failed'].includes(chat?.status))current.push({id:'chat:'+chatId,kind:'chat',title,status:chat.status,detail:preview(chat.error),target});
 }
 for(const [index,item] of rows(todos?.items).entries()){
  if(!item||typeof item!=='object')continue;
  const todoId=text(item?.id)||String(index),target={type:'todo',id:todoId},title=text(item?.title)||'TODO';
  add({id:'todo-created:'+todoId,kind:'todo-created',title,detail:'',status:'created',target},item?.createdAt);
  if(item?.status==='done')add({id:'todo-completed:'+todoId,kind:'todo-completed',title,detail:'',status:'completed',target},item.completedAt);
  for(const [runIndex,run] of rows(item?.runs).entries()){
   if(!run||typeof run!=='object')continue;
   const runId=text(run?.id)||String(runIndex),base={title,detail:preview(run?.error),target};
   add({...base,id:'todo-run-started:'+todoId+':'+runId,kind:'todo-run-started',status:'started'},run?.createdAt);
   if(run?.status==='completed')add({...base,id:'todo-run-completed:'+todoId+':'+runId,kind:'todo-run-completed',status:'completed',detail:preview(run.output)},run.completedAt);
   else if(['failed','cancelled','paused'].includes(run?.status))add({...base,id:'todo-run-failed:'+todoId+':'+runId,kind:'todo-run-failed',status:run.status},run.failedAt??run.finishedAt);
  }
  if(item?.status==='doing')current.push({id:'todo:'+todoId,kind:'todo',title,status:'doing',detail:'',target});
 }
 const quest=party?.quest;
 if(quest){
  const questId=text(quest.id)||'current',target={type:'party',id:questId},title=preview(quest.text)||'クエスト';
  add({id:'quest-started:'+questId,kind:'quest-started',title,detail:'',status:'started',target},quest.createdAt);
  if(quest.status==='completed')add({id:'quest-completed:'+questId,kind:'quest-completed',title,detail:preview(rows(quest.steps).at(-1)?.output),status:'completed',target},quest.completedAt);
  for(const [index,step] of rows(quest.steps).entries()){
   if(!step||typeof step!=='object')continue;
   const stepId=text(step?.id)||String(index),base={title:text(step?.role)||'役割',detail:text(step?.title),target:step?.conversationId?{type:'chat',id:step.conversationId}:target,questId};
   if(step?.status!=='pending'||step?.startedAt!==undefined)add({...base,id:'quest-step-started:'+questId+':'+stepId,kind:'quest-step-started',status:'started'},step?.startedAt);
   if(step?.status==='completed')add({...base,id:'quest-step-completed:'+questId+':'+stepId,kind:'quest-step-completed',status:'completed',detail:preview(step.output)},step.completedAt);
   else if(['failed','blocked','interrupted'].includes(step?.status))add({...base,id:'quest-step-failed:'+questId+':'+stepId,kind:'quest-step-failed',status:step.status,detail:preview(step.error)},step.failedAt??step.finishedAt);
  }
  if(['running','stopping','paused'].includes(quest.status))current.push({id:'party:'+questId,kind:'party',title,status:quest.status,detail:preview(quest.error),target});
 }
 for(const [index,entry] of rows(contextBoard).entries()){
  if(!entry||typeof entry!=='object')continue;
  const id=text(entry?.id)||String(index),target={type:'chat',id:text(entry?.targetId)},title=(text(entry?.sourceTitle)||'会話')+' → '+(text(entry?.targetTitle)||'会話');
  add({id:'context-shared:'+id,kind:'context-shared',title,detail:'',status:'shared',target},entry?.createdAt);
  if(entry?.status==='attached')add({id:'context-attached:'+id,kind:'context-attached',title,detail:'',status:'attached',target},entry.attachedAt);
 }
 activities.sort((a,b)=>a.timestamp-b.timestamp||(a.id<b.id?-1:a.id>b.id?1:0));
 const limitations=['保存されている記録を集計しています。通常のクエストは直近1件、TODOの実行履歴は保存済みの範囲が対象です。','会話はメッセージの記録時刻で集計します。返信の存在だけで作業完了とは扱いません。','日時不明の記録と現在の状態は、選択日の実績に含めません。'];
 return {date,timeZone,counts,activities,undated,current,limitations};
}

const markdownText=value=>text(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&').replace(/\r?\n/g,' ');
export function dailyReportMarkdown(report){
 const clock=new Intl.DateTimeFormat('ja-JP',{timeZone:report.timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const lines=[ui('# 日報 ','# Daily report ')+report.date,'','タイムゾーン: '+report.timeZone,'',ui('## 記録された活動','## Recorded activity'),'',
  '会話 '+report.counts.messages+'件（送信 '+report.counts.userMessages+' / 応答 '+report.counts.assistantMessages+'）、TODO完了 '+report.counts.todosCompleted+'件、クエスト完了 '+report.counts.questsCompleted+'件。',''];
 if(!report.activities.length)lines.push('この日の日時付き記録はありません。');
 for(const event of report.activities){lines.push('- '+clock.format(event.timestamp)+' '+markdownText(kinds[event.kind]||event.kind)+': '+markdownText(event.title)+(event.role?'（'+(event.role==='user'?'送信':'応答')+'）':'')+' ['+markdownText(event.status)+']');if(event.detail)lines.push('  '+markdownText(event.detail));}
 lines.push('',ui('## 現在の状態（選択日の実績とは別）','## Current status (outside the selected day’s totals)'),'');
 if(!report.current.length)lines.push('進行中・要確認の記録はありません。');
 for(const item of report.current)lines.push('- '+markdownText(item.title)+' ['+markdownText(item.status)+']'+(item.detail?' '+markdownText(item.detail):''));
 lines.push('',ui('## 日時不明の記録','## Undated records'),'',String(report.undated.length)+'件。選択日の活動件数には含めていません。');
 for(const item of report.undated)lines.push('- '+markdownText(kinds[item.kind]||item.kind)+': '+markdownText(item.title)+' ['+markdownText(item.status)+']');
 lines.push('',ui('## 集計範囲','## Report coverage'),'',...report.limitations.map(value=>'- '+value));
 return lines.join('\n')+'\n';
}
