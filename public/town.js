import {worldText, worldBinding, setWorldLabel, getLocale} from './i18n-world.js';
import {equipmentIcon,equipmentPresentation} from './equipment.js';
import {characterAppearance,characterIcon} from './character-appearance.js';
import {createPartyTrail} from './town-walk.js';
import {boardRoleState,townQuestActivity,townQuestStopReason} from './board-gathering.js';
import {createTownActivity,activityFormation,roleWorkplace,TOWN_WORKSITES} from './town-activity.js';
import {teamsQuestProgress} from './teams-quest.js';

const names={get weapon(){return worldText('武器屋');},get spell(){return worldText('呪文屋');},get tool(){return worldText('道具屋');},get tavern(){return worldText('酒場');},get castle(){return worldText('お城 · クエスト受付');},get town(){return worldText('広場');}};
const positions={weapon:['15%','39%'],spell:['38%','39%'],tool:['15%','39%'],tavern:['62%','39%'],castle:['85%','39%'],town:['50%','73%']};
const percent=value=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:1}).format(value)+'%';
export const TOWN_WAGON_ID='__town_wagon__';

// Hydrated completions are history. Only a completion observed during this
// session earns an arrival celebration, even if the player is in a shop.
export function createTownQuestFeedback(){
  let previous=null;
  return quest=>{
    const completed=Boolean(quest?.id&&quest.id===previous?.id&&quest.status==='completed'&&['running','stopping','paused'].includes(previous.status));
    previous=quest?.id?{id:quest.id,status:quest.status}:null;
    return completed?quest.id:null;
  };
}

// Formation changes only the map. Saved party order still governs the quest.
export function townFormation(party){
  return activityFormation(party);
}

// Keep the exact completed run available at the castle even while the next
// quest is running. A later draft or an unfinished retry is not its result.
export function townReportRecord(state,fallback=null){
  const reports=[];
  for(const todo of state.todos?.items||[])for(const run of todo.runs||[]){
    if(run.status!=='completed'||!run.output?.trim()||!Number.isFinite(run.completedAt))continue;
    reports.push({questId:run.questId,todoId:todo.id,runId:run.id,title:todo.title,request:todo.source?.request||todo.description||todo.title,output:run.output,source:todo.source,completedAt:run.completedAt});
  }
  if(fallback?.output)reports.push(fallback);
  return reports.sort((a,b)=>(b.completedAt||0)-(a.completedAt||0)||Number(Boolean(b.todoId))-Number(Boolean(a.todoId)))[0]||null;
}

// Account quota is a percentage, not a remaining token count or a spendable credit balance.
export function townWallet(state,now=Date.now()){
  const unknown=note=>({status:'unknown',remaining:null,windows:[],note});
  if(!state.connected||state.account?.type!=='chatgpt')return unknown(worldText('Codexに接続すると利用枠を確認できます。'));
  const limits=state.limits,buckets=limits?.rateLimitsByLimitId?Object.values(limits.rateLimitsByLimitId):limits?.rateLimits?[limits.rateLimits]:[];
  if(!buckets.length)return unknown(worldText('残量を取得できません。「利用枠を更新」で再取得してください。'));
  const windows=[];
  for(const bucket of buckets){
    if(!bucket||typeof bucket!=='object')return unknown(worldText('残量を確認できません。更新してください。'));
    for(const window of [bucket.primary,bucket.secondary].filter(Boolean)){
      if(!Number.isFinite(window.usedPercent)||window.usedPercent<0||window.usedPercent>100)return unknown(worldText('残量を確認できません。更新してください。'));
      if(!Number.isFinite(window.resetsAt)||window.resetsAt*1000<=now)return {status:'stale',remaining:null,windows:[],note:worldText('リセット後の残量は更新待ちです。「利用枠を更新」で再取得してください。')};
      const minutes=window.windowDurationMins;
      const period=Number.isFinite(minutes)&&minutes>0?(minutes%1440===0?worldText("{n}日間", {n:minutes/1440}):minutes%60===0?worldText("{n}時間", {n:minutes/60}):worldText("{n}分間", {n:minutes})):worldText('利用枠');
      windows.push({name:(bucket.limitName||bucket.limitId||'Codex')+' · '+period,remaining:100-window.usedPercent,resetsAt:window.resetsAt});
    }
  }
  if(!windows.length)return unknown(worldText('契約の残量は未取得です。「利用枠を更新」で再取得してください。'));
  const remaining=Math.min(...windows.map(window=>window.remaining));
  const blocked=state.policy?.ok===false||limits.ordinaryUsageAllowed===false||buckets.some(bucket=>bucket.rateLimitReachedType);
  return {status:blocked?'blocked':'ready',remaining,windows,note:blocked?(state.policy?.reason||worldText('現在、新しい依頼を開始できません。残量を更新してください。')):worldText('複数の利用枠のうち、最も少ない残量を表示しています。')};
}

