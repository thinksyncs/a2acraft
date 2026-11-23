import {questText} from './i18n-quests.js';
import {getLocale, onLocaleChange} from './i18n.js';
import {validateParty} from './party-runner.js';
import {practiceBusinessFor} from './practice.js';

export function castleReadiness({partyState,chats=[],model,connected=true,policy,busy=false}={}){
  if(busy)return questText('出発の準備をしています…');
  if(['running','stopping','paused'].includes(partyState?.quest?.status))return questText('進行中のクエストがあります。酒場の冒険の記録で、再開・停止・終了を選んでください。');
  if(!connected)return questText('Codexに接続してから出発してください。');
  if(policy?.ok===false)return policy.reason||questText('利用枠を確認してから出発してください。');
  if(!model?.model)return questText('クエストに使うモデルを選択してください。');
  try{validateParty(partyState?.party,chats);}catch(error){return questText(error.message)+questText(' 酒場で編成を保存してください。');}
  return '';
}

export function castleMembers(party,chats=[]){
  const members=Array.isArray(party?.members)?party.members:[];
  return [...members.filter(member=>member.conversationId!==party.leaderId),...members.filter(member=>member.conversationId===party.leaderId)].map(member=>{
    const chat=chats.find(chat=>chat.id===member.conversationId),leader=member.conversationId===party.leaderId;
    return {conversationId:member.conversationId,name:chat?.title||member.title||questText('会話不明'),role:member.role||questText('役割未入力'),leader};
  });
}

