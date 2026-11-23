import {ui} from './interface-language.js';
import {buildDailyReport,dailyReportMarkdown,validateDailyReportDate} from './daily-report.js';

const $=selector=>document.querySelector(selector);
const node=(tag,value,className)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
const button=(label,attribute,id)=>{const value=node('button',label,'outline');value.type='button';if(attribute)value.dataset[attribute]=id;return value;};
const dateLabel=value=>Number.isFinite(value)?new Date(value).toLocaleString(ui('ja-JP','en')):ui('発生日時不明','Time unknown');
const scheduleActive=item=>['starting','running','stopping'].includes(item?.status);
const localInput=value=>{const date=new Date(value),pad=part=>String(part).padStart(2,'0');return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());};
function dayInZone(zone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now()).map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day;}

export function initActivity({api,getState,getChats,getModel=()=>({}),getContextBoard,onState,onOpen,notify,demo=false}){
 const statusLabels={completed:ui('完了','Completed'),failed:ui('失敗','Failed'),paused:ui('中断中','Paused'),attention:ui('確認','Needs review'),doing:ui('進行中','In progress'),running:ui('実行中','Running'),stopping:ui('停止待ち','Stopping'),starting:ui('開始中','Starting'),sent:ui('送信','Sent'),recorded:ui('応答の記録','Response recorded'),started:ui('開始','Started'),created:ui('登録','Created'),cancelled:ui('終了','Finished'),blocked:ui('開始できません','Cannot start'),interrupted:ui('結果未確認','Outcome unconfirmed'),shared:ui('共有','Shared'),attached:ui('送信済み','Sent')};
 const scheduleActions={notify:ui('Inboxへ通知','Send an inbox notification'),chat:ui('チャットを自動開始','Start a chat automatically'),party:ui('パーティのクエストを自動開始','Start a party quest automatically')};
 const scheduleStatuses={pending:ui('時刻待ち','Scheduled'),starting:ui('開始中','Starting'),running:ui('実行中','Running'),completed:ui('完了','Completed'),blocked:ui('停止 · 確認が必要','Stopped · Review needed'),failed:ui('失敗','Failed'),uncertain:ui('結果未確認 · 自動再開なし','Outcome unconfirmed · No automatic retry'),notified:ui('通知済み','Notification sent'),cancelled:ui('停止済み','Stopped')};
 const activityLabels={message:ui('会話','Chat'),'todo-created':ui('TODO登録','To-do created'),'todo-completed':ui('TODO完了','To-do completed'),'todo-run-started':ui('TODO処理開始','To-do started'),'todo-run-completed':ui('TODO処理完了','To-do run completed'),'todo-run-failed':ui('TODO失敗・中断','To-do failed or paused'),'quest-started':ui('クエスト開始','Quest started'),'quest-completed':ui('クエスト完了','Quest completed'),'quest-step-started':ui('役割開始','Role started'),'quest-step-completed':ui('役割完了','Role completed'),'quest-step-failed':ui('役割失敗・中断','Role failed or paused'),'context-shared':ui('共有','Shared'),'context-attached':ui('共有内容送信','Shared context sent')};
 $('#inbox-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">LOCAL INBOX</div><h2 id="inbox-title">${ui('お知らせ','Inbox')} <span id="inbox-unread-count" class="count-badge">0</span></h2>
  <p>${ui('チャット・TODO・クエストの完了やエラー、予約した通知をここで確認できます。','See updates and errors from chats, to-dos, and quests, along with scheduled notifications.')}</p>
  </div><div class="activity-actions"><button id="inbox-refresh" type="button" class="outline">${ui('更新','Refresh')}</button>
  <button id="inbox-read-all" type="button" class="outline">${ui('すべて既読にする','Mark all as read')}</button>
  </div></div>
  <label class="activity-filter" for="inbox-filter">${ui('表示','Show')} <select id="inbox-filter"><option value="all">${ui('すべて','All')}</option><option value="unread">${ui('未読','Unread')}</option><option value="completed">${ui('完了','Completed')}</option><option value="attention">${ui('エラー・中断・確認','Errors, pauses, or items to review')}</option></select></label>
  <p id="inbox-error" class="module-error" role="alert" hidden></p>
  <div id="inbox-list" class="activity-list" aria-live="polite"></div>`;
 $('#reports-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">DAILY REPORT · LOCAL RECORDS</div><h2 id="report-title">${ui('日報','Daily reports')}</h2>
  <p>${ui('選んだ日の記録から日報を作ります。本文を編集し、アプリ内に保存できます。','Build a report from the selected day’s records, then edit and save it in the app.')}</p>
  </div></div>
  <div class="report-controls"><label for="report-date">${ui('日付','Date')}<input id="report-date" type="date" required></label>
  <label for="report-timezone">${ui('集計するタイムゾーン','Report time zone')}<input id="report-timezone" value="Asia/Tokyo" maxlength="100" placeholder="Asia/Tokyo" required></label>
  <button id="report-build" type="button" class="primary">${ui('記録から作成','Build from records')}</button>
  <button id="report-load" type="button" class="outline">${ui('保存済みを開く','Open saved report')}</button>
  </div><p id="report-error" class="module-error" role="alert" hidden></p>
  <p id="report-notice" class="module-note" role="status"></p>
  <p id="report-summary" class="module-note"></p>
  <div class="report-layout"><div class="activity-card"><h3>${ui('日時付きの活動','Dated activity')}</h3>
  <div id="report-activities" class="activity-list"></div><details id="report-undated-details"><summary id="report-undated-summary">${ui('日時不明・現在の状態','Undated activity and current status')}</summary><div id="report-undated"></div><div id="report-current"></div></details>
  </div><div class="activity-card report-editor"><label for="report-markdown">${ui('日報の本文（Markdown・編集可）','Report text (editable Markdown)')}</label>
  <textarea id="report-markdown" maxlength="100000" rows="16" spellcheck="false"></textarea><div class="activity-actions"><button id="report-save" type="button" class="primary">${ui('アプリ内に保存','Save in app')}</button>
  <button id="report-copy" type="button" class="outline">${ui('本文をコピー','Copy text')}</button>
  </div><p class="module-note">${ui('日時不明の記録を当日の実績に含めません。会話の返信だけで作業完了とは扱いません。','Undated records are excluded from daily totals. A chat reply alone does not mark work as complete.')}</p>
  </div></div>
  <details class="report-saved"><summary>${ui('保存済みの日報','Saved reports')} <span id="report-saved-count">0</span>${ui('件','')}</summary><div id="report-saved-list"></div></details>`;
 $('#schedules-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">SCHEDULED TASKS</div><h2 id="schedule-title-heading">${ui('予約','Schedules')}</h2>
  <p>${ui('指定した日時に通知、チャット、パーティのクエストを開始します。アプリが閉じていた間の予約は、次の起動時に確認します。','Schedule a notification, chat, or party quest. The app checks overdue schedules the next time it opens.')}</p>
  </div></div>
  <p id="schedule-error" class="module-error" role="alert" hidden></p>
  <section class="activity-card automation-settings"><h3>${ui('自動実行と通知の設定','Automation and notification settings')}</h3>
  <label class="module-checkbox"><input id="automation-enabled" type="checkbox"> ${ui('Automation Master · 通知と予約の自動開始をONにする','Enable scheduled notifications and automatic starts')}</label>
  <label class="module-checkbox"><input id="followup-enabled" type="checkbox"> ${ui('Auto Followup · 期限超過のTODOと中断中のクエストを1日1回通知','Daily reminders for overdue to-dos and paused quests')}</label>
  <form id="automation-form" class="activity-actions"><label for="schedule-timezone">${ui('フォローアップの基準タイムゾーン','Reminder time zone')}<input id="schedule-timezone" value="Asia/Tokyo" maxlength="100" required></label>
  <button id="automation-save" type="submit" class="outline">${ui('タイムゾーンを保存','Save time zone')}</button>
  </form>
  <p id="schedule-master-note" class="module-note" role="status"></p>
  <p class="module-note">${ui('自動開始は保存した本文・モデルで行います。利用枠不足や開始後の再起動で停止した予約は、自動では再実行しません。読み取り専用設定は維持します。Teams返信の送信は専用画面で確認してください。','Automatic runs use the saved message and model and keep read-only settings. If a quota limit or restart interrupts a run, review it before scheduling it again. Confirm replies in the Teams plugin before sending.')}</p>
  </section><div class="schedule-layout"><form id="schedule-form" class="activity-card activity-form"><h3 id="schedule-editor-title">${ui('通知を予約','Schedule a notification')}</h3>
  <label for="schedule-action">${ui('予約する操作','Action')}<select id="schedule-action"><option value="notify">${ui('Inboxへ通知','Send an inbox notification')}</option><option value="chat">${ui('チャットを自動開始','Start a chat automatically')}</option><option value="party">${ui('パーティのクエストを自動開始','Start a party quest automatically')}</option></select></label>
  <label for="schedule-title">${ui('予約のタイトル','Schedule title')}<input id="schedule-title" maxlength="120" required></label>
  <label for="schedule-due">${ui('開始する日時','Start date and time')}<input id="schedule-due" type="datetime-local" required></label>
  <p id="schedule-device-zone" class="module-note"></p>
  <label for="schedule-target"><span id="schedule-target-label">${ui('通知から開く対象','Open from notification')}</span><select id="schedule-target"><option value="none">${ui('対象なし','None')}</option><option value="party">${ui('酒場のクエスト','Tavern quest')}</option></select></label>
  <div id="schedule-execution-fields" class="schedule-execution-fields" hidden><label for="schedule-text"><span id="schedule-text-label">${ui('チャットに渡す本文','Message for the chat')}</span><textarea id="schedule-text" maxlength="8000" rows="5" placeholder="${ui('指定した時刻に処理する内容','What should run at the scheduled time?')}"></textarea></label>
  <div class="schedule-model-fields"><label for="schedule-model">${ui('使用するモデル','Model')}<select id="schedule-model"></select></label>
  <label for="schedule-effort">${ui('思考の深さ','Reasoning effort')}<select id="schedule-effort"></select></label>
  </div><p id="schedule-party-note" class="module-note" hidden></p>
  <p class="module-note">${ui('保存した本文とモデルを予約ごとに使用します。利用枠が不足した場合は停止し、枠の回復後も手動で再予約するまで開始しません。','Each schedule uses its saved message and model. If quota runs out, reschedule manually after quota becomes available.')}</p>
  </div><div class="activity-actions"><button id="schedule-save" type="submit" class="primary">${ui('予約を保存','Save schedule')}</button>
  <button id="schedule-new" type="button" class="outline">${ui('新規の予約に戻す','New schedule')}</button>
  </div><p id="schedule-action-note" class="module-note">${ui('過去の日時も指定できます。MasterをONにすると通知します。通知済みの予約を再び通知するには、編集して保存してください。','You can choose a past time. Turn on automation to send the notification. To send an existing notification again, edit and save its schedule.')}</p>
  </form>
  <div><h3>${ui('保存済みの予約','Saved schedules')}</h3>
  <div id="schedule-list" class="activity-list"></div></div>
  </div>`;
 // Keep keyboard order aligned with the primary reservation form's position.
 $('#schedules-view').insertBefore($('#schedules-view .schedule-layout'),$('#schedules-view .automation-settings'));
 const busy={inbox:false,report:false,schedule:false},keys={};let editingSchedule=null,zoneDirty=false,report=null,reportKey=null,reportStarted=false,modelInitialized=false;
 const emptyInbox={items:[],unreadCount:0},emptySchedules={enabled:false,followup:false,timeZone:'Asia/Tokyo',items:[]};
 const inboxState=()=>demo?emptyInbox:getState()?.inbox||emptyInbox;
 const scheduleState=()=>demo?emptySchedules:getState()?.schedules||emptySchedules;
 const reportState=()=>demo?{items:[]}:getState()?.reports||{items:[]};
 $('#report-date').value=dayInZone('Asia/Tokyo');
 const deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 $('#schedule-device-zone').textContent=ui(`日時の入力は端末のタイムゾーン（${deviceZone}）です。`,`Enter dates and times in your device time zone (${deviceZone}).`);
 function error(section,message){const element=$('#'+section+'-error');element.hidden=!message;element.textContent=message||'';}
 async function perform(section,operation){
  if(busy[section])return false;busy[section]=true;error(section==='report'?'report':section==='schedule'?'schedule':'inbox','');render();
  try{await operation();return true;}catch(value){error(section,value.message||ui('操作を完了できませんでした。','The action could not be completed.'));return false;}finally{busy[section]=false;render();}
 }
 function setState(kind,value){onState(kind,value);render();}
 function selection(){return validateDailyReportDate($('#report-date').value,$('#report-timezone').value.trim());}
 const selectionKey=value=>value.date+'@'+value.timeZone;
 function actionRow(source){const actions=node('div',undefined,'activity-actions'),open=button(ui('開く','Open'));open.onclick=()=>onOpen(source);actions.append(open);return actions;}
 function renderInbox(){
  const value=inboxState(),filter=$('#inbox-filter').value,items=(value.items||[]).filter(item=>filter==='unread'?item.readAt===null:filter==='completed'?item.status==='completed':filter==='attention'?['failed','paused','attention'].includes(item.status):true);
  $('#inbox-unread-count').textContent=String(value.unreadCount||0);$('#inbox-tab-count').textContent=String(value.unreadCount||0);
  const key=JSON.stringify([value.items,filter]);if(key!==keys.inbox){keys.inbox=key;const list=$('#inbox-list');list.replaceChildren();
   for(const item of items){const row=node('article',undefined,'inbox-item activity-card'+(item.readAt===null?' is-unread':''));row.dataset.inboxId=item.id;row.dataset.status=item.status;
    const heading=node('div',undefined,'activity-item-heading');heading.append(node('h3',item.title),node('span',(item.readAt===null?ui('未読 · ','Unread · '):'')+(statusLabels[item.status]||item.status),'activity-status'));row.append(heading,node('p',item.body),node('small',dateLabel(item.occurredAt),'activity-time'));
    const actions=node('div',undefined,'activity-actions');actions.append(button(ui('開く','Open'),'inboxOpen',item.id),button(item.readAt===null?ui('既読にする','Mark as read'):ui('未読に戻す','Mark as unread'),'inboxRead',item.id));row.append(actions);list.append(row);
   }
   if(!items.length)list.append(node('p',filter==='all'?ui('通知はまだありません。','No notifications yet.'):ui('この条件に合う通知はありません。','No notifications match this filter.'),'module-note'));
  }
  $('#inbox-refresh').disabled=demo||busy.inbox;$('#inbox-read-all').disabled=demo||busy.inbox||!value.unreadCount;
  for(const element of document.querySelectorAll('[data-inbox-read]'))element.disabled=demo||busy.inbox;
  for(const element of document.querySelectorAll('[data-inbox-open]'))element.disabled=busy.inbox;
 }
 function reportEntries(container,items,dated){
  container.replaceChildren();for(const event of items){const entry=node('div',undefined,'report-event');entry.dataset.reportKind=event.kind;entry.append(node('strong',(dated?dateLabel(event.timestamp)+' · ':'')+(activityLabels[event.kind]||event.kind||ui('記録','Record'))+' · '+event.title),node('span',statusLabels[event.status]||event.status||'','activity-status'));if(event.detail)entry.append(node('p',event.detail));if(event.target)entry.append(actionRow(event.target));container.append(entry);}
 }
 function renderReports(){
  const key=JSON.stringify([report,reportKey]);if(keys.report!==key){keys.report=key;
   reportEntries($('#report-activities'),report?.activities||[],true);reportEntries($('#report-undated'),report?.undated||[],false);reportEntries($('#report-current'),report?.current||[],false);
   if(!report?.activities?.length)$('#report-activities').append(node('p',report?ui('この日の日時付き記録はありません。','No dated activity for this day.'):ui('保存済みの本文を表示しています。活動を確認するには「記録から作成」を選んでください。','Showing the saved report. Choose Build from records to see activity.'),'module-note'));
   const undated=report?.undated.length||0,current=report?.current.length||0;
   $('#report-undated-summary').textContent=ui(`日時不明 ${undated}件 / 現在の状態 ${current}件`,`Undated records: ${undated} / Current items: ${current}`);
   $('#report-summary').textContent=report?report.date+' · '+report.timeZone+' · '+ui(
    `会話 ${report.counts.messages}件 / TODO完了 ${report.counts.todosCompleted}件 / クエスト完了 ${report.counts.questsCompleted}件`,
    `Messages: ${report.counts.messages} / To-dos completed: ${report.counts.todosCompleted} / Quests completed: ${report.counts.questsCompleted}`):'';
  }
  let matches=false;try{matches=reportKey===selectionKey(selection());}catch{}
  $('#report-save').disabled=demo||busy.report||!matches||!$('#report-markdown').value.trim();$('#report-load').disabled=demo||busy.report;$('#report-build').disabled=busy.report;$('#report-copy').disabled=busy.report||!$('#report-markdown').value;
  $('#report-date').disabled=busy.report;$('#report-timezone').disabled=busy.report;$('#report-markdown').readOnly=busy.report;
  const saved=reportState().items||[],savedKey=JSON.stringify(saved);$('#report-saved-count').textContent=String(saved.length);
  if(keys.saved!==savedKey){keys.saved=savedKey;const list=$('#report-saved-list');list.replaceChildren();for(const item of saved){const open=button(ui(`${item.date} · ${item.timeZone}を開く`,`Open ${item.date} · ${item.timeZone}`));open.dataset.reportSaved=item.id;open.onclick=()=>{$('#report-date').value=item.date;$('#report-timezone').value=item.timeZone;loadReport();};list.append(open);}if(!saved.length)list.append(node('p',ui('保存済みの日報はありません。','No saved reports yet.'),'module-note'));}
  for(const element of document.querySelectorAll('[data-report-saved]'))element.disabled=demo||busy.report;
 }
 function renderScheduleTargets(){
  const action=$('#schedule-action').value,chats=getChats()||[],todos=getState()?.todos?.items||[],key=JSON.stringify([action,chats.map(chat=>[chat.id,chat.title]),todos.map(item=>[item.id,item.title])]);
  if(keys.targets===key)return;keys.targets=key;
  const select=$('#schedule-target'),selected=select.value;select.replaceChildren();
  if(action==='notify')select.add(new Option(ui('対象なし','None'),'none'));
  if(action!=='chat')select.add(new Option(ui('酒場のクエスト','Tavern quest'),'party'));
  if(action!=='party')for(const chat of chats)select.add(new Option(ui('チャット: ','Chat: ')+chat.title,'chat:'+chat.id));
  if(action==='notify')for(const item of todos)select.add(new Option('TODO: '+item.title,'todo:'+item.id));
  if(Array.from(select.options).some(option=>option.value===selected))select.value=selected;
  else if(selected.startsWith('chat:')&&action!=='party'){select.add(new Option(ui('見つからない対象（選び直してください）','Target unavailable (choose another)'),selected));select.value=selected;}
  else select.value=action==='party'?'party':action==='notify'?'none':select.options[0]?.value||'';
 }
 function renderScheduleModels(){
  const models=getState()?.models||[],selected=$('#schedule-model'),current=getModel()||{};
  if(!modelInitialized&&models.length){if(models.some(model=>model.model===current.model))selected.dataset.initial=current.model;modelInitialized=true;}
  const key=JSON.stringify(models);
  if(keys.scheduleModels!==key||selected.dataset.initial){
   keys.scheduleModels=key;const previous=selected.dataset.initial||selected.value;delete selected.dataset.initial;selected.replaceChildren();
   for(const model of models)selected.add(new Option(model.displayName||model.model,model.model));
   if(previous&&!models.some(model=>model.model===previous))selected.add(new Option(previous+ui('（現在利用できません）',' (currently unavailable)'),previous));
   if(previous)selected.value=previous;else if(models.length)selected.value=(models.find(model=>model.isDefault)||models[0]).model;
   else selected.add(new Option(ui('接続後にモデルを取得','Connect to load models'),''));
  }
  const model=models.find(model=>model.model===selected.value),effort=$('#schedule-effort'),choices=model?.supportedReasoningEfforts?.length?model.supportedReasoningEfforts.map(choice=>choice.reasoningEffort):['medium'],effortKey=JSON.stringify([selected.value,choices]);
  if(keys.scheduleEfforts!==effortKey){keys.scheduleEfforts=effortKey;const previous=effort.value||current.effort;effort.replaceChildren();for(const choice of choices)effort.add(new Option(choice.toUpperCase(),choice));effort.value=choices.includes(previous)?previous:model?.defaultReasoningEffort||choices[0];}
 }
 function renderScheduleEditor(){
  const action=$('#schedule-action').value,automatic=action!=='notify',party=getState()?.party?.party;
  $('#schedule-execution-fields').hidden=!automatic;$('#schedule-text').required=automatic;$('#schedule-model').required=automatic;
  $('#schedule-target-label').textContent=action==='chat'?ui('自動開始するチャット','Chat to start'):action==='party'?ui('自動開始するパーティ','Party to start'):ui('通知から開く対象','Open from notification');
  $('#schedule-text-label').textContent=action==='party'?ui('パーティに渡すクエスト','Quest for the party'):ui('チャットに渡す本文','Message for the chat');
  $('#schedule-editor-title').textContent=(editingSchedule?ui('予約を編集 · ','Edit schedule · '):ui('予約を作成 · ','New schedule · '))+scheduleActions[action];
  $('#schedule-party-note').hidden=action!=='party';
  $('#schedule-party-note').textContent=party?.members?.length?ui(
   `保存時のパーティ「${party.name}」の仲間 ${party.members.length}人・役割・リーダーを予約に記録します。開始時に構成が変わっていた場合は停止します。`,
   `This schedule records the members (${party.members.length}), roles, and leader of “${party.name}”. If the party changes before it starts, the run will stop.`):ui('酒場で仲間とリーダーを選び、パーティを保存してから予約してください。','Choose members and a leader in the tavern, then save your party before scheduling.');
  $('#schedule-action-note').textContent=automatic?ui('過去の日時を保存すると、MasterがONのときに開始します。アプリ終了中に期限を迎えた予約は、次の起動時に確認します。停止した予約の再実行は、結果を確認してから手動で選んでください。','With automation on, a past start time runs when you save it. The app checks overdue schedules when it reopens. Review the result before manually retrying a stopped run.'):ui('過去の日時も指定できます。MasterをONにすると通知します。通知済みの予約を再び通知するには、編集して保存してください。','You can choose a past time. Turn on automation to send the notification. To send an existing notification again, edit and save its schedule.');
  renderScheduleTargets();renderScheduleModels();
 }
 function renderSchedules(){
  const value=scheduleState(),enabled=Boolean(value.enabled),followup=Boolean(value.followup);
  $('#schedule-count').textContent=String((value.items||[]).filter(item=>item.enabled&&item.status==='pending').length);$('#automation-badge').textContent=enabled?'ON':'OFF';$('#followup-badge').textContent=followup?(enabled?'ON':ui('ON · Master待ち','On · Waiting for automation')):'OFF';$('#automation-state').textContent=ui('通知と予約の自動開始 · ','Scheduled notifications and automatic starts · ')+(enabled?'ON':'OFF');
  for(const element of document.querySelectorAll('[data-automation-switch]'))element.dataset.enabled=String(enabled);
  for(const element of document.querySelectorAll('[data-followup-switch]'))element.dataset.enabled=String(enabled&&followup);
  if(!busy.schedule){$('#automation-enabled').checked=enabled;$('#followup-enabled').checked=followup;}
  if(!zoneDirty&&document.activeElement!==$('#schedule-timezone'))$('#schedule-timezone').value=value.timeZone;
  $('#schedule-master-note').textContent=enabled?ui('Master ON · 期限を迎えた予約を確認し、通知または自動開始します。','Automation on · Due schedules send notifications or start automatically.'):ui('Master OFF · 予約は保存できますが、新しい通知や自動開始は行いません。開始済みの処理は各予約から停止できます。','Automation off · You can save schedules. New notifications and runs are paused. Active runs can be stopped from their schedules.');
  renderScheduleEditor();
  const key=JSON.stringify(value.items);if(keys.schedules!==key){keys.schedules=key;const list=$('#schedule-list');list.replaceChildren();for(const item of value.items||[]){
   const action=item.action||'notify',active=scheduleActive(item),uncertain=item.status==='uncertain',row=node('article',undefined,'schedule-item activity-card');row.dataset.scheduleId=item.id;row.dataset.status=item.status;
   row.append(node('h3',item.title),node('p',dateLabel(item.dueAt)+' · '+(scheduleActions[action]||action)),node('span',(item.enabled?'ON':'OFF')+' · '+(scheduleStatuses[item.status]||item.status),'activity-status'));
   if(action!=='notify'){
    row.append(node('p',ui('モデル: ','Model: ')+item.model+' / '+item.effort,'schedule-model-caption'));
    const detail=node('details',undefined,'schedule-content');detail.append(node('summary',action==='party'?ui('クエストと予約したパーティを確認','Review the quest and scheduled party'):ui('予約した本文を確認','Review scheduled message')),node('p',item.text));
    if(item.party){detail.append(node('p',ui('パーティ: ','Party: ')+item.party.name));for(const member of item.party.members||[])detail.append(node('p',(member.conversationId===item.party.leaderId?ui('リーダー · ','Leader · '):member.role+' · ')+(member.title||member.conversationId)));}row.append(detail);
   }
   if(item.error)row.append(node('p',item.error,'schedule-run-error'));
   if(item.attempt){const times=[[ui('開始確認','Start confirmed'),item.attempt.startedAt],[ui('受付','Accepted'),item.attempt.acceptedAt],[ui('終了','Finished'),item.attempt.finishedAt]].filter(([,time])=>Number.isFinite(time));row.append(node('p',times.map(([label,time])=>label+': '+dateLabel(time)).join(' / '),'schedule-attempt'));}
   const actions=node('div',undefined,'activity-actions');
   for(const [label,attribute] of [[ui('編集','Edit'),'scheduleEdit'],[item.enabled?ui('OFFにする','Turn off'):ui('ONにする','Turn on'),'scheduleToggle'],[ui('削除','Delete'),'scheduleRemove']]){const control=button(label,attribute,item.id);control.dataset.scheduleLocked=String(attribute==='scheduleRemove'?active:active||uncertain);actions.append(control);}
   if(active){const stop=button(ui('実行を停止','Stop run'),'scheduleStop',item.id);actions.append(stop);}
   const target=item.attempt?.questId?{type:'party',questId:item.attempt.questId}:item.attempt?.conversationId?{type:'chat',conversationId:item.attempt.conversationId}:item.target;
   if(target?.type!=='none'){const open=button(item.attempt?ui('実行結果を開く','Open result'):ui('対象を開く','Open target'));open.onclick=()=>onOpen({type:'schedule',scheduleId:item.id,target});actions.append(open);}
   row.append(actions);
   if(action!=='notify'&&['blocked','failed','uncertain'].includes(item.status)){
    const confirmation=node('label',undefined,'module-checkbox schedule-rearm-confirm'),check=document.createElement('input');check.type='checkbox';check.dataset.scheduleConfirm=item.id;confirmation.append(check,document.createTextNode(ui('前の実行結果と利用枠を確認し、同じ内容の再実行を許可する','I reviewed the previous result and available quota and approve running this again.')));const rearm=button(ui('確認して再予約','Confirm and reschedule'),'scheduleRearm',item.id);rearm.disabled=true;row.append(confirmation,rearm);
    if(uncertain)row.append(node('p',ui('前の処理が実行済みの可能性があります。結果を確認せずに再予約すると、同じ内容が再び処理されます。','The previous run may have completed. Check its result before rescheduling to avoid running it twice.'),'module-note'));
   }
   list.append(row);
  }if(!list.children.length)list.append(node('p',ui('日時と操作を選んで予約できます。','Choose a time and an action to create a schedule.'),'module-note'));}
  for(const element of document.querySelectorAll('#schedule-form input,#schedule-form textarea,#schedule-form select,#schedule-form button,#automation-form input,#automation-form button,#automation-enabled,#followup-enabled,[data-schedule-edit],[data-schedule-toggle],[data-schedule-remove],[data-schedule-stop],[data-schedule-confirm]'))element.disabled=demo||busy.schedule||element.dataset.scheduleLocked==='true';
  for(const control of document.querySelectorAll('[data-schedule-rearm]')){const check=Array.from(document.querySelectorAll('[data-schedule-confirm]')).find(element=>element.dataset.scheduleConfirm===control.dataset.scheduleRearm);control.disabled=demo||busy.schedule||!check?.checked;}
 }
 function render(){renderInbox();renderReports();renderSchedules();}
 async function refreshInbox(){if(demo){render();return;}await perform('inbox',async()=>setState('inbox',await api('inbox')));}
 async function buildReport(){await perform('report',async()=>{const selected=selection(),value=demo?buildDailyReport({...selected,conversations:getChats(),todos:getState()?.todos,party:getState()?.party,contextBoard:getContextBoard()}):await api('reports/build',selected);report=value;reportKey=selectionKey(selected);reportStarted=true;$('#report-markdown').value=dailyReportMarkdown(value);$('#report-notice').textContent=ui('記録から日報を作成しました。編集後に「アプリ内に保存」で残せます。','Report created from records. After editing, choose Save in app to keep it.');});}
 async function loadReport(){if(demo)return;await perform('report',async()=>{const selected=selection(),value=await api('reports/item',selected);if(!value)throw Error(ui('選択した日付・タイムゾーンの日報は保存されていません。','No report was saved for this date and time zone.'));report=null;reportKey=selectionKey(selected);reportStarted=true;$('#report-markdown').value=value.markdown;$('#report-notice').textContent=ui(`${value.date} · ${value.timeZone}の保存済み本文を開きました。保存日時: ${dateLabel(value.updatedAt)}`,
   `Opened the report for ${value.date} · ${value.timeZone}. Saved ${dateLabel(value.updatedAt)}.`);});}
 function clearSchedule(){editingSchedule=null;$('#schedule-title').value='';$('#schedule-due').value='';$('#schedule-action').value='notify';$('#schedule-text').value='';keys.targets='';renderScheduleEditor();$('#schedule-target').value='none';}
 async function configure(values){if(demo)return;await perform('schedule',async()=>{setState('schedules',await api('schedules/configure',values));});}
 $('#inbox-filter').onchange=renderInbox;$('#inbox-refresh').onclick=refreshInbox;
 $('#inbox-read-all').onclick=()=>{if(!demo)perform('inbox',async()=>setState('inbox',await api('inbox/read-all')));};
 $('#inbox-list').onclick=async event=>{const open=event.target.closest('[data-inbox-open]'),read=event.target.closest('[data-inbox-read]'),id=open?.dataset.inboxOpen||read?.dataset.inboxRead,item=inboxState().items.find(item=>item.id===id);if(!item||busy.inbox)return;if(open){if(!demo&&item.readAt===null)await perform('inbox',async()=>setState('inbox',await api('inbox/read',{id,read:true})));onOpen(item.source);}else if(!demo)await perform('inbox',async()=>setState('inbox',await api('inbox/read',{id,read:item.readAt===null})));};
 $('#report-build').onclick=buildReport;$('#report-load').onclick=loadReport;
 $('#report-save').onclick=()=>{if(demo)return;perform('report',async()=>{const selected=selection();if(reportKey!==selectionKey(selected))throw Error(ui('この日付の日報を作成するか、保存済みの本文を開いてください。','Build a report for this date or open the saved report.'));setState('reports',await api('reports/save',{...selected,markdown:$('#report-markdown').value}));$('#report-notice').textContent=ui('日報をアプリ内に保存しました。','Report saved in the app.');});};
 $('#report-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#report-markdown').value);notify(ui('日報の本文をコピーしました。','Report text copied.'));}catch{$('#report-markdown').focus();$('#report-markdown').select();notify(ui('コピーできませんでした。選択された本文を手動でコピーしてください。','Copy failed. Copy the selected text manually.'));}};
 $('#report-markdown').oninput=()=>{$('#report-notice').textContent=ui('本文を編集中です。「アプリ内に保存」で変更を残せます。','Editing report. Choose Save in app to keep your changes.');renderReports();};
 for(const id of ['report-date','report-timezone'])$('#'+id).oninput=()=>{$('#report-notice').textContent=ui('日付・タイムゾーンを変更したら「記録から作成」または「保存済みを開く」を選んでください。','After changing the date or time zone, choose Build from records or Open saved report.');renderReports();};
 $('#automation-enabled').onchange=()=>configure({enabled:$('#automation-enabled').checked});$('#followup-enabled').onchange=()=>configure({followup:$('#followup-enabled').checked});
 $('#schedule-timezone').oninput=()=>{zoneDirty=true;};$('#automation-form').onsubmit=async event=>{event.preventDefault();await configure({timeZone:$('#schedule-timezone').value.trim()});zoneDirty=false;render();};
 $('#schedule-new').onclick=clearSchedule;
 $('#schedule-action').onchange=()=>{keys.targets='';renderScheduleEditor();};$('#schedule-model').onchange=renderScheduleModels;
 $('#schedule-form').onsubmit=event=>{event.preventDefault();if(demo)return;perform('schedule',async()=>{
  const due=$('#schedule-due').value,dueAt=new Date(due).getTime();if(!due||!Number.isFinite(dueAt)||localInput(dueAt)!==due)throw Error(ui('開始する日時を確認してください。','Check the start date and time.'));
  const action=$('#schedule-action').value,choice=$('#schedule-target').value,target=choice==='none'||choice==='party'?{type:choice}:{type:choice.slice(0,choice.indexOf(':')),id:choice.slice(choice.indexOf(':')+1)};
  if(action==='chat'&&target.type!=='chat')throw Error(ui('自動開始するチャットを選んでください。','Choose the chat to start automatically.'));
  const execution=action==='notify'?{}:{text:$('#schedule-text').value,model:$('#schedule-model').value,effort:$('#schedule-effort').value};
  if(action!=='notify'&&(!execution.text.trim()||!execution.model))throw Error(ui('開始する本文と使用するモデルを入力してください。','Enter a message and select a model.'));
  setState('schedules',await api('schedules/save',{...(editingSchedule?{id:editingSchedule}:{}),action,title:$('#schedule-title').value,dueAt,target,...execution}));clearSchedule();notify(ui('予約を保存しました。','Schedule saved.'));
 });};
 $('#schedule-list').onchange=event=>{if(event.target.closest('[data-schedule-confirm]'))renderSchedules();};
 $('#schedule-list').onclick=event=>{
  const edit=event.target.closest('[data-schedule-edit]'),toggle=event.target.closest('[data-schedule-toggle]'),remove=event.target.closest('[data-schedule-remove]'),rearm=event.target.closest('[data-schedule-rearm]'),stop=event.target.closest('[data-schedule-stop]'),id=edit?.dataset.scheduleEdit||toggle?.dataset.scheduleToggle||remove?.dataset.scheduleRemove||rearm?.dataset.scheduleRearm||stop?.dataset.scheduleStop,item=scheduleState().items.find(item=>item.id===id);
  if(!item||demo||busy.schedule)return;
  if(edit){
   if(scheduleActive(item)||item.status==='uncertain')return;editingSchedule=id;$('#schedule-title').value=item.title;$('#schedule-due').value=localInput(item.dueAt);$('#schedule-action').value=item.action||'notify';$('#schedule-text').value=item.text||'';keys.targets='';renderScheduleEditor();
   const choice=item.target?.type==='chat'||item.target?.type==='todo'?item.target.type+':'+item.target.id:item.target?.type||'none';if(!Array.from($('#schedule-target').options).some(option=>option.value===choice))$('#schedule-target').add(new Option(ui('見つからない対象（選び直してください）','Target unavailable (choose another)'),choice));$('#schedule-target').value=choice;
   if(item.model){modelInitialized=true;if(!Array.from($('#schedule-model').options).some(option=>option.value===item.model))$('#schedule-model').add(new Option(item.model+ui('（現在利用できません）',' (currently unavailable)'),item.model));$('#schedule-model').value=item.model;renderScheduleModels();if(!Array.from($('#schedule-effort').options).some(option=>option.value===item.effort))$('#schedule-effort').add(new Option(item.effort+ui('（現在利用できません）',' (currently unavailable)'),item.effort));$('#schedule-effort').value=item.effort;}
   $('#schedule-title').focus();return;
  }
  perform('schedule',async()=>{
   let route,body={id};if(rearm){const check=Array.from(document.querySelectorAll('[data-schedule-confirm]')).find(element=>element.dataset.scheduleConfirm===id);if(!check?.checked)throw Error(ui('前の実行結果と利用枠を確認してください。','Review the previous result and available quota.'));route='schedules/rearm';body={id,generation:item.generation,confirmed:true};}else if(stop){route='schedules/stop';body={id,generation:item.generation};}else{route=remove?'schedules/remove':'schedules/toggle';if(toggle)body.enabled=!item.enabled;}
   setState('schedules',await api(route,body));if(remove&&editingSchedule===id)clearSchedule();
  });
 };
 render();return {render,open:view=>{render();if(view==='inbox')return refreshInbox();if(view==='reports'&&!reportStarted)return buildReport();}};
}
