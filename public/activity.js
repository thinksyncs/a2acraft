import {buildDailyReport,dailyReportMarkdown,validateDailyReportDate} from './daily-report.js';

const $=selector=>document.querySelector(selector);
const node=(tag,value,className)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
const button=(label,attribute,id)=>{const value=node('button',label,'outline');value.type='button';if(attribute)value.dataset[attribute]=id;return value;};
const dateLabel=value=>Number.isFinite(value)?new Date(value).toLocaleString('ja-JP'):'発生日時不明';
const statusLabels={completed:'完了',failed:'失敗',paused:'中断中',attention:'確認',doing:'進行中',running:'実行中',stopping:'停止待ち',starting:'開始中',sent:'送信',recorded:'応答の記録',started:'開始',created:'登録',cancelled:'終了',blocked:'開始できません',interrupted:'結果未確認',shared:'共有',attached:'送信済み'};
const scheduleActions={notify:'Inboxへ通知',chat:'チャットを自動開始',party:'パーティのクエストを自動開始'};
const scheduleStatuses={pending:'時刻待ち',starting:'開始中',running:'実行中',completed:'完了',blocked:'停止 · 確認が必要',failed:'失敗',uncertain:'結果未確認 · 自動再開なし',notified:'通知済み',cancelled:'停止済み'};
const scheduleActive=item=>['starting','running','stopping'].includes(item?.status);
const activityLabels={message:'会話','todo-created':'TODO登録','todo-completed':'TODO完了','todo-run-started':'TODO処理開始','todo-run-completed':'TODO処理完了','todo-run-failed':'TODO失敗・中断','quest-started':'クエスト開始','quest-completed':'クエスト完了','quest-step-started':'役割開始','quest-step-completed':'役割完了','quest-step-failed':'役割失敗・中断','context-shared':'共有','context-attached':'共有内容送信'};
const localInput=value=>{const date=new Date(value),pad=part=>String(part).padStart(2,'0');return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());};
function dayInZone(zone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now()).map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day;}