export function initCastle({api,demo=false,getPractice=()=>false,getTodos=()=>({items:[],plans:[]}),onTodo,getState,getChats,getModel,canConnect,getPolicy,getDraft,setDraft,onStart,onTavern,onTodos,onProgress}){
  const $=selector=>document.querySelector(selector);
  let busy=false,error='';
  let generating=false,registering=false,planError='',planNotice='',selectedPlan=null,localPlan=null,plansKey='',previewKey='';
  let practiceInitialized=false;
  const planDrafts=new Map(),locationLabels={library:'図書館 · 調査',workshop:'工房 · 作成',tavern:'酒場 · 連携',castle:'お城 · 整理'},planStatus={generating:'案を作成中',ready:'確認待ち',failed:'作成失敗',registered:'TODO登録済み'};
  const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el;};
  function plans(){const list=[...(getTodos()?.plans||[])];if(localPlan){const index=list.findIndex(plan=>plan.id===localPlan.id);if(index<0)list.unshift(localPlan);else if(localPlan.revision>list[index].revision)list[index]=localPlan;}return list;}
  function draftFor(plan){
    let draft=planDrafts.get(plan.id);
    if(!draft||plan.status==='registered'||(!draft.dirty&&draft.revision!==plan.revision)){draft={revision:plan.revision,steps:structuredClone(plan.steps||[]),dirty:false};planDrafts.set(plan.id,draft);}
    return draft;
  }
  function planningReason(){
    if(demo)return questText('デモではAIによる分解を実行しません。Codexに接続して利用できます。');
    if(generating)return questText('依頼原文から、小さなクエスト案を作っています…');
    if(registering)return questText('確認したクエストをTODOに登録しています…');
    if(!canConnect())return questText('Codexに接続してからクエスト案を作成してください。');
    if(getPolicy?.()?.ok===false)return getPolicy().reason||questText('利用枠を確認してください。');
    if(!getModel()?.model)return questText('クエスト案に使うモデルを選択してください。');
    if(['running','stopping','paused'].includes(getState()?.quest?.status))return questText('進行中のクエストを完了・終了してから、小さなクエスト案を作成してください。');
    if(getChats().some(chat=>['starting','running','stopping'].includes(chat.status)))return questText('実行中のチャットが終わってから、小さなクエスト案を作成してください。');
    if(plans().some(plan=>plan.status==='generating'))return questText('作成中のクエスト案が終わるまでお待ちください。');
    return '';
  }
  function sampleInputsEmpty(){return !$('#castle-work-request').value.trim()&&!$('#castle-work-artifact').value.trim();}
  function fillPracticeSample(){
    if(!getPractice()||generating||registering||!sampleInputsEmpty())return;
    const practiceBusiness=practiceBusinessFor(getLocale());
    $('#castle-work-request').value=practiceBusiness.request;
    $('#castle-work-artifact').value=practiceBusiness.expectedArtifact;
  }
  function renderPractice(){
    const practice=Boolean(getPractice());
    $('#castle-practice-guide').hidden=!practice;
    if(!practice)return;
    if(!practiceInitialized){practiceInitialized=true;fillPracticeSample();}
    $('#castle-practice-sample').disabled=generating||registering||!sampleInputsEmpty();
    $('#castle-practice-sample-note').textContent=sampleInputsEmpty()?questText('空の入力欄に経費精算のサンプルを入れます。'):questText('入力内容を保っています。サンプルを入れ直すときは、依頼と「成果を指定する」の入力欄を空にしてください。');
  }
  function renderPlan(){
    renderPractice();
    const list=plans(),picker=$('#castle-plan-select');
    if(!selectedPlan&&!generating)selectedPlan=(list.find(plan=>plan.status==='ready')||list[0])?.id||null;
    const listKey=JSON.stringify([getLocale(),list.map(plan=>[plan.id,plan.status,plan.request])]);
    if(listKey!==plansKey){plansKey=listKey;picker.replaceChildren(...list.map(plan=>new Option((questText(planStatus[plan.status]||plan.status))+' · '+plan.request.slice(0,48),plan.id)));if(!list.length)picker.add(new Option(questText('まだありません'),''));}
    picker.value=selectedPlan||'';picker.disabled=registering||!list.length;
    $('#castle-plan-history').hidden=!list.length;
    const plan=list.find(plan=>plan.id===selectedPlan),reason=planningReason();
    $('#castle-work-generate').disabled=Boolean(reason)||!$('#castle-work-request').value.trim();
    $('#castle-work-generate').textContent=generating?questText('クエスト案を作成中…'):questText('クエスト案を作る');
    $('#castle-work-request').readOnly=generating;$('#castle-work-artifact').readOnly=generating;
    $('#castle-work-options summary').textContent=$('#castle-work-artifact').value.trim()?questText('成果を指定する（入力済み）'):questText('成果を指定する（任意）');
    $('#castle-work-readiness').textContent=reason||questText('案を確認してからTODOに登録できます。');
    $('#castle-work-progress').hidden=!['running','stopping','paused'].includes(getState()?.quest?.status);
    $('#castle-work-error').textContent=planError;$('#castle-work-error').hidden=!planError;$('#castle-plan-notice').textContent=planNotice;
    $('#castle-plan-preview').hidden=!plan;if(!plan){previewKey='';return;}
    $('#castle-plan-preview .castle-preview-title').textContent=plan.status==='ready'?questText('このクエストで進めますか？'):plan.status==='registered'?questText('登録したクエスト'):questText('クエスト案');
    const requestCaption=plan.request.trim();
    $('#castle-plan-context').textContent=questText('この案の依頼：')+requestCaption.slice(0,100)+(requestCaption.length>100?'…':'');
    $('#castle-plan-mismatch').hidden=plan.request.trim()===$('#castle-work-request').value.trim()&&(plan.expectedArtifact||'').trim()===$('#castle-work-artifact').value.trim();
    const draft=draftFor(plan),key=JSON.stringify([getLocale(),plan.id,plan.revision,plan.status,registering]);
    if(previewKey!==key){
      previewKey=key;const source=$('#castle-plan-source');source.replaceChildren(node('summary',questText('元の依頼を確認')));
      const provenance=node('dl');for(const [label,value] of [[questText('元の依頼'),plan.request],[questText('指定した成果'),plan.expectedArtifact?.trim()?plan.expectedArtifact:questText('指定なし（各クエストの成果を確認）')]])provenance.append(node('dt',label),node('dd',value));source.append(provenance);
      const rows=$('#castle-plan-steps');rows.replaceChildren();
      for(const [index,step] of draft.steps.entries()){
        const row=node('li',undefined,'castle-plan-step');row.dataset.planStep=step.id;
        const overview=node('div',undefined,'castle-step-overview'),heading=node('h4'),task=node('p'),artifact=node('p',undefined,'castle-step-artifact');
        const updateOverview=()=>{heading.textContent=`${index+1}. ${step.title}`;task.textContent=step.task;artifact.textContent=questText('成果：')+step.artifact;};
        updateOverview();overview.append(heading,task,artifact);row.append(overview);
        const edit=node('details',undefined,'castle-disclosure castle-step-edit');edit.append(node('summary',plan.status==='ready'?questText('内容を調整する'):questText('詳しく見る')));
        for(const [field,label,maxlength] of [['title',questText('クエスト名'),120],['task',questText('実際に行う作業'),1000],['artifact',questText('このクエストで残す成果'),600],['criteria',questText('完了を確認する条件'),600]]){
          const id='castle-step-'+index+'-'+field,input=node(field==='title'?'input':'textarea'),caption=node('label',label);caption.htmlFor=id;input.id=id;input.dataset.planField=field;input.maxLength=maxlength;input.value=step[field]||'';input.required=true;input.readOnly=registering||plan.status!=='ready';if(field!=='title')input.rows=2;
          input.oninput=()=>{step[field]=input.value;draft.dirty=true;planError='';$('#castle-work-error').hidden=true;updateOverview();};edit.append(caption,input);
        }
        const caption=node('label',questText('行き先')),location=node('select');caption.htmlFor='castle-step-'+index+'-location';location.id=caption.htmlFor;location.dataset.planField='location';for(const [value,label] of Object.entries(locationLabels))location.add(new Option(questText(label),value));location.value=step.location;location.disabled=registering||plan.status!=='ready';location.onchange=()=>{step.location=location.value;draft.dirty=true;};edit.append(caption,location);row.append(edit);
        if(plan.status==='registered'&&plan.todoIds?.[index]){const open=node('button',questText('このTODOを開く →'),'outline');open.type='button';open.dataset.planTodo=plan.todoIds[index];open.onclick=()=>onTodo?.(plan.todoIds[index]);row.append(open);}
        rows.append(row);
      }
    }
    $('#castle-plan-state').textContent=plan.status==='ready'?questText('このまま登録できます。直したいところだけ「内容を調整する」を開いてください。'):plan.status==='registered'?questText('TODOに登録済みです。街の掲示板から進められます。'):plan.error||(questText(planStatus[plan.status]||plan.status));
    $('#castle-plan-register').hidden=plan.status!=='ready';$('#castle-plan-register').disabled=registering||generating||demo||!draft.steps.length;
  }
  function render(){
    const state=getState(),party=state?.party,members=castleMembers(party,getChats());
    $('#castle-party-name').textContent=party?.name||questText('パーティ未編成');
    const list=$('#castle-party-members'),key=JSON.stringify([getLocale(),members]);
    if(list.dataset.key!==key){
      list.dataset.key=key;list.replaceChildren();
      for(const [index,member] of members.entries()){
        const row=document.createElement('li'),name=document.createElement('strong'),role=document.createElement('span');
        row.dataset.castleMember=member.conversationId;row.className=member.leader?'is-leader':'';
        name.textContent=`${index+1}. ${member.name}`;role.textContent=member.leader?questText('リーダー · 最後に成果をまとめる'):member.role;
        row.append(name,role);list.append(row);
      }
      if(!members.length){const row=document.createElement('li');row.textContent=questText('酒場で仲間とリーダーを選び、編成を保存してください。');list.append(row);}
    }
    const reason=castleReadiness({partyState:state,chats:getChats(),model:getModel(),connected:canConnect(),policy:getPolicy?.(),busy});
    const unfinished=['running','stopping','paused'].includes(state?.quest?.status),field=$('#castle-quest');
    if(document.activeElement!==field&&field.value!==getDraft())field.value=getDraft();
    field.readOnly=busy||unfinished;
    $('#castle-start').disabled=Boolean(reason)||!field.value.trim();
    $('#castle-start').textContent=busy?questText('出発の準備中…'):questText('このクエストを渡して出発 →');
    $('#castle-readiness').textContent=reason||questText('保存済みの編成で、仲間が順番に処理し、最後にリーダーがまとめます。');
    $('#castle-progress').hidden=!state?.quest;
    $('#castle-error').textContent=error;$('#castle-error').hidden=!error;
    const model=getModel();$('#castle-model-caption').textContent=`MODEL: ${model.model||questText('未選択')} / ${model.effort||'medium'}`;
    renderPlan();
  }
  $('#castle-quest').oninput=()=>{setDraft($('#castle-quest').value);error='';render();};
  $('#castle-quest-form').onsubmit=async event=>{
    event.preventDefault();if(busy||$('#castle-start').disabled)return;
    const value=$('#castle-quest').value;
    busy=true;error='';render();
    try{await onStart(value);onProgress();}
    catch(reason){error=reason.message||questText('出発できませんでした。');}
    finally{busy=false;render();}
  };
  $('#castle-tavern').onclick=onTavern;$('#castle-todos').onclick=onTodos;$('#castle-progress').onclick=onProgress;$('#castle-work-progress').onclick=onProgress;
  $('#castle-work-request').oninput=renderPlan;$('#castle-work-artifact').oninput=renderPlan;
  $('#castle-practice-sample').onclick=()=>{fillPracticeSample();renderPlan();};
  $('#castle-plan-select').onchange=()=>{selectedPlan=$('#castle-plan-select').value||null;previewKey='';planError='';planNotice='';renderPlan();};
  $('#castle-work-form').onsubmit=async event=>{
    event.preventDefault();if(generating||registering||$('#castle-work-generate').disabled)return;
    const request=$('#castle-work-request').value,expectedArtifact=$('#castle-work-artifact').value;
    generating=true;planError='';planNotice='';renderPlan();
    try{const result=await api('work-quests/generate',{request,expectedArtifact,...getModel()});localPlan=result.plan;selectedPlan=result.plan.id;previewKey='';planNotice='';}
    catch(reason){planError=reason.message||questText('クエスト案を作成できませんでした。');}
    finally{generating=false;renderPlan();}
  };
  $('#castle-plan-register').onclick=async()=>{
    if(registering||generating||demo)return;const plan=plans().find(plan=>plan.id===selectedPlan);if(plan?.status!=='ready')return;
    const draft=draftFor(plan),invalid=[...$('#castle-plan-steps').querySelectorAll('input,textarea,select')].find(input=>!input.checkValidity()||input.required&&!input.value.trim());
    if(invalid){invalid.closest('details').open=true;invalid.focus();invalid.reportValidity();planError=questText('空欄の項目を入力してください。');$('#castle-work-error').textContent=planError;$('#castle-work-error').hidden=false;return;}
    registering=true;planError='';planNotice='';renderPlan();
    try{const result=await api('work-quests/register',{id:plan.id,revision:draft.revision,steps:structuredClone(draft.steps)});localPlan=result.plan;selectedPlan=result.plan.id;planDrafts.delete(plan.id);previewKey='';planNotice=questText('TODOに登録しました。街の掲示板または各クエストの「このTODOを開く」から開始できます。');}
    catch(reason){planError=reason.message||questText('TODOに登録できませんでした。');}
    finally{registering=false;renderPlan();}
  };
  onLocaleChange(render);
  return {render,open:()=>{error='';render();}};
}