export function initTown({api,demo=false,getModel=()=>({}),getState,getChats,getSelected,onNavigate,onRefresh,onCharacterChat,onCharacterEquip,onTodo,onProgress,onTeams}){
  const $=selector=>document.querySelector(selector);
  const traveler=$('#town-traveler'),map=$('.town-map'),field=$('#town-walkfield'),rows=new Map();
  traveler.classList.add('town-party-lineup');traveler.setAttribute('role','list');traveler.setAttribute('aria-label',worldText('酒場で編成したパーティ'));
  map.classList.add('has-party-lineup');
  let view='chat',shop='weapon',refreshing=false,partySignature='';
  const text=(tag,value,className)=>{const element=document.createElement(tag);if(value?.worldLabel)setWorldLabel(element,value.worldLabel);else element.textContent=value;if(className)element.className=className;return element;};
  let trail=null,trailKey='',trailWidth=0,trailHeight=0,frame=0,lastFrame=0,dragPointer=null,selectedCharacter=null,navigating=false,disposed=false;
  let markerUntil=0,markerTimer=0,arrivalTimer=0,celebrationTimer=0,pendingCelebration=null;
  let boardBusy=false,boardError='',activityFrame=null,reportRecord=null,openedReport=null,reportKey='';
  const activity=createTownActivity();
  const boardActive=()=>townQuestActivity(getState());
  const ownsParty=()=>Boolean(activity.scene?.ownsParty);
  const displayedParty=()=>{
    if(ownsParty())return activity.scene.party;
    const state=getState(),quest=state.party?.quest;
    return state.adventure?.active?.questId===quest?.id&&quest?.party?quest.party:state.party?.party;
  };
  const formationFor=party=>ownsParty()?activity.scene.formation:activityFormation(party);
  const observeQuest=createTownQuestFeedback();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const motionOff=()=>document.body.dataset.motion==='reduced'||reducedMotion.matches;
  const visible=()=>view==='town'&&!$('#workspace').hidden&&field.clientWidth>0&&field.clientHeight>0;
  const target=text('span','','town-walk-target');target.id='town-walk-target';target.hidden=true;target.setAttribute('aria-hidden','true');field.append(target);
  target.append(text('span','','town-target-ring'));
  const celebration=text('div','','town-quest-celebration');celebration.id='town-quest-celebration';celebration.hidden=true;celebration.setAttribute('role','status');map.append(celebration);
  const castleFlag=text('span','✦','town-quest-flag');castleFlag.setAttribute('aria-hidden','true');$('.town-castle').append(castleFlag);
  const arrival=text('span','✦','town-arrival');arrival.hidden=true;arrival.setAttribute('aria-hidden','true');$('.town-location-group').append(arrival);
  const dialog=text('dialog','','town-character-dialog');dialog.id='town-character-dialog';dialog.setAttribute('aria-labelledby','town-character-name');
  const dialogName=text('h2','');dialogName.id='town-character-name';
  const dialogChat=text('p','');dialogChat.id='town-character-chat';
  const dialogRole=text('p','');dialogRole.id='town-character-role';
  const dialogGear=text('div','','town-character-gear town-member-gear');dialogGear.id='town-character-gear';
  const dialogActivity=text('p','','town-activity-detail');dialogActivity.id='town-character-activity';
  const dialogResult=text('details','','town-character-result');dialogResult.id='town-character-result';
  const dialogOutput=text('pre','');dialogOutput.id='town-character-output';dialogOutput.tabIndex=0;dialogResult.append(text('summary',worldBinding('この担当の成果を見る')),dialogOutput);
  const actions=text('div','','town-character-actions');
  const action=(id,label,handler)=>{const button=text('button',label,'outline');button.type='button';button.id=id;button.onclick=handler;actions.append(button);return button;};
  const chatAction=action('town-character-open-chat',worldBinding('チャットを開く'),()=>navigateCharacter('chat'));
  action('town-character-weapon',worldBinding('武器を変更する'),()=>navigateCharacter('weapon'));
  action('town-character-spell',worldBinding('呪文を変更する'),()=>navigateCharacter('spell'));
  action('town-character-close',worldBinding('閉じる'),()=>dialog.close());
  dialog.append(dialogName,dialogChat,dialogRole,dialogActivity,dialogResult,dialogGear,actions);document.body.append(dialog);
  const wagonDialog=text('dialog','','town-wagon-dialog');wagonDialog.id='town-wagon-dialog';wagonDialog.setAttribute('aria-labelledby','town-wagon-title');
  const wagonTitle=text('h2',worldBinding('馬車の仲間'));wagonTitle.id='town-wagon-title';
  const wagonMembers=text('div','','town-wagon-members');wagonMembers.id='town-wagon-members';
  const wagonClose=text('button',worldBinding('閉じる'),'outline');wagonClose.type='button';wagonClose.id='town-wagon-close';wagonClose.onclick=()=>wagonDialog.close();
  wagonDialog.append(wagonTitle,text('p',worldBinding('仲間を選ぶと、チャットを開いたり装備を変更できます。')),wagonMembers,wagonClose);document.body.append(wagonDialog);
  const boardDialog=text('dialog','','town-board-dialog');boardDialog.id='town-board-dialog';boardDialog.setAttribute('aria-labelledby','town-board-title');
  const boardTitle=text('h2',worldBinding('街のクエスト掲示板'));boardTitle.id='town-board-title';boardTitle.tabIndex=-1;const boardItems=text('div','','town-board-items');boardItems.id='town-board-items';
  const boardTodos=()=>(getState().todos?.items||[]).filter(item=>['castle','teams'].includes(item.source?.provider));
  const boardEmpty=text('section','','town-board-empty');boardEmpty.id='town-board-empty';
  const boardEmptyGuidance=text('p','');boardEmptyGuidance.id='town-board-empty-guidance';
  const boardCreate=text('button',worldBinding('お城でクエストを作成・TODO登録'),'outline');boardCreate.type='button';boardCreate.id='town-board-create-quests';
  boardCreate.onclick=()=>{navigating=true;stopAnimation();boardDialog.close();onNavigate('castle');};
  boardEmpty.append(text('h3',worldBinding('まだクエストはありません')),boardEmptyGuidance,text('p',worldBinding('TODO登録後は、掲示板の自動巡回をONにしてください。すでにONなら、登録後に仲間の募集が始まります。')),boardCreate);
  const boardClose=text('button',worldBinding('閉じる'),'outline');boardClose.type='button';boardClose.id='town-board-close';boardClose.onclick=()=>boardDialog.close();
  const boardControl=text('section','','town-board-controls'),autoLabel=text('label','','town-board-auto-label'),autoToggle=document.createElement('input');autoToggle.type='checkbox';autoToggle.id='town-board-auto';
  autoLabel.append(autoToggle,text('span',worldBinding('掲示板を自動巡回')));
  const boardStatus=text('p','');boardStatus.id='town-board-dispatch-status';boardStatus.setAttribute('role','status');
  const boardReason=text('p','','town-board-dispatch-reason');boardReason.id='town-board-dispatch-reason';boardReason.setAttribute('role','alert');
  const boardReasons=text('ul','','town-board-dispatch-reasons');boardReasons.id='town-board-dispatch-reasons';
  const boardActions=text('div','','town-board-dispatch-actions');
  const boardAction=(id,label,handler)=>{const button=text('button',label,'outline');button.type='button';button.id=id;button.onclick=handler;boardActions.append(button);return button;};
  const activeTodo=boardAction('town-board-active-todo',worldBinding('このTODOを確認'),()=>{const id=boardActive()?.todoId||getState().boardDispatch?.active?.todoId;if(id){navigating=true;boardDialog.close();onTodo?.(id);}});
  const progressAction=boardAction('town-board-progress',worldBinding('酒場で進行を確認'),()=>{navigating=true;boardDialog.close();onProgress?.();});
  const stopAction=boardAction('town-board-stop',worldBinding('進行中のクエストを停止'),()=>changeBoard('board/stop',{}));
  const acknowledgeAction=boardAction('town-board-acknowledge',worldBinding('記録を確認して巡回を再設定'),()=>changeBoard('board/acknowledge',{id:getState().boardDispatch?.active?.id}));
  boardControl.append(autoLabel,text('p',worldBinding('ONにすると、お城やTeamsから登録した未着手のクエストに合う仲間が集まります。役割ごとに処理し、最後にリーダーがまとめます。Teamsへの返信は、内容を確認してから送信します。OFFは新しい募集を止めます。')),boardStatus,boardReason,boardReasons,boardActions);
  boardDialog.append(boardTitle,text('p',worldBinding('お城やTeamsから届いた仕事です。元の依頼、仲間の進行、成果をここから確認できます。')),boardControl,boardItems,boardEmpty,boardClose);document.body.append(boardDialog);
  const boardBanner=text('button','','town-board-run-banner');boardBanner.type='button';boardBanner.id='town-board-run-banner';boardBanner.hidden=true;boardBanner.onclick=()=>{if(activity.scene?.phase==='reported'&&reportRecord){reportOpen.click();}else if(boardActive()?.origin==='party'&&onProgress){navigating=true;stopAnimation();onProgress();}else openBoard();};map.append(boardBanner);
  const activityStatus=text('span','');activityStatus.id='town-activity-status';activityStatus.setAttribute('role','status');boardBanner.append(activityStatus);boardBanner.classList.add('town-activity-status');
  const workIcon=(id,className,viewBox='0 0 24 24')=>{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');svg.setAttribute('viewBox',viewBox);svg.setAttribute('class',className);svg.setAttribute('aria-hidden','true');use.setAttribute('href','/assets/town-work.svg#'+id);svg.append(use);return svg;};
  const setWorkIcon=(svg,id)=>{const href='/assets/town-work.svg#'+id;if(svg.firstChild.getAttribute('href')!==href)svg.firstChild.setAttribute('href',href);};
  const worksites=new Map();
  for(const [id,symbol,label] of [['research','book-desk',worldText('調査の机')],['craft','workbench',worldText('作成の机')],['review','review-desk',worldText('確認の机')],['shared','summary-desk',worldText('まとめの机')]]){
    const site=text('span','','town-worksite');site.dataset.worksite=id;site.title=label;site.setAttribute('aria-hidden','true');site.append(workIcon(symbol,'','0 0 48 32'));field.append(site);worksites.set(id,site);
  }
  const summaryStack=text('span','','town-summary-stack');summaryStack.id='town-summary-stack';summaryStack.hidden=true;summaryStack.setAttribute('aria-label',worldText('受け取った成果'));
  const summaryCount=text('span','','town-summary-count');summaryStack.append(summaryCount);field.append(summaryStack);
  const handoffScroll=workIcon('scroll','town-handoff-scroll');handoffScroll.id='town-handoff-scroll';handoffScroll.style.display='none';field.append(handoffScroll);
  const reportOpen=text('button','','town-report-open');reportOpen.id='town-report-open';reportOpen.type='button';reportOpen.hidden=true;reportOpen.style.left='88%';reportOpen.style.top='20%';
  const reportSymbol=workIcon('report','town-report-icon'),reportLabel=text('span',worldBinding('成果を見る')),reportStatus=text('small','','town-report-status');reportStatus.id='town-report-status';reportOpen.append(reportSymbol,reportLabel,reportStatus);map.append(reportOpen);
  const reportDialog=text('dialog','','town-character-dialog town-report-dialog');reportDialog.id='town-report-dialog';reportDialog.setAttribute('aria-labelledby','town-report-title');
  const reportTitle=text('h2',worldBinding('お城への報告'));reportTitle.id='town-report-title';
  const reportRequest=text('pre','');reportRequest.id='town-report-request';reportRequest.tabIndex=0;
  const reportOutput=text('pre','');reportOutput.id='town-report-output';reportOutput.tabIndex=0;
  const reportMeta=text('p','');reportMeta.id='town-report-meta';
  const reportActions=text('div','','town-character-actions');
  const reportTodo=text('button',worldBinding('TODOの履歴を開く'),'outline');reportTodo.id='town-report-todo';reportTodo.type='button';
  const reportTeams=text('button',worldBinding('Teamsの返信を確認'),'outline');reportTeams.id='town-report-teams';reportTeams.type='button';
  const reportClose=text('button',worldBinding('閉じる'),'outline');reportClose.id='town-report-close';reportClose.type='button';reportClose.onclick=()=>reportDialog.close();
  reportActions.append(reportTodo,reportTeams,reportClose);reportDialog.append(reportTitle,reportMeta,text('h3',worldBinding('元の依頼')),reportRequest,text('h3',worldBinding('リーダーのまとめ')),reportOutput,reportActions);document.body.append(reportDialog);
  reportOpen.onclick=()=>{if(!reportRecord)return;openedReport=reportRecord;renderReport();stopAnimation();reportDialog.showModal();reportClose.focus();};
  reportTodo.onclick=()=>{const id=openedReport?.todoId;if(!id)return;navigating=true;reportDialog.close();onTodo?.(id);};
  reportTeams.onclick=()=>{const id=openedReport?.source?.draftId;if(!id)return;navigating=true;reportDialog.close();onTeams?.(id);};
  reportDialog.addEventListener('close',()=>{openedReport=null;if(view==='town'&&!navigating){reportOpen.focus({preventScroll:true});startAnimation();}});
  function renderReport(){
    const state=getState();reportRecord=townReportRecord(state,activity.lastReport);reportOpen.hidden=!reportRecord;
    if(!reportRecord)return;
    reportOpen.dataset.todoId=reportRecord.todoId||'';reportOpen.dataset.runId=reportRecord.runId||'';reportOpen.dataset.questId=reportRecord.questId||'';
    const todo=state.todos?.items?.find(item=>item.id===reportRecord.todoId),teams=reportRecord.source?.provider==='teams';
    const progress=teams&&todo?.runs?.at(-1)?.id===reportRecord.runId?teamsQuestProgress(todo,state):null;
    reportOpen.dataset.phase=progress?.phase||'reported';setWorkIcon(reportSymbol,teams?'envelope':'report');
    reportLabel.textContent=teams?worldText('Teamsの成果'):worldText('成果を見る');reportStatus.textContent=progress?.label||(activity.scene?.phase==='reporting'&&activity.scene.questId===reportRecord.questId?worldText('お城へ報告中'):worldText('報告書が届いています'));
    reportOpen.title=(reportRecord.title||worldText('クエストの成果'))+' · '+reportStatus.textContent;
    const shown=openedReport||reportRecord,key=JSON.stringify([shown.questId,shown.runId,shown.title,shown.request,shown.output,shown.completedAt]);
    if(reportKey!==key){reportKey=key;reportTitle.textContent=shown.title||worldText('お城への報告');reportRequest.textContent=shown.request||worldText('依頼の記録はありません。');reportOutput.textContent=shown.output;reportMeta.textContent=worldText('クエスト完了')+(shown.completedAt?' · '+new Date(shown.completedAt).toLocaleString(getLocale()):'');}
    reportTodo.hidden=!shown.todoId||!onTodo;reportTeams.hidden=shown.source?.provider!=='teams'||!shown.source.draftId||!onTeams;
    reportDialog.dataset.questId=shown.questId||'';reportDialog.dataset.runId=shown.runId||'';
  }
  async function changeBoard(path,params){
    if(boardBusy||demo)return;boardBusy=true;boardError='';renderBoard();
    try{await api(path,params);if(path==='board/configure'&&params.enabled&&boardTodos().length&&boardDialog.open)boardDialog.close();}
    catch(error){boardError=error.message;}
    finally{boardBusy=false;render();}
  }
  autoToggle.onchange=()=>{const enabled=autoToggle.checked;autoToggle.checked=Boolean(getState().boardDispatch?.enabled);changeBoard('board/configure',enabled?{enabled,...getModel()}:{enabled});};
  function renderBoardDispatch(){
    const state=getState(),dispatch=state.boardDispatch||{},active=dispatch.active,quest=state.party?.quest;
    const activity=boardActive(),current=activity||active;
    const problem=['blocked','uncertain','cancelled'].includes(active?.status),unfinished=['running','stopping','paused'].includes(quest?.status);
    const status=current?.status||'idle',labels={gathering:worldText('仲間が掲示板へ集合中'),starting:worldText('クエストを開始しています'),running:worldText('パーティが処理中'),stopping:worldText('パーティの停止待ち'),paused:worldText('クエストが中断しています'),completed:worldText('クエスト完了'),blocked:worldText('開始を停止しました'),uncertain:worldText('実行結果を確認してください'),cancelled:worldText('巡回を停止しました')};
    const step=current?.questId===quest?.id&&quest?.status==='running'?quest.steps?.find(step=>step.status==='running'):null;
    const summary=step?(step.kind==='summary'?worldText('リーダーが最後のまとめを作成中'):step.role+worldText(' · 処理中')):labels[status]||(dispatch.enabled?(boardTodos().length?worldText('次のクエストを待っています'):worldText('自動巡回 ON · TODO登録待ち')):worldText('自動巡回 OFF'));
    const title=current?.title||(state.todos?.items||[]).find(item=>item.id===current?.todoId)?.title;
    const reason=townQuestStopReason(current?.error),bannerReason=reason.length>160?reason.slice(0,160)+'…':reason;
    autoToggle.checked=Boolean(dispatch.enabled);autoToggle.disabled=boardBusy||demo||(!dispatch.enabled&&(problem||!state.connected||!getModel().model));
    boardStatus.textContent=summary+(title?' · '+title:'');boardStatus.dataset.status=status;
    boardReason.textContent=boardError||dispatch.runtimeError||reason||(demo?worldText('デモでは自動巡回を開始できません。Codexへ接続してください。'):problem?worldText('記録を確認し、巡回を再設定してからONにしてください。'):!state.connected?worldText('Codexに接続してから巡回をONにしてください。'):!getModel().model?worldText('自動実行に使うモデルを選択してください。'):'');boardReason.hidden=!boardReason.textContent;
    const reasons=current?.id===active?.id?active?.selection?.reasons||[]:[],members=current?.selection?.party?.members||[];
    boardReasons.replaceChildren(...reasons.map(entry=>{const member=members.find(member=>member.conversationId===entry.conversationId),row=text('li',(member?.role||worldText('役割'))+'：'+entry.reason);row.dataset.conversationId=entry.conversationId;return row;}));boardReasons.hidden=!reasons.length;
    activeTodo.hidden=!current?.todoId;progressAction.hidden=!current?.questId||current.questId!==quest?.id;progressAction.disabled=!onProgress;
    stopAction.hidden=!['gathering','starting','running'].includes(active?.status);stopAction.disabled=boardBusy;stopAction.textContent=active?.status==='gathering'?worldText('仲間の集合を停止'):worldText('進行中のクエストを停止');
    acknowledgeAction.hidden=!problem;acknowledgeAction.disabled=boardBusy||unfinished;acknowledgeAction.title=unfinished?worldText('酒場で現在のクエストを完了または終了してから再設定できます。'):'';
    map.dataset.boardStatus=status;map.dataset.boardDispatchId=active?.id||'';$('#town-board-open').dataset.enabled=String(Boolean(dispatch.enabled));
    boardBanner.hidden=!dispatch.enabled&&!active&&!activity;activityStatus.textContent=summary+(bannerReason?' · '+bannerReason:'')+(activity?.origin==='party'?worldText(' · 進行を確認'):worldText(' · 掲示板'));boardBanner.dataset.status=status;
  }
  let boardKey='';
  function renderBoard(){
    renderBoardDispatch();
    const state=getState(),items=boardTodos(),progress=new Map(items.filter(item=>item.source.provider==='teams').map(item=>[item.id,teamsQuestProgress(item,state)]));
    const key=JSON.stringify(items.map(item=>[item.id,item.title,item.status,item.source,progress.get(item.id),item.runs?.at(-1)?.status]));
    const hasReadyPlan=(getState().todos?.plans||[]).some(plan=>plan.status==='ready');
    boardEmpty.hidden=Boolean(items.length);boardCreate.disabled=boardBusy;
    boardEmptyGuidance.textContent=hasReadyPlan?worldText('クエスト案は作成済みです。お城で内容を確認し、「この内容でTODOに登録」を押してください。'):worldText('お城でクエストを作成・TODO登録するか、Teamsの依頼を掲示板に登録してください。');
    const pending=items.filter(item=>item.source.provider==='teams'?progress.get(item.id)?.phase!=='sent':item.status!=='done').length;
    $('#town-board-count').textContent=String(pending);$('#town-board-count').setAttribute('aria-label',worldText("未完了の依頼 {n}件（Teamsは返信送信まで）", {n:pending}));
    if(key===boardKey)return;boardKey=key;const focused=boardItems.contains(document.activeElement)?{todoId:document.activeElement.dataset.todoId,draftId:document.activeElement.dataset.teamsDraft}:null;
    boardItems.replaceChildren(...items.map(item=>{const button=text('button','','town-board-item');button.type='button';button.dataset.todoId=item.id;
      const teams=item.source.provider==='teams',flow=progress.get(item.id),run=item.runs?.at(-1);
      const label=flow?.label||(run?.status==='paused'?worldText('中断中'):({todo:worldText('未着手'),doing:worldText('進行中'),done:worldText('完了')})[item.status]||item.status);
      const title=teams?item.title.replace(/^Teams:\s*/,''):item.title;
      button.append(text('strong',(teams?'Teams · ':`${item.source.order} / ${item.source.total} · `)+title),text('span',label),text('small',worldText('残す成果：')+item.source.artifact));
      if(flow?.detail)button.append(text('small',flow.detail));
      if(flow?.error)button.append(text('small',townQuestStopReason(flow.error),'town-board-item-error'));
      button.onclick=()=>{navigating=true;stopAnimation();boardDialog.close();onTodo?.(item.id);};
      if(!teams)return button;
      const entry=text('div','','town-board-entry'),reply=text('button',worldText('Teamsで確認'),'outline');reply.type='button';reply.dataset.teamsDraft=flow?.draftId||item.source.draftId;reply.disabled=!onTeams;
      reply.onclick=()=>{navigating=true;stopAnimation();boardDialog.close();onTeams?.(reply.dataset.teamsDraft);};entry.append(button,reply);return entry;
    }));
    if(focused&&boardDialog.open)([...boardItems.querySelectorAll('button')].find(button=>focused.todoId?button.dataset.todoId===focused.todoId:button.dataset.teamsDraft===focused.draftId)||boardClose).focus({preventScroll:true});
  }
  function openBoard(){if(!visible())return;renderBoard();stopAnimation();if(!boardDialog.open)boardDialog.showModal();boardDialog.scrollTop=0;(autoToggle.disabled?boardTitle:autoToggle).focus({preventScroll:true});}
  $('#town-board-open').onclick=openBoard;
  boardDialog.addEventListener('close',()=>{if(!boardDialog.open&&view==='town'&&!navigating){$('#town-board-open').focus({preventScroll:true});startAnimation();renderQuestFeedback(getState().party?.quest);}});
  const menuOpen=()=>dialog.open||wagonDialog.open||boardDialog.open||reportDialog.open;
  const characterActor=id=>rows.get(id)?.actor||rows.get(TOWN_WAGON_ID)?.actor;
  function character(){return getChats().find(chat=>chat.id===selectedCharacter);}
  function updateDialog(){
    const party=displayedParty(),chat=character(),member=party?.members?.find(member=>member.conversationId===selectedCharacter);
    if(!chat||!member){if(dialog.open)dialog.close();return;}
    dialogName.textContent=characterAppearance(member.role).label+(chat.id===party?.leaderId?worldText(' · リーダー'):'');dialogChat.textContent=chat.title;
    dialogRole.textContent=(member.role||worldText('役割未設定'))+' · '+characterAppearance(member.role).label+(chat.id===party?.leaderId?worldText(' · リーダー'):'');
    const scene=activity.scene,quest=getState().party?.quest,step=(scene?.steps||quest?.steps||[]).find(item=>item.conversationId===selectedCharacter);
    let status=step?({pending:worldText('順番待ち'),running:step.kind==='summary'?worldText('仲間の成果をまとめています'):worldText('担当の作業を進めています'),completed:worldText('担当の作業が完了しました'),blocked:worldText('開始できません'),failed:worldText('処理に失敗しました'),interrupted:worldText('結果の確認が必要です')})[step.status]||worldText('待機中'):worldText('待機中');
    if(step?.status!=='completed'&&scene?.activeId===selectedCharacter){if(scene.disconnected)status=worldText('接続後に進行状況を確認します');else if(scene.phase==='stopping')status=worldText('停止を要求しました。結果を確認しています');else if(scene.phase==='paused')status=worldText('処理が中断しています');}
    const detailReason=step?.error||(scene?.activeId===selectedCharacter?scene?.error:'');
    dialogActivity.hidden=!step;dialogActivity.dataset.phase=scene?.phase||'';dialogActivity.textContent=status+(detailReason?'\n'+townQuestStopReason(detailReason):'');
    dialogResult.hidden=step?.status!=='completed'||!step.output;dialogOutput.textContent=step?.status==='completed'?step.output:'';
    dialogOutput.dataset.stepId=step?.id||'';
    dialogGear.replaceChildren(...['weapon','spell','tool'].map(slot=>{
      const skill=chat.equipment?.[slot],row=text('div','','town-character-item town-member-item');row.dataset.slot=slot;
      const label={weapon:worldText('武器'),spell:worldText('呪文'),tool:worldText('道具')}[slot];
      if(skill)row.append(equipmentIcon(skill));row.append(text('span',label+'：'+(skill?equipmentPresentation(skill).itemName:worldText('なし'))));return row;
    }));
  }
  function openCharacter(id){
    if(!visible()||!getChats().some(chat=>chat.id===id)||!displayedParty()?.members?.some(member=>member.conversationId===id))return;
    if(wagonDialog.open)wagonDialog.close();
    selectedCharacter=id;updateDialog();stopAnimation();
    rows.forEach((ui,key)=>ui.row.classList.toggle('is-selected',key===id||(key===TOWN_WAGON_ID&&!rows.has(id))));
    if(!dialog.open)dialog.showModal();positionCharacterDialog();chatAction.focus();
  }
  function positionCharacterDialog(){
    dialog.classList.remove('is-anchored');dialog.style.removeProperty('left');dialog.style.removeProperty('top');
    if(!dialog.open||innerWidth<901||innerHeight<650)return;
    const actor=characterActor(selectedCharacter);if(!actor)return;
    const box=actor.getBoundingClientRect(),size=dialog.getBoundingClientRect(),margin=16;
    const x=box.right+12+size.width<=innerWidth-margin?box.right+12:box.left-size.width-12;
    dialog.style.left=Math.max(margin,Math.min(innerWidth-size.width-margin,x))+'px';
    dialog.style.top=Math.max(margin,Math.min(innerHeight-size.height-margin,box.top-20))+'px';dialog.classList.add('is-anchored');
  }
  function updateWagonDialog(party){
    const reserve=formationFor(party).reserve,chats=getChats(),focused=wagonDialog.open&&wagonMembers.contains(document.activeElement)?document.activeElement.dataset.conversationId:null;
    wagonMembers.replaceChildren(...reserve.map(member=>{
      const chat=chats.find(chat=>chat.id===member.conversationId),button=text('button','','town-wagon-member');button.type='button';button.dataset.conversationId=member.conversationId;button.disabled=!chat;
      const copy=text('span','','town-wagon-member-copy');copy.append(text('strong',chat?.title||worldText('会話不明')),text('small',(member.role||worldText('役割未設定'))+' · '+characterAppearance(member.role).label));
      button.append(characterIcon(member.role,'town-wagon-member-icon'),copy);button.onclick=()=>openCharacter(member.conversationId);return button;
    }));
    if(!reserve.length&&wagonDialog.open)wagonDialog.close();
    else if(focused)([...wagonMembers.children].find(button=>button.dataset.conversationId===focused&&!button.disabled)||wagonMembers.querySelector('button:not(:disabled)')||wagonClose).focus({preventScroll:true});
  }
  function openWagon(){
    if(!visible()||!formationFor(displayedParty()).reserve.length)return;
    updateWagonDialog(displayedParty());stopAnimation();
    if(!wagonDialog.open)wagonDialog.showModal();wagonMembers.querySelector('button:not(:disabled)')?.focus();
  }
  function navigateCharacter(destination){
    const chat=character();if(!chat)return dialog.close();
    navigating=true;stopAnimation();dialog.close();
    if(destination==='chat')onCharacterChat(chat.id);else onCharacterEquip(chat.id,destination);
  }
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    const id=selectedCharacter;selectedCharacter=null;rows.forEach(ui=>ui.row.classList.remove('is-selected'));
    if(view==='town'&&!navigating){characterActor(id)?.focus({preventScroll:true});startAnimation();renderQuestFeedback(getState().party?.quest);}
  });
  wagonDialog.addEventListener('close',()=>{if(!wagonDialog.open&&!dialog.open&&view==='town'&&!navigating){rows.get(TOWN_WAGON_ID)?.actor.focus({preventScroll:true});startAnimation();renderQuestFeedback(getState().party?.quest);}});
  function syncActivity(){
    const width=field.clientWidth||trailWidth||800,height=field.clientHeight||trailHeight||400;
    const starts=(activityFrame?.ownsParty?activityFrame.positions:trail?.positions||[]).map(p=>({id:p.id,x:p.x/width,y:p.y/height}));
    activity.update(getState(),{visible:visible()&&document.visibilityState!=='hidden',reduced:motionOff(),starts});
    if(ownsParty()){markerUntil=0;target.hidden=true;}
  }
  function renderActivityPresentation(value){
    const phase=value?.phase||'idle';activityStatus.dataset.phase=phase;boardBanner.dataset.phase=phase;field.dataset.activityPhase=phase;
    if(value?.ownsParty){
      const reason=value.error?townQuestStopReason(value.error):'',shortReason=reason.length>160?reason.slice(0,160)+'…':reason;
      const label=value.label+(value.totalCount?worldText(" · {done}/{total} 完了", {done:value.completedCount,total:value.totalCount}):'')+(shortReason?' · '+shortReason:'');
      if(activityStatus.textContent!==label)activityStatus.textContent=label;
      boardBanner.hidden=false;boardBanner.title=value.label+(reason?' · '+reason:'');
    }else if(phase==='reported'&&!['blocked','uncertain','cancelled'].includes(getState().boardDispatch?.active?.status)){
      activityStatus.textContent=worldText('クエスト完了 · お城で成果を確認');boardBanner.hidden=false;boardBanner.title=worldText('元の依頼と成果を開く');
    }
    for(const [id,site] of worksites){
      const at=TOWN_WORKSITES[id];site.style.left=at.x*100+'%';site.style.top='calc('+at.y*100+'% + 20px)';
      const activeStep=value?.steps.find(step=>step.conversationId===value.activeId),workplace=value?.phase==='summary'?'shared':roleWorkplace(activeStep?.role);
      site.classList.toggle('is-active',Boolean(value?.ownsParty&&['working','summary'].includes(value.phase)&&workplace===id&&value?.positions?.some(p=>p.id===value.activeId&&!p.moving)));
    }
    const completed=value?.roleCompletedCount||0,total=value?.roleTotalCount||0;
    summaryStack.hidden=!value?.ownsParty||!completed||['paused','blocked','stopping','gathering','reporting'].includes(phase);
    summaryStack.style.left=TOWN_WORKSITES.shared.x*100+'%';summaryStack.style.top='calc('+TOWN_WORKSITES.shared.y*100+'% - 26px)';
    if(summaryStack.dataset.completed!==String(completed))summaryStack.replaceChildren(...Array.from({length:Math.min(7,completed)},()=>workIcon('scroll','')),summaryCount);
    summaryStack.dataset.completed=String(completed);summaryStack.dataset.total=String(total);summaryCount.textContent=completed+'/'+total;
    const handoff=value?.handoff,from=value?.positions.find(p=>p.id===handoff?.fromId),to=value?.positions.find(p=>p.id===handoff?.toId);
    handoffScroll.style.display=from&&to?'':'none';
    if(from&&to){const part=handoff.progress;handoffScroll.style.left=(from.x+(to.x-from.x)*part)+'px';handoffScroll.style.top=(from.y+(to.y-from.y)*part-24-Math.sin(part*Math.PI)*12)+'px';}
    renderReport();
  }
  function paint(){
    const owned=Boolean(activityFrame?.ownsParty);
    activityFrame=activity.frame({width:field.clientWidth||trailWidth||800,height:field.clientHeight||trailHeight||400,reduced:motionOff()});
    // Returning to manual movement must start at the castle, not at the old
    // mouse destination. This changes presentation only, never party execution.
    if(owned&&!ownsParty()&&activityFrame?.phase==='reported'&&trail){
      const leader=activityFrame.positions.find(p=>p.id===activityFrame.party.leaderId);
      trail.setMembers(townFormation(displayedParty()).ids);if(leader)trail.moveTo(leader,{instant:true});renderParty(displayedParty());
    }
    const active=boardActive(),value=ownsParty()?activityFrame:null,positions=value?.positions||trail?.positions||[],quest=getState().party?.quest;
    if(value&&traveler.dataset.formation!==value.formation.ids.join('|'))renderParty(displayedParty());
    const walking=Boolean(positions.some(position=>position.moving)&&visible()&&!menuOpen()&&!navigating&&!motionOff());
    field.dataset.walking=String(walking);traveler.dataset.walking=String(walking);
    if(active)traveler.dataset.boardStatus=active.status;else delete traveler.dataset.boardStatus;
    const actionLabels={reading:worldText('調査中'),writing:worldText('作成中'),reviewing:worldText('確認中'),summarizing:worldText('まとめ中'),carrying:value?.phase==='handoff'?worldText('受け渡し'):worldText('報告中'),paused:worldText('停止'),waiting:worldText('待機'),complete:worldText('完了')};
    for(const position of positions){
      const ui=rows.get(position.id);if(!ui)continue;
      ui.row.style.left=position.x+'px';ui.row.style.top=position.y+'px';
      ui.row.dataset.x=String(position.x);ui.row.dataset.y=String(position.y);ui.row.dataset.direction=position.direction;
      ui.row.classList.toggle('is-walking',walking&&position.moving);
      let roleState=value?position.roleState:boardRoleState(active,quest,position.id);
      if(position.id===TOWN_WAGON_ID&&active){const states=formationFor(displayedParty()).reserve.map(member=>boardRoleState(active,quest,member.conversationId));roleState=states.includes('running')?'running':states.every(v=>v==='completed')?'completed':states[0]||'waiting';}
      ui.row.classList.toggle('is-board-selected',Boolean(value||active));ui.row.classList.toggle('is-board-active',roleState==='running');
      if(value||active){ui.row.dataset.gatherProgress=String(position.progress??1);ui.row.dataset.boardRoleState=roleState;}else{delete ui.row.dataset.gatherProgress;delete ui.row.dataset.boardRoleState;}
      const action=value?position.action:'waiting';ui.row.dataset.workAction=action;ui.row.dataset.questId=value?.questId||'';
      if(ui.prop){ui.prop.style.display=value&&position.icon?'':'none';if(position.icon)setWorkIcon(ui.prop,position.icon);}
      const badge=ui.actor.querySelector('.town-board-role-badge'),hint=ui.actor.querySelector('.town-actor-hint');
      const status=value?.phase==='gathering'?(position.progress===1?worldText('集合済'):worldText('集合中')):value?.activeId===position.id&&value.disconnected?worldText('接続待ち'):value?.activeId===position.id&&value.phase==='stopping'?worldText('停止待ち'):['blocked','failed','interrupted'].includes(roleState)?({blocked:worldText('停止'),failed:worldText('失敗'),interrupted:worldText('確認待ち')})[roleState]:actionLabels[action]||worldText('待機');
      if(badge){badge.hidden=!value&&!active;badge.textContent=status;}
      if(hint)hint.textContent=value?status+worldText(' · 会話・成果'):position.id===TOWN_WAGON_ID?worldText('仲間を選ぶ'):worldText('会話・装備');
    }
    renderActivityPresentation(activityFrame);
    if(activityFrame?.phase==='reported')renderQuestFeedback(quest);
    const destination=trail?.destination;
    if(destination){field.dataset.targetX=String(destination.x);field.dataset.targetY=String(destination.y);target.style.left=destination.x+'px';target.style.top=destination.y+'px';}
    target.hidden=ownsParty()||(!trail?.moving&&Date.now()>=markerUntil)||!visible();
  }
  function needsAnimation(){return ownsParty()?activityFrame?.moving:trail?.moving;}
  function stopAnimation(){if(frame)cancelAnimationFrame(frame);frame=0;lastFrame=0;field.dataset.walking='false';traveler.dataset.walking='false';rows.forEach(ui=>ui.row.classList.remove('is-walking'));}
  function tick(now){
    frame=0;
    if(disposed||!visible()||menuOpen()||navigating||motionOff()){stopAnimation();return;}
    const elapsed=lastFrame?(now-lastFrame)/1000:0;lastFrame=now;if(!ownsParty())trail?.step(elapsed);paint();
    if(needsAnimation())frame=requestAnimationFrame(tick);else lastFrame=0;
  }
  function startAnimation(){
    if(disposed||!visible()||menuOpen()||navigating)return;
    if(motionOff()){if(!ownsParty()&&trail?.moving)trail.moveTo(trail.destination,{instant:true});paint();return;}
    paint();if(!needsAnimation())return;
    if(!frame){lastFrame=0;frame=requestAnimationFrame(tick);}
  }
  function syncWalking(party){
    if(!visible())return;
    const ordered=formationFor(party).ids;
    const width=field.clientWidth,height=field.clientHeight,key=ordered.join('|');
    if(!trail)trail=createPartyTrail({ids:ordered,width,height,margin:20,speed:140});
    else{
      if(trailWidth!==width||trailHeight!==height)trail.resize(width,height);
      if(trailKey!==key)trail.setMembers(ordered);
    }
    trailKey=key;trailWidth=width;trailHeight=height;
    if(!ordered.length){stopAnimation();target.hidden=true;}paint();startAnimation();
  }
  function guide(point,{pulse=false}={}){
    if(!visible()||menuOpen()||navigating||ownsParty())return;
    syncWalking(displayedParty());if(!trail?.positions.length)return;
    markerUntil=Date.now()+850;clearTimeout(markerTimer);markerTimer=setTimeout(()=>paint(),870);
    if(pulse){
      target.classList.remove('is-pulsing');void target.offsetWidth;target.classList.add('is-pulsing');
      field.dataset.guidanceCount=String(Number(field.dataset.guidanceCount||0)+1);
    }
    target.dataset.feedback=motionOff()?'static':'animated';
    trail.moveTo(point,{instant:motionOff()});paint();startAnimation();
  }
  function pointerPoint(event){const box=field.getBoundingClientRect();return {x:event.clientX-box.left-field.clientLeft,y:event.clientY-box.top-field.clientTop};}
  field.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,a,input,select,textarea'))return;
    event.preventDefault();dragPointer=event.pointerId;field.focus({preventScroll:true});
    try{field.setPointerCapture(event.pointerId);}catch{}
    guide(pointerPoint(event),{pulse:true});
  });
  field.addEventListener('pointermove',event=>{if(dragPointer===event.pointerId&&(event.buttons&1))guide(pointerPoint(event));});
  const release=event=>{if(dragPointer!==event.pointerId)return;dragPointer=null;try{field.releasePointerCapture(event.pointerId);}catch{}};
  field.addEventListener('pointerup',release);field.addEventListener('pointercancel',release);field.addEventListener('lostpointercapture',()=>{dragPointer=null;});
  field.addEventListener('keydown',event=>{
    if(event.target!==field)return;
    const delta={ArrowLeft:[-62,0],ArrowRight:[62,0],ArrowUp:[0,-40],ArrowDown:[0,40]}[event.key];
    if(!delta||!trail?.positions.length)return;event.preventDefault();const lead=trail.positions[0];guide({x:lead.x+delta[0],y:lead.y+delta[1]},{pulse:true});
  });
  function renderParty(party){
    const chats=getChats(),members=party?.members||[],formation=formationFor(party);
    const signature=JSON.stringify([formation.ids,party?.name,party?.leaderId,members.map(member=>{const chat=chats.find(chat=>chat.id===member.conversationId);return [member,chat?.title,chat?.equipment,chat?.armedSkillId];})]);
    if(signature===partySignature)return;partySignature=signature;
    const focused=[...rows].find(([,ui])=>ui.actor===document.activeElement)?.[0];
    traveler.dataset.formation=formation.ids.join('|');traveler.dataset.partySize=String(members.length);traveler.dataset.visibleCount=String(formation.visible.length);traveler.dataset.reserveCount=String(formation.reserve.length);traveler.replaceChildren();rows.clear();
    if(!members.length){
      if(dialog.open)dialog.close();
      if(wagonDialog.open)wagonDialog.close();
      const empty=text('div','','town-party-empty');empty.setAttribute('role','listitem');
      const hero=characterIcon('','town-empty-character');
      const label=text('span',worldText('酒場で仲間とリーダーを選び、編成を保存するとここに並びます。'));label.id='town-traveler-name';
      const button=text('button',worldText('酒場でパーティを組む →'),'outline');button.type='button';button.onclick=()=>{locate('tavern');onNavigate('tavern');};
      empty.append(hero,label,button);traveler.append(empty);return;
    }
    for(const member of formation.visible){
      const chat=chats.find(chat=>chat.id===member.conversationId),leader=member.conversationId===party.leaderId,appearance=characterAppearance(member.role);
      const row=text('div','','town-member');row.setAttribute('role','listitem');row.dataset.conversationId=member.conversationId;row.dataset.appearance=appearance.id;
      if(leader)row.classList.add('is-leader');
      const actor=text('button','','town-actor');actor.type='button';actor.dataset.conversationId=member.conversationId;
      actor.setAttribute('aria-label',worldText("{title} · {role}のチャットと装備", {title:chat?.title||worldText('冒険者'),role:member.role||appearance.label}));actor.setAttribute('aria-haspopup','dialog');actor.disabled=!chat;
      actor.addEventListener('pointerdown',event=>event.stopPropagation());actor.onclick=event=>{event.stopPropagation();openCharacter(member.conversationId);};
      const stage=text('span','','town-member-stage');stage.append(characterIcon(member.role,'town-character'));
      const prop=workIcon('scroll','town-work-prop');prop.style.display='none';stage.append(prop);
      if(leader)stage.append(equipmentIcon('crown','town-member-crown'));
      if(chat?.equipment?.weapon)stage.append(equipmentIcon(chat.equipment.weapon,'town-held-weapon'));
      if(chat?.equipment?.spell)stage.append(equipmentIcon(chat.equipment.spell,'town-held-spell'));
      const conversation=text('span',chat?.title||worldText('会話不明'),'town-member-chat');conversation.title=conversation.textContent;
      const role=text('span',(member.role||worldText('役割未設定'))+' · '+appearance.label,'town-member-role');
      role.title=role.textContent;
      if(leader){const badge=text('span',worldText('リーダー'),'town-leader-label');row.append(badge);}
      const hint=text('span',worldText('会話・装備'),'town-actor-hint');hint.setAttribute('aria-hidden','true');
      const roleBadge=text('span','','town-board-role-badge');roleBadge.hidden=true;actor.append(stage,hint,roleBadge);row.append(actor,conversation,role);
      const gear=text('div','','town-member-gear');
      for(const [slot,label] of [['weapon',worldText('武器')],['spell',worldText('呪文')],['tool',worldText('道具')]]){
        const skill=chat?.equipment?.[slot];if(slot==='tool'&&!skill)continue;
        const item=text('span','','town-member-item');item.dataset.slot=slot;
        if(skill)item.append(equipmentIcon(skill));
        const name=skill?equipmentPresentation(skill).itemName:worldText('なし');
        const status=slot==='weapon'&&skill?.singleUse?(chat.armedSkillId===skill.id?worldText('（矢を装填）'):worldText('（矢は未装填）')):'';
        item.title=label+'：'+name+status;item.append(text('span',item.title));gear.append(item);
      }
      actor.title=[conversation.textContent,role.textContent,...[...gear.children].map(item=>item.title)].join('\n');
      row.append(gear);traveler.append(row);rows.set(member.conversationId,{row,actor,prop});
    }
    if(formation.reserve.length){
      const row=text('div','','town-wagon');row.setAttribute('role','listitem');row.dataset.wagonCount=String(formation.reserve.length);
      const actor=text('button','','town-wagon-actor');actor.type='button';actor.id='town-wagon-open';actor.setAttribute('aria-label',worldText("馬車の仲間 {n}人のチャットと装備", {n:formation.reserve.length}));actor.setAttribute('aria-haspopup','dialog');
      actor.addEventListener('pointerdown',event=>event.stopPropagation());actor.onclick=event=>{event.stopPropagation();openWagon();};
      const stage=text('span','','town-wagon-stage'),ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');
      icon.setAttribute('class','town-wagon-icon');icon.setAttribute('viewBox','0 0 96 80');icon.setAttribute('aria-hidden','true');use.setAttribute('href','/assets/town.svg#wagon');icon.append(use);stage.append(icon,text('span','+'+formation.reserve.length,'town-wagon-count'));
      const hint=text('span',worldText('仲間を選ぶ'),'town-actor-hint');hint.setAttribute('aria-hidden','true');
      const roleBadge=text('span','','town-board-role-badge');roleBadge.hidden=true;actor.append(stage,hint,roleBadge);row.append(actor);traveler.append(row);rows.set(TOWN_WAGON_ID,{row,actor});
    }
    updateWagonDialog(party);
    if(focused&&!dialog.open)rows.get(focused)?.actor.focus({preventScroll:true});
    if(dialog.open)updateDialog();
  }
  function locate(place){
    const [x,y]=positions[place]||positions.town;
    $('#town-traveler').style.setProperty('--traveler-x',x);
    $('#town-traveler').style.setProperty('--traveler-y',y);
    $('#town-location').textContent=names[place]||names.town;
  }
  function welcome(place){
    const hud=$('#town-hud');hud.dataset.arrival=place;hud.classList.remove('is-arriving');void hud.offsetWidth;hud.classList.add('is-arriving');arrival.hidden=false;
    clearTimeout(arrivalTimer);arrivalTimer=setTimeout(()=>{hud.classList.remove('is-arriving');arrival.hidden=true;delete hud.dataset.arrival;},700);
  }
  function renderQuestFeedback(quest){
    if(map.dataset.celebrationQuest&&map.dataset.celebrationQuest!==quest?.id){clearTimeout(celebrationTimer);map.classList.remove('is-celebrating');map.dataset.celebrating='false';delete map.dataset.celebrationQuest;celebration.hidden=true;}
    if(!visible()||document.visibilityState==='hidden'||getState().connected===false){observeQuest(null);pendingCelebration=null;return;}
    const completed=observeQuest(quest);if(completed&&activity.scene?.report)pendingCelebration=completed;
    if(pendingCelebration&&pendingCelebration!==quest?.id)pendingCelebration=null;
    if(!pendingCelebration||!visible()||menuOpen()||activity.scene?.phase==='reporting')return;
    clearTimeout(celebrationTimer);map.classList.remove('is-celebrating');void map.offsetWidth;map.classList.add('is-celebrating');
    map.dataset.celebrationQuest=pendingCelebration;map.dataset.celebrationCount=String(Number(map.dataset.celebrationCount||0)+1);map.dataset.celebrating='true';
    celebration.textContent=worldText('✦ クエスト完了 · お城で成果を確認できます');celebration.hidden=false;pendingCelebration=null;
    celebrationTimer=setTimeout(()=>{map.classList.remove('is-celebrating');map.dataset.celebrating='false';celebration.hidden=true;},2400);
  }
  function render(){
    const state=getState(),wallet=townWallet(state);
    $('#town-hud').hidden=!['town','equipment','tavern','castle'].includes(view);
    $('#town-return').hidden=view==='town';
    const balance=wallet.remaining===null?'—':percent(wallet.remaining);
    if($('#town-balance').textContent!==balance)$('#town-balance').textContent=balance;
    $('#town-wallet').dataset.status=wallet.status;
    $('#town-wallet-note').textContent=wallet.note;
    $('#town-wallet-windows').replaceChildren(...wallet.windows.map(window=>{
      const row=document.createElement('li');
      row.textContent=worldText("{name}：残り {n} · {time} リセット", {name:window.name,n:percent(window.remaining),time:new Date(window.resetsAt*1000).toLocaleString(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})});
      return row;
    }));
    $('#town-refresh').disabled=refreshing||!state.connected;
    syncActivity();
    renderParty(displayedParty());
    renderBoard();
    syncWalking(displayedParty());
    renderActivityPresentation(activity.frame({width:field.clientWidth||800,height:field.clientHeight||400,reduced:motionOff()}));
    renderQuestFeedback(state.party?.quest);
    if(dialog.open)updateDialog();
    if(!visible()){stopAnimation();if(dialog.open)dialog.close();if(wagonDialog.open)wagonDialog.close();if(boardDialog.open)boardDialog.close();if(reportDialog.open)reportDialog.close();target.hidden=true;}
    const shown=displayedParty(),boardActivity=boardActive();$('#town-party-caption').textContent=shown?.members?.length?(boardActivity?(boardActivity.origin==='board'?worldText('掲示板の依頼 · '):worldText('クエスト · ')):shown.name+' · ')+worldText("{n}人のパーティ", {n:shown.members.length}):worldText('酒場で仲間とリーダーを選びましょう。');
  }
  document.querySelectorAll('[data-town-destination]').forEach(button=>{
    button.onclick=()=>{const place=button.dataset.townDestination;locate(place);welcome(place);onNavigate(place);};
  });
  $('#town-refresh').onclick=async()=>{
    if(refreshing)return;
    refreshing=true;render();
    try{await onRefresh();}finally{refreshing=false;render();}
  };
  const timer=setInterval(()=>{if(!$('#town-hud').hidden)render();},15000);
  const observer=new ResizeObserver(()=>{syncWalking(displayedParty());if(dialog.open)positionCharacterDialog();});observer.observe(field);
  function motionChanged(){if(motionOff()){stopAnimation();if(!ownsParty()&&trail?.moving)trail.moveTo(trail.destination,{instant:true});paint();}else startAnimation();}
  function visibilityChanged(){if(document.visibilityState==='hidden'){stopAnimation();observeQuest(null);pendingCelebration=null;}else render();}
  addEventListener('chat-ui-motion',motionChanged);reducedMotion.addEventListener('change',motionChanged);
  document.addEventListener('visibilitychange',visibilityChanged);
  addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);clearTimeout(markerTimer);clearTimeout(arrivalTimer);clearTimeout(celebrationTimer);stopAnimation();observer.disconnect();removeEventListener('chat-ui-motion',motionChanged);reducedMotion.removeEventListener('change',motionChanged);document.removeEventListener('visibilitychange',visibilityChanged);dialog.remove();wagonDialog.remove();boardDialog.remove();reportDialog.remove();},{once:true});
  return {render,openBoard,setView:next=>{const entered=next!==view;view=next;navigating=false;if(next!=='town'){stopAnimation();if(dialog.open)dialog.close();if(wagonDialog.open)wagonDialog.close();if(boardDialog.open)boardDialog.close();if(reportDialog.open)reportDialog.close();target.hidden=true;}locate(next==='equipment'?shop:next);render();if(entered&&['equipment','tavern','castle'].includes(next))welcome(next==='equipment'?shop:next);},setShop:next=>{const changed=next!==shop;shop=next;if(view==='equipment'){locate(shop);if(changed)welcome(shop);}}};
}