export function initActivity({api,getState,getChats,getModel=()=>({}),getContextBoard,onState,onOpen,notify,demo=false}){
 $('#inbox-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">LOCAL INBOX</div><h2 id="inbox-title">お知らせ <span id="inbox-unread-count" class="count-badge">0</span></h2><p>チャット・TODO・クエストの完了やエラー、予約した通知をここで確認できます。</p></div><div class="activity-actions"><button id="inbox-refresh" type="button" class="outline">更新</button><button id="inbox-read-all" type="button" class="outline">すべて既読にする</button></div></div><label class="activity-filter" for="inbox-filter">表示 <select id="inbox-filter"><option value="all">すべて</option><option value="unread">未読</option><option value="completed">完了</option><option value="attention">エラー・中断・確認</option></select></label><p id="inbox-error" class="module-error" role="alert" hidden></p><div id="inbox-list" class="activity-list" aria-live="polite"></div>`;
 $('#reports-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">DAILY REPORT · LOCAL RECORDS</div><h2 id="report-title">日報</h2><p>選んだ日の記録から日報を作ります。本文を編集し、アプリ内に保存できます。</p></div></div><div class="report-controls"><label for="report-date">日付<input id="report-date" type="date" required></label><label for="report-timezone">集計するタイムゾーン<input id="report-timezone" value="Asia/Tokyo" maxlength="100" placeholder="Asia/Tokyo" required></label><button id="report-build" type="button" class="primary">記録から作成</button><button id="report-load" type="button" class="outline">保存済みを開く</button></div><p id="report-error" class="module-error" role="alert" hidden></p><p id="report-notice" class="module-note" role="status"></p><p id="report-summary" class="module-note"></p><div class="report-layout"><div class="activity-card"><h3>日時付きの活動</h3><div id="report-activities" class="activity-list"></div><details id="report-undated-details"><summary id="report-undated-summary">日時不明・現在の状態</summary><div id="report-undated"></div><div id="report-current"></div></details></div><div class="activity-card report-editor"><label for="report-markdown">日報の本文（Markdown・編集可）</label><textarea id="report-markdown" maxlength="100000" rows="16" spellcheck="false"></textarea><div class="activity-actions"><button id="report-save" type="button" class="primary">アプリ内に保存</button><button id="report-copy" type="button" class="outline">本文をコピー</button></div><p class="module-note">日時不明の記録を当日の実績に含めません。会話の返信だけで作業完了とは扱いません。</p></div></div><details class="report-saved"><summary>保存済みの日報 <span id="report-saved-count">0</span>件</summary><div id="report-saved-list"></div></details>`;
 $('#schedules-view').innerHTML=`<div class="module-heading"><div><div class="eyebrow">SCHEDULED TASKS</div><h2 id="schedule-title-heading">予約</h2><p>指定した日時に通知、チャット、パーティのクエストを開始します。アプリが閉じていた間の予約は、次の起動時に確認します。</p></div></div><p id="schedule-error" class="module-error" role="alert" hidden></p><section class="activity-card automation-settings"><h3>自動実行と通知の設定</h3><label class="module-checkbox"><input id="automation-enabled" type="checkbox"> Automation Master · 通知と予約の自動開始をONにする</label><label class="module-checkbox"><input id="followup-enabled" type="checkbox"> Auto Followup · 期限超過のTODOと中断中のクエストを1日1回通知</label><form id="automation-form" class="activity-actions"><label for="schedule-timezone">フォローアップの基準タイムゾーン<input id="schedule-timezone" value="Asia/Tokyo" maxlength="100" required></label><button id="automation-save" type="submit" class="outline">タイムゾーンを保存</button></form><p id="schedule-master-note" class="module-note" role="status"></p><p class="module-note">自動開始は保存した本文・モデルで行います。利用枠不足や開始後の再起動で停止した予約は、自動では再実行しません。読み取り専用設定は維持します。Teams返信の送信は専用画面で確認してください。</p></section><div class="schedule-layout"><form id="schedule-form" class="activity-card activity-form"><h3 id="schedule-editor-title">通知を予約</h3><label for="schedule-action">予約する操作<select id="schedule-action"><option value="notify">Inboxへ通知</option><option value="chat">チャットを自動開始</option><option value="party">パーティのクエストを自動開始</option></select></label><label for="schedule-title">予約のタイトル<input id="schedule-title" maxlength="120" required></label><label for="schedule-due">開始する日時<input id="schedule-due" type="datetime-local" required></label><p id="schedule-device-zone" class="module-note"></p><label for="schedule-target"><span id="schedule-target-label">通知から開く対象</span><select id="schedule-target"><option value="none">対象なし</option><option value="party">酒場のクエスト</option></select></label><div id="schedule-execution-fields" class="schedule-execution-fields" hidden><label for="schedule-text"><span id="schedule-text-label">チャットに渡す本文</span><textarea id="schedule-text" maxlength="8000" rows="5" placeholder="指定した時刻に処理する内容"></textarea></label><div class="schedule-model-fields"><label for="schedule-model">使用するモデル<select id="schedule-model"></select></label><label for="schedule-effort">思考の深さ<select id="schedule-effort"></select></label></div><p id="schedule-party-note" class="module-note" hidden></p><p class="module-note">保存した本文とモデルを予約ごとに使用します。利用枠が不足した場合は停止し、枠の回復後も手動で再予約するまで開始しません。</p></div><div class="activity-actions"><button id="schedule-save" type="submit" class="primary">予約を保存</button><button id="schedule-new" type="button" class="outline">新規の予約に戻す</button></div><p id="schedule-action-note" class="module-note">過去の日時も指定できます。MasterをONにすると通知します。通知済みの予約を再び通知するには、編集して保存してください。</p></form><div><h3>保存済みの予約</h3><div id="schedule-list" class="activity-list"></div></div></div>`;
 // Keep keyboard order aligned with the primary reservation form's position.
 $('#schedules-view').insertBefore($('#schedules-view .schedule-layout'),$('#schedules-view .automation-settings'));
 const busy={inbox:false,report:false,schedule:false},keys={};let editingSchedule=null,zoneDirty=false,report=null,reportKey=null,reportStarted=false,modelInitialized=false;
 const emptyInbox={items:[],unreadCount:0},emptySchedules={enabled:false,followup:false,timeZone:'Asia/Tokyo',items:[]};
 const inboxState=()=>demo?emptyInbox:getState()?.inbox||emptyInbox;
 const scheduleState=()=>demo?emptySchedules:getState()?.schedules||emptySchedules;
 const reportState=()=>demo?{items:[]}:getState()?.reports||{items:[]};
 $('#report-date').value=dayInZone('Asia/Tokyo');
 $('#schedule-device-zone').textContent='日時の入力は端末のタイムゾーン（'+Intl.DateTimeFormat().resolvedOptions().timeZone+'）です。';
 function error(section,message){const element=$('#'+section+'-error');element.hidden=!message;element.textContent=message||'';}
 async function perform(section,operation){
  if(busy[section])return false;busy[section]=true;error(section==='report'?'report':section==='schedule'?'schedule':'inbox','');render();
  try{await operation();return true;}catch(value){error(section,value.message||'操作を完了できませんでした。');return false;}finally{busy[section]=false;render();}
 }
 function setState(kind,value){onState(kind,value);render();}
 function selection(){return validateDailyReportDate($('#report-date').value,$('#report-timezone').value.trim());}
 const selectionKey=value=>value.date+'@'+value.timeZone;
 function actionRow(source){const actions=node('div',undefined,'activity-actions'),open=button('開く');open.onclick=()=>onOpen(source);actions.append(open);return actions;}
 function renderInbox(){
  const value=inboxState(),filter=$('#inbox-filter').value,items=(value.items||[]).filter(item=>filter==='unread'?item.readAt===null:filter==='completed'?item.status==='completed':filter==='attention'?['failed','paused','attention'].includes(item.status):true);
  $('#inbox-unread-count').textContent=String(value.unreadCount||0);$('#inbox-tab-count').textContent=String(value.unreadCount||0);
  const key=JSON.stringify([value.items,filter]);if(key!==keys.inbox){keys.inbox=key;const list=$('#inbox-list');list.replaceChildren();
   for(const item of items){const row=node('article',undefined,'inbox-item activity-card'+(item.readAt===null?' is-unread':''));row.dataset.inboxId=item.id;row.dataset.status=item.status;
    const heading=node('div',undefined,'activity-item-heading');heading.append(node('h3',item.title),node('span',(item.readAt===null?'未読 · ':'')+(statusLabels[item.status]||item.status),'activity-status'));row.append(heading,node('p',item.body),node('small',dateLabel(item.occurredAt),'activity-time'));
    const actions=node('div',undefined,'activity-actions');actions.append(button('開く','inboxOpen',item.id),button(item.readAt===null?'既読にする':'未読に戻す','inboxRead',item.id));row.append(actions);list.append(row);
   }
   if(!items.length)list.append(node('p',filter==='all'?'通知はまだありません。':'この条件に合う通知はありません。','module-note'));
  }
  $('#inbox-refresh').disabled=demo||busy.inbox;$('#inbox-read-all').disabled=demo||busy.inbox||!value.unreadCount;
  for(const element of document.querySelectorAll('[data-inbox-read]'))element.disabled=demo||busy.inbox;
  for(const element of document.querySelectorAll('[data-inbox-open]'))element.disabled=busy.inbox;
 }
 function reportEntries(container,items,dated){
  container.replaceChildren();for(const event of items){const entry=node('div',undefined,'report-event');entry.dataset.reportKind=event.kind;entry.append(node('strong',(dated?dateLabel(event.timestamp)+' · ':'')+(activityLabels[event.kind]||event.kind||'記録')+' · '+event.title),node('span',statusLabels[event.status]||event.status||'','activity-status'));if(event.detail)entry.append(node('p',event.detail));if(event.target)entry.append(actionRow(event.target));container.append(entry);}
 }
 function renderReports(){
  const key=JSON.stringify([report,reportKey]);if(keys.report!==key){keys.report=key;
   reportEntries($('#report-activities'),report?.activities||[],true);reportEntries($('#report-undated'),report?.undated||[],false);reportEntries($('#report-current'),report?.current||[],false);
   if(!report?.activities?.length)$('#report-activities').append(node('p',report?'この日の日時付き記録はありません。':'保存済みの本文を表示しています。活動を確認するには「記録から作成」を選んでください。','module-note'));
   $('#report-undated-summary').textContent='日時不明 '+(report?.undated.length||0)+'件 / 現在の状態 '+(report?.current.length||0)+'件';
   $('#report-summary').textContent=report?report.date+' · '+report.timeZone+' · 会話 '+report.counts.messages+'件 / TODO完了 '+report.counts.todosCompleted+'件 / クエスト完了 '+report.counts.questsCompleted+'件':'';
  }
  let matches=false;try{matches=reportKey===selectionKey(selection());}catch{}
  $('#report-save').disabled=demo||busy.report||!matches||!$('#report-markdown').value.trim();$('#report-load').disabled=demo||busy.report;$('#report-build').disabled=busy.report;$('#report-copy').disabled=busy.report||!$('#report-markdown').value;
  $('#report-date').disabled=busy.report;$('#report-timezone').disabled=busy.report;$('#report-markdown').readOnly=busy.report;
  const saved=reportState().items||[],savedKey=JSON.stringify(saved);$('#report-saved-count').textContent=String(saved.length);
  if(keys.saved!==savedKey){keys.saved=savedKey;const list=$('#report-saved-list');list.replaceChildren();for(const item of saved){const open=button(item.date+' · '+item.timeZone+'を開く');open.dataset.reportSaved=item.id;open.onclick=()=>{$('#report-date').value=item.date;$('#report-timezone').value=item.timeZone;loadReport();};list.append(open);}if(!saved.length)list.append(node('p','保存済みの日報はありません。','module-note'));}
  for(const element of document.querySelectorAll('[data-report-saved]'))element.disabled=demo||busy.report;
 }
 function renderScheduleTargets(){
  const action=$('#schedule-action').value,chats=getChats()||[],todos=getState()?.todos?.items||[],key=JSON.stringify([action,chats.map(chat=>[chat.id,chat.title]),todos.map(item=>[item.id,item.title])]);
  if(keys.targets===key)return;keys.targets=key;
  const select=$('#schedule-target'),selected=select.value;select.replaceChildren();
  if(action==='notify')select.add(new Option('対象なし','none'));
  if(action!=='chat')select.add(new Option('酒場のクエスト','party'));
  if(action!=='party')for(const chat of chats)select.add(new Option('チャット: '+chat.title,'chat:'+chat.id));
  if(action==='notify')for(const item of todos)select.add(new Option('TODO: '+item.title,'todo:'+item.id));
  if(Array.from(select.options).some(option=>option.value===selected))select.value=selected;
  else if(selected.startsWith('chat:')&&action!=='party'){select.add(new Option('見つからない対象（選び直してください）',selected));select.value=selected;}
  else select.value=action==='party'?'party':action==='notify'?'none':select.options[0]?.value||'';
 }
 function renderScheduleModels(){
  const models=getState()?.models||[],selected=$('#schedule-model'),current=getModel()||{};
  if(!modelInitialized&&models.length){if(models.some(model=>model.model===current.model))selected.dataset.initial=current.model;modelInitialized=true;}
  const key=JSON.stringify(models);
  if(keys.scheduleModels!==key||selected.dataset.initial){
   keys.scheduleModels=key;const previous=selected.dataset.initial||selected.value;delete selected.dataset.initial;selected.replaceChildren();
   for(const model of models)selected.add(new Option(model.displayName||model.model,model.model));
   if(previous&&!models.some(model=>model.model===previous))selected.add(new Option(previous+'（現在利用できません）',previous));
   if(previous)selected.value=previous;else if(models.length)selected.value=(models.find(model=>model.isDefault)||models[0]).model;
   else selected.add(new Option('接続後にモデルを取得',''));
  }
  const model=models.find(model=>model.model===selected.value),effort=$('#schedule-effort'),choices=model?.supportedReasoningEfforts?.length?model.supportedReasoningEfforts.map(choice=>choice.reasoningEffort):['medium'],effortKey=JSON.stringify([selected.value,choices]);
  if(keys.scheduleEfforts!==effortKey){keys.scheduleEfforts=effortKey;const previous=effort.value||current.effort;effort.replaceChildren();for(const choice of choices)effort.add(new Option(choice.toUpperCase(),choice));effort.value=choices.includes(previous)?previous:model?.defaultReasoningEffort||choices[0];}
 }
 function renderScheduleEditor(){
  const action=$('#schedule-action').value,automatic=action!=='notify',party=getState()?.party?.party;
  $('#schedule-execution-fields').hidden=!automatic;$('#schedule-text').required=automatic;$('#schedule-model').required=automatic;
  $('#schedule-target-label').textContent=action==='chat'?'自動開始するチャット':action==='party'?'自動開始するパーティ':'通知から開く対象';
  $('#schedule-text-label').textContent=action==='party'?'パーティに渡すクエスト':'チャットに渡す本文';
  $('#schedule-editor-title').textContent=(editingSchedule?'予約を編集 · ':'予約を作成 · ')+scheduleActions[action];
  $('#schedule-party-note').hidden=action!=='party';
  $('#schedule-party-note').textContent=party?.members?.length?'保存時のパーティ「'+party.name+'」の仲間 '+party.members.length+'人・役割・リーダーを予約に記録します。開始時に構成が変わっていた場合は停止します。':'酒場で仲間とリーダーを選び、パーティを保存してから予約してください。';
  $('#schedule-action-note').textContent=automatic?'過去の日時を保存すると、MasterがONのときに開始します。アプリ終了中に期限を迎えた予約は、次の起動時に確認します。停止した予約の再実行は、結果を確認してから手動で選んでください。':'過去の日時も指定できます。MasterをONにすると通知します。通知済みの予約を再び通知するには、編集して保存してください。';
  renderScheduleTargets();renderScheduleModels();
 }
 function renderSchedules(){
  const value=scheduleState(),enabled=Boolean(value.enabled),followup=Boolean(value.followup);
  $('#schedule-count').textContent=String((value.items||[]).filter(item=>item.enabled&&item.status==='pending').length);$('#automation-badge').textContent=enabled?'ON':'OFF';$('#followup-badge').textContent=followup?(enabled?'ON':'ON · Master待ち'):'OFF';$('#automation-state').textContent='通知と予約の自動開始 · '+(enabled?'ON':'OFF');
  for(const element of document.querySelectorAll('[data-automation-switch]'))element.dataset.enabled=String(enabled);
  for(const element of document.querySelectorAll('[data-followup-switch]'))element.dataset.enabled=String(enabled&&followup);
  if(!busy.schedule){$('#automation-enabled').checked=enabled;$('#followup-enabled').checked=followup;}
  if(!zoneDirty&&document.activeElement!==$('#schedule-timezone'))$('#schedule-timezone').value=value.timeZone;
  $('#schedule-master-note').textContent=enabled?'Master ON · 期限を迎えた予約を確認し、通知または自動開始します。':'Master OFF · 予約は保存できますが、新しい通知や自動開始は行いません。開始済みの処理は各予約から停止できます。';
  renderScheduleEditor();
  const key=JSON.stringify(value.items);if(keys.schedules!==key){keys.schedules=key;const list=$('#schedule-list');list.replaceChildren();for(const item of value.items||[]){
   const action=item.action||'notify',active=scheduleActive(item),uncertain=item.status==='uncertain',row=node('article',undefined,'schedule-item activity-card');row.dataset.scheduleId=item.id;row.dataset.status=item.status;
   row.append(node('h3',item.title),node('p',dateLabel(item.dueAt)+' · '+(scheduleActions[action]||action)),node('span',(item.enabled?'ON':'OFF')+' · '+(scheduleStatuses[item.status]||item.status),'activity-status'));
   if(action!=='notify'){
    row.append(node('p','モデル: '+item.model+' / '+item.effort,'schedule-model-caption'));
    const detail=node('details',undefined,'schedule-content');detail.append(node('summary',action==='party'?'クエストと予約したパーティを確認':'予約した本文を確認'),node('p',item.text));
    if(item.party){detail.append(node('p','パーティ: '+item.party.name));for(const member of item.party.members||[])detail.append(node('p',(member.conversationId===item.party.leaderId?'リーダー · ':member.role+' · ')+(member.title||member.conversationId)));}row.append(detail);
   }
   if(item.error)row.append(node('p',item.error,'schedule-run-error'));
   if(item.attempt){const times=[['開始確認',item.attempt.startedAt],['受付',item.attempt.acceptedAt],['終了',item.attempt.finishedAt]].filter(([,time])=>Number.isFinite(time));row.append(node('p',times.map(([label,time])=>label+': '+dateLabel(time)).join(' / '),'schedule-attempt'));}
   const actions=node('div',undefined,'activity-actions');
   for(const [label,attribute] of [['編集','scheduleEdit'],[item.enabled?'OFFにする':'ONにする','scheduleToggle'],['削除','scheduleRemove']]){const control=button(label,attribute,item.id);control.dataset.scheduleLocked=String(attribute==='scheduleRemove'?active:active||uncertain);actions.append(control);}
   if(active){const stop=button('実行を停止','scheduleStop',item.id);actions.append(stop);}
   const target=item.attempt?.questId?{type:'party',questId:item.attempt.questId}:item.attempt?.conversationId?{type:'chat',conversationId:item.attempt.conversationId}:item.target;
   if(target?.type!=='none'){const open=button(item.attempt?'実行結果を開く':'対象を開く');open.onclick=()=>onOpen({type:'schedule',scheduleId:item.id,target});actions.append(open);}
   row.append(actions);
   if(action!=='notify'&&['blocked','failed','uncertain'].includes(item.status)){
    const confirmation=node('label',undefined,'module-checkbox schedule-rearm-confirm'),check=document.createElement('input');check.type='checkbox';check.dataset.scheduleConfirm=item.id;confirmation.append(check,document.createTextNode('前の実行結果と利用枠を確認し、同じ内容の再実行を許可する'));const rearm=button('確認して再予約','scheduleRearm',item.id);rearm.disabled=true;row.append(confirmation,rearm);
    if(uncertain)row.append(node('p','前の処理が実行済みの可能性があります。結果を確認せずに再予約すると、同じ内容が再び処理されます。','module-note'));
   }
   list.append(row);
  }if(!list.children.length)list.append(node('p','日時と操作を選んで予約できます。','module-note'));}
  for(const element of document.querySelectorAll('#schedule-form input,#schedule-form textarea,#schedule-form select,#schedule-form button,#automation-form input,#automation-form button,#automation-enabled,#followup-enabled,[data-schedule-edit],[data-schedule-toggle],[data-schedule-remove],[data-schedule-stop],[data-schedule-confirm]'))element.disabled=demo||busy.schedule||element.dataset.scheduleLocked==='true';
  for(const control of document.querySelectorAll('[data-schedule-rearm]')){const check=Array.from(document.querySelectorAll('[data-schedule-confirm]')).find(element=>element.dataset.scheduleConfirm===control.dataset.scheduleRearm);control.disabled=demo||busy.schedule||!check?.checked;}
 }
 function render(){renderInbox();renderReports();renderSchedules();}
 async function refreshInbox(){if(demo){render();return;}await perform('inbox',async()=>setState('inbox',await api('inbox')));}
 async function buildReport(){await perform('report',async()=>{const selected=selection(),value=demo?buildDailyReport({...selected,conversations:getChats(),todos:getState()?.todos,party:getState()?.party,contextBoard:getContextBoard()}):await api('reports/build',selected);report=value;reportKey=selectionKey(selected);reportStarted=true;$('#report-markdown').value=dailyReportMarkdown(value);$('#report-notice').textContent='記録から日報を作成しました。編集後に「アプリ内に保存」で残せます。';});}
 async function loadReport(){if(demo)return;await perform('report',async()=>{const selected=selection(),value=await api('reports/item',selected);if(!value)throw Error('選択した日付・タイムゾーンの日報は保存されていません。');report=null;reportKey=selectionKey(selected);reportStarted=true;$('#report-markdown').value=value.markdown;$('#report-notice').textContent=value.date+' · '+value.timeZone+'の保存済み本文を開きました。保存日時: '+dateLabel(value.updatedAt);});}
 function clearSchedule(){editingSchedule=null;$('#schedule-title').value='';$('#schedule-due').value='';$('#schedule-action').value='notify';$('#schedule-text').value='';keys.targets='';renderScheduleEditor();$('#schedule-target').value='none';}
 async function configure(values){if(demo)return;await perform('schedule',async()=>{setState('schedules',await api('schedules/configure',values));});}
 $('#inbox-filter').onchange=renderInbox;$('#inbox-refresh').onclick=refreshInbox;
 $('#inbox-read-all').onclick=()=>{if(!demo)perform('inbox',async()=>setState('inbox',await api('inbox/read-all')));};
 $('#inbox-list').onclick=async event=>{const open=event.target.closest('[data-inbox-open]'),read=event.target.closest('[data-inbox-read]'),id=open?.dataset.inboxOpen||read?.dataset.inboxRead,item=inboxState().items.find(item=>item.id===id);if(!item||busy.inbox)return;if(open){if(!demo&&item.readAt===null)await perform('inbox',async()=>setState('inbox',await api('inbox/read',{id,read:true})));onOpen(item.source);}else if(!demo)await perform('inbox',async()=>setState('inbox',await api('inbox/read',{id,read:item.readAt===null})));};
 $('#report-build').onclick=buildReport;$('#report-load').onclick=loadReport;
 $('#report-save').onclick=()=>{if(demo)return;perform('report',async()=>{const selected=selection();if(reportKey!==selectionKey(selected))throw Error('この日付の日報を作成するか、保存済みの本文を開いてください。');setState('reports',await api('reports/save',{...selected,markdown:$('#report-markdown').value}));$('#report-notice').textContent='日報をアプリ内に保存しました。';});};
 $('#report-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#report-markdown').value);notify('日報の本文をコピーしました。');}catch{$('#report-markdown').focus();$('#report-markdown').select();notify('コピーできませんでした。選択された本文を手動でコピーしてください。');}};
 $('#report-markdown').oninput=()=>{$('#report-notice').textContent='本文を編集中です。「アプリ内に保存」で変更を残せます。';renderReports();};
 for(const id of ['report-date','report-timezone'])$('#'+id).oninput=()=>{$('#report-notice').textContent='日付・タイムゾーンを変更したら「記録から作成」または「保存済みを開く」を選んでください。';renderReports();};
 $('#automation-enabled').onchange=()=>configure({enabled:$('#automation-enabled').checked});$('#followup-enabled').onchange=()=>configure({followup:$('#followup-enabled').checked});
 $('#schedule-timezone').oninput=()=>{zoneDirty=true;};$('#automation-form').onsubmit=async event=>{event.preventDefault();await configure({timeZone:$('#schedule-timezone').value.trim()});zoneDirty=false;render();};
 $('#schedule-new').onclick=clearSchedule;
 $('#schedule-action').onchange=()=>{keys.targets='';renderScheduleEditor();};$('#schedule-model').onchange=renderScheduleModels;
 $('#schedule-form').onsubmit=event=>{event.preventDefault();if(demo)return;perform('schedule',async()=>{
  const due=$('#schedule-due').value,dueAt=new Date(due).getTime();if(!due||!Number.isFinite(dueAt)||localInput(dueAt)!==due)throw Error('開始する日時を確認してください。');
  const action=$('#schedule-action').value,choice=$('#schedule-target').value,target=choice==='none'||choice==='party'?{type:choice}:{type:choice.slice(0,choice.indexOf(':')),id:choice.slice(choice.indexOf(':')+1)};
  if(action==='chat'&&target.type!=='chat')throw Error('自動開始するチャットを選んでください。');
  const execution=action==='notify'?{}:{text:$('#schedule-text').value,model:$('#schedule-model').value,effort:$('#schedule-effort').value};
  if(action!=='notify'&&(!execution.text.trim()||!execution.model))throw Error('開始する本文と使用するモデルを入力してください。');
  setState('schedules',await api('schedules/save',{...(editingSchedule?{id:editingSchedule}:{}),action,title:$('#schedule-title').value,dueAt,target,...execution}));clearSchedule();notify('予約を保存しました。');
 });};
 $('#schedule-list').onchange=event=>{if(event.target.closest('[data-schedule-confirm]'))renderSchedules();};
 $('#schedule-list').onclick=event=>{
  const edit=event.target.closest('[data-schedule-edit]'),toggle=event.target.closest('[data-schedule-toggle]'),remove=event.target.closest('[data-schedule-remove]'),rearm=event.target.closest('[data-schedule-rearm]'),stop=event.target.closest('[data-schedule-stop]'),id=edit?.dataset.scheduleEdit||toggle?.dataset.scheduleToggle||remove?.dataset.scheduleRemove||rearm?.dataset.scheduleRearm||stop?.dataset.scheduleStop,item=scheduleState().items.find(item=>item.id===id);
  if(!item||demo||busy.schedule)return;
  if(edit){
   if(scheduleActive(item)||item.status==='uncertain')return;editingSchedule=id;$('#schedule-title').value=item.title;$('#schedule-due').value=localInput(item.dueAt);$('#schedule-action').value=item.action||'notify';$('#schedule-text').value=item.text||'';keys.targets='';renderScheduleEditor();
   const choice=item.target?.type==='chat'||item.target?.type==='todo'?item.target.type+':'+item.target.id:item.target?.type||'none';if(!Array.from($('#schedule-target').options).some(option=>option.value===choice))$('#schedule-target').add(new Option('見つからない対象（選び直してください）',choice));$('#schedule-target').value=choice;
   if(item.model){modelInitialized=true;if(!Array.from($('#schedule-model').options).some(option=>option.value===item.model))$('#schedule-model').add(new Option(item.model+'（現在利用できません）',item.model));$('#schedule-model').value=item.model;renderScheduleModels();if(!Array.from($('#schedule-effort').options).some(option=>option.value===item.effort))$('#schedule-effort').add(new Option(item.effort+'（現在利用できません）',item.effort));$('#schedule-effort').value=item.effort;}
   $('#schedule-title').focus();return;
  }
  perform('schedule',async()=>{
   let route,body={id};if(rearm){const check=Array.from(document.querySelectorAll('[data-schedule-confirm]')).find(element=>element.dataset.scheduleConfirm===id);if(!check?.checked)throw Error('前の実行結果と利用枠を確認してください。');route='schedules/rearm';body={id,generation:item.generation,confirmed:true};}else if(stop){route='schedules/stop';body={id,generation:item.generation};}else{route=remove?'schedules/remove':'schedules/toggle';if(toggle)body.enabled=!item.enabled;}
   setState('schedules',await api(route,body));if(remove&&editingSchedule===id)clearSchedule();
  });
 };
 render();return {render,open:view=>{render();if(view==='inbox')return refreshInbox();if(view==='reports'&&!reportStarted)return buildReport();}};
}
