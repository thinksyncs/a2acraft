import {ui as localize} from './interface-language.js';
import {PartyRunner,partyStatusLabels,partyStepLabels} from './party-runner.js';
import {equipmentIcon} from './equipment.js';
import {equipmentSlots} from './equipment-catalog.js';
import {characterAppearance,characterIcon} from './character-appearance.js';
const active=quest=>['running','stopping'].includes(quest?.status);
const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
export function initParty({api,demo,storeKey,getChats,getState,getModel,canConnect,onState,onChat,onSelect,onDemoTurn,onPersistQuest=async()=>{}}){
  const $=selector=>document.querySelector(selector),rows=new Map();
  let draft=null,savedKey='',awaitingChats=false,busy=false,error='',notice='',demoRunner,demoLoading,demoTurn;
  let sceneKey='',dismissedQuest=null,editorFocus=null;
  function current(){return getState()||{party:{name:localize('旅の仲間', "Traveling companions"),leaderId:null,members:[]},quest:null};}
  function syncDraft(){
    const saved=current().party,key=JSON.stringify(saved);
    if(draft&&key===savedKey&&(!awaitingChats||!getChats().length))return;savedKey=key;
    awaitingChats=!saved.members?.length&&($('#tavern-view').hidden||!getChats().length);
    const members=saved.members?.length?structuredClone(saved.members):getChats().slice(0,4).map((chat,index)=>({conversationId:chat.id,role:[localize('全体整理', "Coordination"),localize('調査', "Research"),localize('執筆', "Writing"),localize('レビュー', "Review")][index]||localize('補助', "Support")}));
    draft={name:saved.name||localize('旅の仲間', "Traveling companions"),leaderId:saved.leaderId||members[0]?.conversationId||null,members};
  }
  function updateOrder(){
    const order=$('#party-order');order.replaceChildren();if(!draft)return;
    const members=[...draft.members.filter(m=>m.conversationId!==draft.leaderId),...draft.members.filter(m=>m.conversationId===draft.leaderId)];
    for(const [index,member] of members.entries()){
      if(index)order.append(text('span','→'));
      const chat=getChats().find(c=>c.id===member.conversationId),leader=member.conversationId===draft.leaderId;
      order.append(text('span',(leader?localize('リーダーのまとめ', "Leader's summary"):member.role||localize('役割未入力', "Role missing"))+' / '+(chat?.title||localize('会話不明', "Unknown conversation")),leader?'party-leader-label':''));
    }
    if(!members.length)order.append(text('span',localize('仲間を選んでください。', "Choose a companion.")));
  }
  function openEditor(id){
    const dialog=$('#party-edit-dialog');if(!dialog)return;
    editorFocus=document.activeElement;$('#party-edit').open=true;dialog.showModal();
    const member=id&&rows.get(id),target=member&&!member.role.matches(':disabled')?member.role:member&&!member.chosen.matches(':disabled')?member.chosen:$('#party-edit-close');
    target.focus();if(member)member.row.scrollIntoView({block:'nearest'});
  }
  function renderScene(formation,quest,showingProgress){
    const scene=$('#party-scene-roster');if(!scene)return;
    const configured=formation.members||[],members=[...configured.filter(member=>member.conversationId!==formation.leaderId),...configured.filter(member=>member.conversationId===formation.leaderId)];
    const key=JSON.stringify([formation,showingProgress,quest?.steps?.map(step=>[step.conversationId,step.status]),members.map(member=>{const chat=getChats().find(item=>item.id===member.conversationId);return [chat?.title,chat?.characterName];})]);
    $('#party-scene-name').textContent=formation.name||localize('旅の仲間', "Traveling companions");
    $('#party-scene-hint').textContent=showingProgress?localize('仲間を選ぶと、その会話を確認できます。', "Choose a companion to view their conversation."):localize('仲間を選ぶと、役割を変えられます。', "Choose a companion to change their role.");
    if(key===sceneKey)return;sceneKey=key;scene.replaceChildren();
    for(const [index,member] of members.entries()){
      const chat=getChats().find(item=>item.id===member.conversationId);if(!chat)continue;
      const leader=member.conversationId===formation.leaderId,role=leader?localize('リーダー', "Leader"):member.role||localize('補助', "Support"),name=chat.characterName||chat.title;
      const step=showingProgress?quest?.steps?.find(item=>item.conversationId===chat.id):null;
      const actor=text('button','','party-scene-actor');actor.type='button';actor.dataset.partyActor=chat.id;actor.dataset.appearance=characterAppearance(member.role).id;actor.dataset.status=step?.status||'ready';actor.classList.toggle('is-leader',leader);
      actor.setAttribute('aria-label',name+' · '+role+' · '+(showingProgress?localize('会話を開く', "Open chat"):localize('役割を変更', "Change role")));actor.title=chat.title;
      actor.onclick=()=>showingProgress?onSelect(chat.id):openEditor(chat.id);
      const portrait=text('span','','party-scene-portrait');portrait.setAttribute('aria-hidden','true');
      const position=text('span',leader?'★':String(index+1),'party-scene-position');position.setAttribute('aria-hidden','true');
      actor.append(portrait,position,text('strong',name,'party-scene-person'),text('span',role,'party-scene-role'));
      if(step&&step.status!=='pending')actor.append(text('span',partyStepLabels[step.status]||step.status,'party-scene-state'));
      scene.append(actor);
    }
    if(!scene.children.length){const empty=text('button',localize('仲間を迎える', "Recruit companions"),'party-scene-empty');empty.type='button';empty.onclick=()=>openEditor();scene.append(empty);}
  }
  function memberRow(chat){
    if(rows.has(chat.id))return rows.get(chat.id);
    const row=text('div','','party-member');row.dataset.memberId=chat.id;
    const top=text('div','','party-member-top'),avatar=text('span','','party-avatar'),title=text('strong',chat.title,'party-member-title'),open=text('button',localize('会話を見る', "View chat"),'text-btn');open.type='button';open.onclick=()=>{$('#party-edit-dialog')?.close();onSelect(chat.id);};
    avatar.append(characterIcon(''));top.append(avatar,title,open);
    const gear=text('div','','party-member-gear'),controls=text('div','','party-member-controls');
    const chosenLabel=document.createElement('label'),chosen=document.createElement('input');chosen.type='checkbox';chosen.dataset.partyMember=chat.id;chosenLabel.append(chosen,document.createTextNode(localize('仲間にする', "Add to party")));
    const leaderLabel=document.createElement('label'),leader=document.createElement('input');leader.type='radio';leader.name='party-leader';leader.value=chat.id;leader.dataset.partyLeader=chat.id;leaderLabel.append(leader,document.createTextNode(localize('リーダー', "Leader")));
    const position=text('span','','party-position');controls.append(chosenLabel,leaderLabel,position);
    const roleLine=text('div','','party-role-line'),label=text('label',localize('役割', "Role")),role=document.createElement('input');role.maxLength=120;role.id='party-role-'+chat.id;role.dataset.partyRole=chat.id;label.htmlFor=role.id;
    const up=text('button','↑','outline'),down=text('button','↓','outline');up.type=down.type='button';up.setAttribute('aria-label',chat.title+localize('の順番を上へ', " · move up"));down.setAttribute('aria-label',chat.title+localize('の順番を下へ', " · move down"));roleLine.append(label,role,up,down);
    chosen.onchange=()=>{
      if(chosen.checked){if(draft.members.length>=8){chosen.checked=false;error=localize('仲間はリーダーを含む8人までです。', "A party can have up to eight members, including the leader.");render();return;}draft.members.push({conversationId:chat.id,role:localize('補助', "Support")});if(!draft.leaderId)draft.leaderId=chat.id;}
      else{draft.members=draft.members.filter(m=>m.conversationId!==chat.id);if(draft.leaderId===chat.id)draft.leaderId=draft.members[0]?.conversationId||null;}
      render();
    };
    leader.onchange=()=>{draft.leaderId=chat.id;render();};
    role.oninput=()=>{const member=draft.members.find(m=>m.conversationId===chat.id);if(member)member.role=role.value;updateOrder();renderScene(draft,null,false);renderAvatar({avatar,gear},getChats().find(item=>item.id===chat.id)||chat,member,chat.id===draft.leaderId);};
    function move(delta){const members=draft.members.filter(m=>m.conversationId!==draft.leaderId),index=members.findIndex(m=>m.conversationId===chat.id);if(index<0||index+delta<0||index+delta>=members.length)return;[members[index],members[index+delta]]=[members[index+delta],members[index]];draft.members=[...members,...draft.members.filter(m=>m.conversationId===draft.leaderId)];render();}
    up.onclick=()=>move(-1);down.onclick=()=>move(1);
    row.append(top,gear,controls,roleLine);const value={row,avatar,title,gear,chosen,leader,position,role,up,down};rows.set(chat.id,value);return value;
  }
  function renderAvatar(ui,chat,member,leader){
    const appearance=characterAppearance(member?.role),gearKey=JSON.stringify([chat.equipment,leader,member?.role]);
    if(ui.gear.dataset.key===gearKey)return;
    ui.gear.dataset.key=gearKey;ui.gear.replaceChildren();if(leader)ui.gear.append(equipmentIcon('crown'));
    for(const slot of equipmentSlots)if(chat.equipment?.[slot])ui.gear.append(equipmentIcon(chat.equipment[slot]));
    if(!ui.gear.children.length)ui.gear.append(document.createTextNode(localize('装備なし', "No equipment")));
    ui.avatar.dataset.appearance=appearance.id;ui.avatar.setAttribute('role','img');ui.avatar.setAttribute('aria-label',appearance.label);
    ui.avatar.replaceChildren(characterIcon(member?.role));if(chat.equipment?.weapon)ui.avatar.append(equipmentIcon(chat.equipment.weapon,'equipment-icon party-held'));
  }
  function render(){
    syncDraft();const value=current(),quest=value.quest,unfinished=active(quest)||quest?.status==='paused';
    const showingProgress=Boolean(quest&&(unfinished||dismissedQuest!==quest.id));
    $('#tavern-view').dataset.partyState=quest?.status||'ready';
    const layout=$('#tavern-view .party-layout');layout.dataset.progress=String(showingProgress);
    const editError=$('#party-edit-error');if(editError){editError.hidden=!error;editError.textContent=error;}
    const editorHint=$('#party-edit-dialog .party-edit-heading p');if(editorHint)editorHint.textContent=unfinished?localize('クエスト中は編成を変更できません。', "Finish or stop the quest before changing the party."):localize('役割の順に進め、最後はリーダーがまとめます。', "Members work in order, then the leader summarizes their results.");
    if(document.activeElement!==$('#party-name'))$('#party-name').value=draft.name;
    $('#party-configuration').disabled=busy||unfinished;
    const roster=$('#party-members'),order=[...draft.members.map(m=>getChats().find(c=>c.id===m.conversationId)).filter(Boolean),...getChats().filter(c=>!draft.members.some(m=>m.conversationId===c.id))];
    for(const [index,chat] of order.entries()){
      const ui=memberRow(chat),member=draft.members.find(m=>m.conversationId===chat.id),leader=Boolean(member&&draft.leaderId===chat.id),workers=draft.members.filter(m=>m.conversationId!==draft.leaderId),position=workers.findIndex(m=>m.conversationId===chat.id);
      ui.title.textContent=chat.title;ui.title.title=chat.title;ui.chosen.checked=Boolean(member);ui.leader.checked=leader;ui.leader.disabled=!member;
      ui.row.classList.toggle('is-member',Boolean(member));ui.row.classList.toggle('is-leader',leader);
      if(document.activeElement!==ui.role)ui.role.value=leader?localize('最後に成果をまとめる', "Summarize the results last"):member?.role||'';ui.role.disabled=!member||leader;
      ui.position.textContent=leader?localize('最後に行動', "Acts last"):member?localize('順番 ', "Turn ")+(position+1):'';
      ui.up.disabled=!member||leader||position<=0;ui.down.disabled=!member||leader||position===workers.length-1;
      renderAvatar(ui,chat,member,leader);
      if(roster.children[index]!==ui.row)roster.insertBefore(ui.row,roster.children[index]||null);
    }
    for(const [id,ui] of rows)if(!getChats().some(chat=>chat.id===id)){ui.row.remove();rows.delete(id);}
    updateOrder();renderScene(showingProgress&&quest.party?quest.party:draft,quest,showingProgress);
    $('#party-error').hidden=!error;$('#party-error').textContent=error;$('#party-notice').textContent=notice;
    $('#party-mode').textContent=notice||(demo?localize('体験モード', "Sample mode"):localize('仲間と進める', "Work with your party"));
    const model=getModel();$('#party-model-caption').textContent=unfinished?localize('このクエスト: ', "This quest: ")+quest.model+' / '+quest.effort:'MODEL: '+(model.model||localize('未選択', "None selected"))+' / '+(model.effort||'medium');
    $('#party-quest').readOnly=unfinished;$('#party-start').disabled=busy||unfinished||!model.model||!canConnect();
    $('#party-pause').hidden=!active(quest);$('#party-pause').disabled=busy||quest?.status==='stopping';
    $('#party-resume').hidden=quest?.status!=='paused';$('#party-resume').disabled=busy||!canConnect();
    const next=quest?.steps.find(step=>step.status!=='completed');$('#party-resume').textContent=next?.needsRetry?localize('この役割を再実行して続ける', "Retry this role and continue"):localize('続きから再開', "Resume here");
    $('#party-cancel').hidden=!unfinished;$('#party-cancel').disabled=busy||quest?.status==='stopping';
    $('#party-status').textContent=partyStatusLabels[quest?.status]||localize('出発前', "Before departure");$('#party-quest-summary').textContent=quest?.text||localize('クエストを渡すと、仲間が順番に行動します。', "Give the party a quest and each member will work in turn.");
    const runError=[quest?.error,next?.needsRetry?localize('この役割は実行済みの操作がある可能性があります。再実行前に会話の結果を確認できます。', "This role may already have performed actions. Check its record before retrying."):''].filter(Boolean).join('\n');
    $('#party-run-error').hidden=!runError;$('#party-run-error').textContent=runError;
    const steps=$('#party-steps'),key=JSON.stringify(quest?.steps||[]);
    if(steps.dataset.key!==key){
      steps.dataset.key=key;steps.replaceChildren();
      for(const [index,step] of (quest?.steps||[]).entries()){
        const row=text('li','','party-step is-'+step.status),heading=text('div','','party-step-heading');row.dataset.partyStep=step.id;row.dataset.status=step.status;
        heading.append(text('span',String(index+1)),text('strong',step.role),text('span',step.title),text('span',partyStepLabels[step.status]||step.status,'party-step-state'));row.append(heading);
        if(step.error)row.append(text('p',step.error));
        if(step.output){const details=document.createElement('details');details.append(text('summary',step.truncated?localize('成果を読む（先頭12,000文字・省略あり）', "Read result (first 12,000 characters; truncated)"):localize('成果を読む', "Read result")),text('pre',step.output));row.append(details);}
        const open=text('button',localize('会話を確認 →', "View conversation →"),'outline');open.type='button';open.onclick=()=>onSelect(step.conversationId);row.append(open);steps.append(row);
      }
    }
    const summary=quest?.status==='completed'?quest.steps.at(-1):null;$('#party-final').hidden=!summary;$('#party-final-text').textContent=summary?.output||'';$('#party-final h3').textContent=quest?.mode==='chat'?localize('担当チャットの成果', "Worker's result"):localize('リーダーのまとめ', "Leader's summary");$('#party-final-chat').textContent=quest?.mode==='chat'?localize('担当チャットの会話を開く →', "Open worker's conversation →"):localize('リーダーの会話を開く →', "Open leader's conversation →");
    const newQuest=$('#party-new-quest');if(newQuest){newQuest.hidden=!quest||unfinished;newQuest.textContent=quest?.status==='completed'?localize('次の依頼へ', "Next quest"):localize('依頼を見直す', "Review quest");}
    const viewRecord=$('#party-view-record');if(viewRecord)viewRecord.hidden=!quest||showingProgress;
  }
  async function ensureDemo(){
    if(!demo||demoRunner)return;
    if(demoLoading)return demoLoading;
    demoLoading=(async()=>{
      demoRunner=await new PartyRunner({getConversations:getChats,read:async()=>{try{return JSON.parse(localStorage.getItem(storeKey+'-party')||'null');}catch{return null;}},write:async value=>{localStorage.setItem(storeKey+'-party',JSON.stringify(value));await onPersistQuest(value.quest);},onChange:onState,
        interrupt:async()=>demoTurn?.stop(),execute:async({quest,step,prompt,onAccepted})=>{
          const chat=getChats().find(chat=>chat.id===step.conversationId);if(!chat)throw Error(localize('仲間が見つかりません。', "Companion not found."));
          const turnId=crypto.randomUUID();chat.status='running';chat.turnId=turnId;chat.messages.push({id:crypto.randomUUID(),role:'user',text:prompt,partyQuestId:quest.id,partyStepId:step.id,partyRole:step.role,skills:onDemoTurn(chat)});onChat(chat);
          let done,timer;const result=new Promise(resolve=>{done=resolve;});
          const turn={stop(){clearTimeout(timer);chat.status='cancelled';chat.turnId=null;onChat(chat);done({error:localize('デモの役割を停止しました。', "Sample role stopped."),needsRetry:true});}};demoTurn=turn;
          await onAccepted(turnId);
          if(demoRunner.stopRequested)turn.stop();else timer=setTimeout(()=>{const output=step.kind==='summary'?localize('【デモのまとめ】\n', "[Sample summary]\n")+quest.text+localize('\n\n仲間の成果を集め、未解決の点を整理したサンプルです。', "\n\nThese sample results bring together the party's work and list open questions."):localize(`【デモの成果：${step.role}】\n`, `[Sample result: ${step.role}]\n`)+quest.text+localize('\n\n次の仲間へ渡すサンプル成果です。', "\n\nA sample result to pass to the next companion.");chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:output});chat.status='completed';chat.turnId=null;onChat(chat);done({output});},1000);
          const value=await result;if(demoTurn===turn)demoTurn=null;if(value.error)throw Object.assign(Error(value.error),{needsRetry:true});return value;
        }}).load();onState(demoRunner.public());
    })();return demoLoading;
  }
  async function request(action,{configuration,questText}={}){
    if(busy)return false;busy=true;error='';notice='';render();
    try{
      await ensureDemo();
      if(action==='save'||action==='start'){
        const value=demo?await demoRunner.configure(configuration||draft):await api('party/configure',{party:configuration||draft});onState(value);notice=localize('編成を保存しました。', "Party saved.");
      }
      if(action==='start'){const params={text:questText??$('#party-quest').value,...getModel()};onState(demo?await demoRunner.start(params):await api('party/start',params));notice=localize('パーティにクエストを渡しました。', "Quest assigned to the party.");}
      if(action==='pause')onState(demo?await demoRunner.pause():await api('party/pause'));
      if(action==='cancel')onState(demo?await demoRunner.cancel():await api('party/cancel'));
      if(action==='resume'){const params={retry:Boolean(current().quest?.steps.find(step=>step.status!=='completed')?.needsRetry)};onState(demo?await demoRunner.resume(params):await api('party/resume',params));}
      return true;
    }catch(e){error=e.message;return false;}
    finally{busy=false;render();}
  }
  $('#party-name').oninput=()=>{syncDraft();draft.name=$('#party-name').value;renderScene(draft,null,false);};
  $('#party-form').onsubmit=async event=>{event.preventDefault();if(await request('save'))$('#party-edit-dialog')?.close();};$('#party-start').onclick=()=>request('start');$('#party-pause').onclick=()=>request('pause');$('#party-resume').onclick=()=>request('resume');$('#party-cancel').onclick=()=>request('cancel');
  if($('#party-edit-open'))$('#party-edit-open').onclick=()=>openEditor();
  if($('#party-edit-close'))$('#party-edit-close').onclick=()=>$('#party-edit-dialog').close();
  $('#party-edit-dialog')?.addEventListener('close',()=>{const target=editorFocus?.isConnected?editorFocus:$('#party-edit-open');if(!$('#tavern-view').hidden)target?.focus({preventScroll:true});});
  if($('#party-new-quest'))$('#party-new-quest').onclick=()=>{dismissedQuest=current().quest?.id;render();$('#party-quest').focus();};
  function openRecord() {
    dismissedQuest = null;
    render();
    const heading = $('#tavern-view .party-progress-heading h3');
    heading.tabIndex = -1;
    heading.focus();
  }
  if($('#party-view-record'))$('#party-view-record').onclick=openRecord;
  $('#party-final-chat').onclick=()=>{const leader=current().quest?.party.leaderId;if(leader)onSelect(leader);};
  function saveQuestDraft(value){
    if(active(current().quest)||current().quest?.status==='paused')return false;
    $('#party-quest').value=String(value??'');
    try{localStorage.setItem(storeKey+'-quest-draft',$('#party-quest').value);}catch{}
    return true;
  }
  $('#party-quest').oninput=()=>saveQuestDraft($('#party-quest').value);
  try{$('#party-quest').value=localStorage.getItem(storeKey+'-quest-draft')||'';}catch{}
  function renderPane(element,chat){
    let badge=element.querySelector('.party-pane-badge');if(!badge){badge=text('span','','party-pane-badge');element.querySelector('.panel-foot').append(badge);}
    const quest=current().quest,step=quest?.steps.find(step=>step.conversationId===chat.id);badge.textContent=step&&active(quest)?(step.kind==='summary'?localize('リーダー', "Leader"):step.role)+' · '+partyStepLabels[step.status]:'';
  }
  return {render,renderPane,openRecord,getQuestDraft:()=>$('#party-quest').value,setQuestDraft:saveQuestDraft,startQuest:async value=>{
    if(busy)throw Error(localize('前の操作が完了するまでお待ちください。', "Wait for the previous operation to finish."));
    if(active(current().quest)||current().quest?.status==='paused')throw Error(localize('現在のクエストを再開または終了してから出発してください。', "Resume or finish the current quest before starting another."));
    if(!canConnect())throw Error(localize('Codexに接続してから出発してください。', "Connect to Codex before departing."));
    if(!getModel().model)throw Error(localize('クエストに使うモデルを選択してください。', "Choose a model for this quest."));
    const questText=String(value??'');if(!questText.trim()||questText.length>8000)throw Error(localize('クエストを1〜8,000文字で入力してください。', "Enter a quest of 1–8,000 characters."));
    const configuration=structuredClone(current().party);saveQuestDraft(questText);
    if(!await request('start',{configuration,questText}))throw Error(error||localize('出発できませんでした。', "Could not start the quest."));
    return current();
  },open:async()=>{try{await ensureDemo();render();}catch(e){error=e.message;render();}},startTodo:async params=>{await ensureDemo();const value=await demoRunner.start(params);onState(value);return value;},todoAction:async(action,retry)=>{await ensureDemo();const value=action==='pause'?await demoRunner.pause():action==='cancel'?await demoRunner.cancel():await demoRunner.resume({retry});onState(value);return value;},active:()=>active(current().quest)};
}
