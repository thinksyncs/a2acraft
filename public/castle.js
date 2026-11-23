import {ui} from './interface-language.js';
import {validateParty} from './party-runner.js';
import {practiceBusiness} from './practice.js';

export function castleReadiness({partyState,chats=[],model,connected=true,policy,busy=false}={}){
  if(busy)return ui('出発の準備をしています…', "Getting ready to depart…");
  if(['running','stopping','paused'].includes(partyState?.quest?.status))return ui('進行中のクエストがあります。酒場の冒険の記録で、再開・停止・終了を選んでください。', "A quest is in progress. Open the adventure log at the tavern to resume, stop or end it.");
  if(!connected)return ui('Codexに接続してから出発してください。', "Connect to Codex before setting out.");
  if(policy?.ok===false)return policy.reason||ui('利用枠を確認してから出発してください。', "Check your usage allowance before setting out.");
  if(!model?.model)return ui('クエストに使うモデルを選択してください。', "Choose a model for this quest.");
  try{validateParty(partyState?.party,chats);}catch(error){return error.message+ui(' 酒場で編成を保存してください。', " Save your party at the tavern.");}
  return '';
}

export function castleMembers(party,chats=[]){
  const members=Array.isArray(party?.members)?party.members:[];
  return [...members.filter(member=>member.conversationId!==party.leaderId),...members.filter(member=>member.conversationId===party.leaderId)].map(member=>{
    const chat=chats.find(chat=>chat.id===member.conversationId),leader=member.conversationId===party.leaderId;
    return {conversationId:member.conversationId,name:chat?.title||member.title||ui('会話不明', "Unknown conversation"),role:member.role||ui('役割未入力', "No role assigned"),leader};
  });
}

export function initCastle({api,demo=false,getPractice=()=>false,getTodos=()=>({items:[],plans:[]}),onTodo,getState,getChats,getModel,canConnect,getPolicy,getDraft,setDraft,onStart,onTavern,onTodos,onProgress}){
  const $=selector=>document.querySelector(selector);
  let busy=false,error='';
  let generating=false,registering=false,planError='',planNotice='',selectedPlan=null,localPlan=null,plansKey='',previewKey='';
  let practiceInitialized=false;
  const planDrafts=new Map(),locationLabels={library:ui('図書館 · 調査', "Library · Research"),workshop:ui('工房 · 作成', "Workshop · Create"),tavern:ui('酒場 · 連携', "Tavern · Collaborate"),castle:ui('お城 · 整理', "Castle · Organize")},planStatus={generating:ui('案を作成中', "Drafting"),ready:ui('確認待ち', "Awaiting review"),failed:ui('作成失敗', "Could not create plan"),registered:ui('TODO登録済み', "Added to to-dos")};
  const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el;};
  function plans(){const list=[...(getTodos()?.plans||[])];if(localPlan){const index=list.findIndex(plan=>plan.id===localPlan.id);if(index<0)list.unshift(localPlan);else if(localPlan.revision>list[index].revision)list[index]=localPlan;}return list;}
  function draftFor(plan){
    let draft=planDrafts.get(plan.id);
    if(!draft||plan.status==='registered'||(!draft.dirty&&draft.revision!==plan.revision)){draft={revision:plan.revision,steps:structuredClone(plan.steps||[]),dirty:false};planDrafts.set(plan.id,draft);}
    return draft;
  }
  function planningReason(){
    if(demo)return ui('デモではAIによる分解を実行しません。Codexに接続して利用できます。', "Connect to Codex outside the demo to turn a request into smaller quests.");
    if(generating)return ui('依頼原文から、小さなクエスト案を作っています…', "Drafting smaller quests from your request…");
    if(registering)return ui('確認したクエストをTODOに登録しています…', "Adding your reviewed quests to the to-do list…");
    if(!canConnect())return ui('Codexに接続してからクエスト案を作成してください。', "Connect to Codex to draft a quest plan.");
    if(getPolicy?.()?.ok===false)return getPolicy().reason||ui('利用枠を確認してください。', "Check your usage allowance.");
    if(!getModel()?.model)return ui('クエスト案に使うモデルを選択してください。', "Choose a model for the quest plan.");
    if(['running','stopping','paused'].includes(getState()?.quest?.status))return ui('進行中のクエストを完了・終了してから、小さなクエスト案を作成してください。', "Finish or end the current quest before drafting another plan.");
    if(getChats().some(chat=>['starting','running','stopping'].includes(chat.status)))return ui('実行中のチャットが終わってから、小さなクエスト案を作成してください。', "Wait for the active conversation to finish before drafting a quest plan.");
    if(plans().some(plan=>plan.status==='generating'))return ui('作成中のクエスト案が終わるまでお待ちください。', "Wait for the current quest plan to finish.");
    return '';
  }
  function sampleInputsEmpty(){return !$('#castle-work-request').value.trim()&&!$('#castle-work-artifact').value.trim();}
  function fillPracticeSample(){
    if(!getPractice()||generating||registering||!sampleInputsEmpty())return;
    $('#castle-work-request').value=practiceBusiness.request;
    $('#castle-work-artifact').value=practiceBusiness.expectedArtifact;
  }
  function renderPractice(){
    const practice=Boolean(getPractice());
    $('#castle-practice-guide').hidden=!practice;
    if(!practice)return;
    if(!practiceInitialized){practiceInitialized=true;fillPracticeSample();}
    $('#castle-practice-sample').disabled=generating||registering||!sampleInputsEmpty();
    $('#castle-practice-sample-note').textContent=sampleInputsEmpty()?ui('空の入力欄に経費精算のサンプルを入れます。', "Fill the empty fields with a sample expense claim."):ui('入力内容を保っています。サンプルを入れ直すときは、依頼と「成果を指定する」の入力欄を空にしてください。', "Your entries are saved here. To load the sample again, clear the request and expected outcome fields.");
  }
  function renderPlan(){
    renderPractice();
    const list=plans(),picker=$('#castle-plan-select');
    if(!selectedPlan&&!generating)selectedPlan=(list.find(plan=>plan.status==='ready')||list[0])?.id||null;
    const listKey=JSON.stringify(list.map(plan=>[plan.id,plan.status,plan.request]));
    if(listKey!==plansKey){plansKey=listKey;picker.replaceChildren(...list.map(plan=>new Option((planStatus[plan.status]||plan.status)+' · '+plan.request.slice(0,48),plan.id)));if(!list.length)picker.add(new Option(ui('まだありません', "No plans yet"),''));}
    picker.value=selectedPlan||'';picker.disabled=registering||!list.length;
    $('#castle-plan-history').hidden=!list.length;
    const plan=list.find(plan=>plan.id===selectedPlan),reason=planningReason();
    $('#castle-work-generate').disabled=Boolean(reason)||!$('#castle-work-request').value.trim();
    $('#castle-work-generate').textContent=generating?ui('クエスト案を作成中…', "Drafting quest plan…"):ui('クエスト案を作る', "Draft a quest plan");
    $('#castle-work-request').readOnly=generating;$('#castle-work-artifact').readOnly=generating;
    $('#castle-work-options summary').textContent=$('#castle-work-artifact').value.trim()?ui('成果を指定する（入力済み）', "Expected outcome (entered)"):ui('成果を指定する（任意）', "Expected outcome (optional)");
    $('#castle-work-readiness').textContent=reason||ui('案を確認してからTODOに登録できます。', "Review the plan before adding it to your to-do list.");
    $('#castle-work-progress').hidden=!['running','stopping','paused'].includes(getState()?.quest?.status);
    $('#castle-work-error').textContent=planError;$('#castle-work-error').hidden=!planError;$('#castle-plan-notice').textContent=planNotice;
    $('#castle-plan-preview').hidden=!plan;if(!plan){previewKey='';return;}
    $('#castle-plan-preview .castle-preview-title').textContent=plan.status==='ready'?ui('このクエストで進めますか？', "Ready to take on these quests?"):plan.status==='registered'?ui('登録したクエスト', "Registered quests"):ui('クエスト案', "Quest plan");
    const requestCaption=plan.request.trim();
    $('#castle-plan-context').textContent=ui('この案の依頼：', "Request for this plan: ")+requestCaption.slice(0,100)+(requestCaption.length>100?'…':'');
    $('#castle-plan-mismatch').hidden=plan.request.trim()===$('#castle-work-request').value.trim()&&(plan.expectedArtifact||'').trim()===$('#castle-work-artifact').value.trim();
    const draft=draftFor(plan),key=JSON.stringify([plan.id,plan.revision,plan.status,registering]);
    if(previewKey!==key){
      previewKey=key;const source=$('#castle-plan-source');source.replaceChildren(node('summary',ui('元の依頼を確認', "View original request")));
      const provenance=node('dl');for(const [label,value] of [[ui('元の依頼', "Original request"),plan.request],[ui('指定した成果', "Expected outcome"),plan.expectedArtifact?.trim()?plan.expectedArtifact:ui('指定なし（各クエストの成果を確認）', "Unspecified (see each quest’s outcome)")]])provenance.append(node('dt',label),node('dd',value));source.append(provenance);
      const rows=$('#castle-plan-steps');rows.replaceChildren();
      for(const [index,step] of draft.steps.entries()){
        const row=node('li',undefined,'castle-plan-step');row.dataset.planStep=step.id;
        const overview=node('div',undefined,'castle-step-overview'),heading=node('h4'),task=node('p'),artifact=node('p',undefined,'castle-step-artifact');
        const updateOverview=()=>{heading.textContent=`${index+1}. ${step.title}`;task.textContent=step.task;artifact.textContent=ui('成果：', "Outcome: ")+step.artifact;};
        updateOverview();overview.append(heading,task,artifact);row.append(overview);
        const edit=node('details',undefined,'castle-disclosure castle-step-edit');edit.append(node('summary',plan.status==='ready'?ui('内容を調整する', "Edit details"):ui('詳しく見る', "View details")));
        for(const [field,label,maxlength] of [['title',ui('クエスト名', "Quest name"),120],['task',ui('実際に行う作業', "Task"),1000],['artifact',ui('このクエストで残す成果', "Expected outcome for this quest"),600],['criteria',ui('完了を確認する条件', "Completion criteria"),600]]){
          const id='castle-step-'+index+'-'+field,input=node(field==='title'?'input':'textarea'),caption=node('label',label);caption.htmlFor=id;input.id=id;input.dataset.planField=field;input.maxLength=maxlength;input.value=step[field]||'';input.required=true;input.readOnly=registering||plan.status!=='ready';if(field!=='title')input.rows=2;
          input.oninput=()=>{step[field]=input.value;draft.dirty=true;planError='';$('#castle-work-error').hidden=true;updateOverview();};edit.append(caption,input);
        }
        const caption=node('label',ui('行き先', "Destination")),location=node('select');caption.htmlFor='castle-step-'+index+'-location';location.id=caption.htmlFor;location.dataset.planField='location';for(const [value,label] of Object.entries(locationLabels))location.add(new Option(label,value));location.value=step.location;location.disabled=registering||plan.status!=='ready';location.onchange=()=>{step.location=location.value;draft.dirty=true;};edit.append(caption,location);row.append(edit);
        if(plan.status==='registered'&&plan.todoIds?.[index]){const open=node('button',ui('このTODOを開く →', "Open this to-do →"),'outline');open.type='button';open.dataset.planTodo=plan.todoIds[index];open.onclick=()=>onTodo?.(plan.todoIds[index]);row.append(open);}
        rows.append(row);
      }
    }
    $('#castle-plan-state').textContent=plan.status==='ready'?ui('このまま登録できます。直したいところだけ「内容を調整する」を開いてください。', "The plan is ready. Use “Edit details” on any quest you want to change."):plan.status==='registered'?ui('TODOに登録済みです。街の掲示板から進められます。', "These quests are on your to-do list. Get started at the town noticeboard."):plan.error||(planStatus[plan.status]||plan.status);
    $('#castle-plan-register').hidden=plan.status!=='ready';$('#castle-plan-register').disabled=registering||generating||demo||!draft.steps.length;
  }
  function render(){
    const state=getState(),party=state?.party,members=castleMembers(party,getChats());
    $('#castle-party-name').textContent=party?.name||ui('パーティ未編成', "No party yet");
    const list=$('#castle-party-members'),key=JSON.stringify(members);
    if(list.dataset.key!==key){
      list.dataset.key=key;list.replaceChildren();
      for(const [index,member] of members.entries()){
        const row=document.createElement('li'),name=document.createElement('strong'),role=document.createElement('span');
        row.dataset.castleMember=member.conversationId;row.className=member.leader?'is-leader':'';
        name.textContent=`${index+1}. ${member.name}`;role.textContent=member.leader?ui('リーダー · 最後に成果をまとめる', "Leader · Combines the party’s results"):member.role;
        row.append(name,role);list.append(row);
      }
      if(!members.length){const row=document.createElement('li');row.textContent=ui('酒場で仲間とリーダーを選び、編成を保存してください。', "Choose companions and a leader at the tavern, then save your party.");list.append(row);}
    }
    const reason=castleReadiness({partyState:state,chats:getChats(),model:getModel(),connected:canConnect(),policy:getPolicy?.(),busy});
    const unfinished=['running','stopping','paused'].includes(state?.quest?.status),field=$('#castle-quest');
    if(document.activeElement!==field&&field.value!==getDraft())field.value=getDraft();
    field.readOnly=busy||unfinished;
    $('#castle-start').disabled=Boolean(reason)||!field.value.trim();
    $('#castle-start').textContent=busy?ui('出発の準備中…', "Getting ready…"):ui('このクエストを渡して出発 →', "Give the party this quest and set out →");
    $('#castle-readiness').textContent=reason||ui('保存済みの編成で、仲間が順番に処理し、最後にリーダーがまとめます。', "Your party will work in turn. The leader will bring their results together.");
    $('#castle-progress').hidden=!state?.quest;
    $('#castle-error').textContent=error;$('#castle-error').hidden=!error;
    const model=getModel();$('#castle-model-caption').textContent=`MODEL: ${model.model||ui('未選択', "None selected")} / ${model.effort||'medium'}`;
    renderPlan();
  }
  $('#castle-quest').oninput=()=>{setDraft($('#castle-quest').value);error='';render();};
  $('#castle-quest-form').onsubmit=async event=>{
    event.preventDefault();if(busy||$('#castle-start').disabled)return;
    const value=$('#castle-quest').value;
    busy=true;error='';render();
    try{await onStart(value);onProgress();}
    catch(reason){error=reason.message||ui('出発できませんでした。', "Could not set out.");}
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
    catch(reason){planError=reason.message||ui('クエスト案を作成できませんでした。', "Could not draft the quest plan.");}
    finally{generating=false;renderPlan();}
  };
  $('#castle-plan-register').onclick=async()=>{
    if(registering||generating||demo)return;const plan=plans().find(plan=>plan.id===selectedPlan);if(plan?.status!=='ready')return;
    const draft=draftFor(plan),invalid=[...$('#castle-plan-steps').querySelectorAll('input,textarea,select')].find(input=>!input.checkValidity()||input.required&&!input.value.trim());
    if(invalid){invalid.closest('details').open=true;invalid.focus();invalid.reportValidity();planError=ui('空欄の項目を入力してください。', "Fill in the empty fields.");$('#castle-work-error').textContent=planError;$('#castle-work-error').hidden=false;return;}
    registering=true;planError='';planNotice='';renderPlan();
    try{const result=await api('work-quests/register',{id:plan.id,revision:draft.revision,steps:structuredClone(draft.steps)});localPlan=result.plan;selectedPlan=result.plan.id;planDrafts.delete(plan.id);previewKey='';planNotice=ui('TODOに登録しました。街の掲示板または各クエストの「このTODOを開く」から開始できます。', "Added to your to-do list. Get started at the town noticeboard or choose “Open this to-do” on a quest.");}
    catch(reason){planError=reason.message||ui('TODOに登録できませんでした。', "Could not add these quests to the to-do list.");}
    finally{registering=false;renderPlan();}
  };
  return {render,open:()=>{error='';render();}};
}
