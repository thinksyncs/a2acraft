import {chatError, chatText, messageCount, refreshSampleCopy} from './i18n-chat.js';
import {getLocale, onLocaleChange} from './i18n.js';
import {initContextSharing} from './context-sharing.js';
import {initAttachments} from './attachments.js';
import {renderMessageMarkdown} from './message-markdown.js';
import {mapTranscriptText} from './world-dialogue.js';
import {initEquipment} from './equipment.js';
import {initParty} from './party.js';
import {initCastle} from './castle.js';
import {initPlugins} from './plugins.js';
import {initTodos} from './todos.js';
import {initMedia} from './media.js';
import {initTown} from './town.js';
import {initWorkspaceTabs,chatGroupsFor,groupForConversation} from './workspace-tabs.js';
import {assignCharacterNames} from './character-names.js';
import {initActivity} from './activity.js';
import {initHistory} from './history.js';
import {initConnectionReadiness} from './connection-readiness.js';
import {initAdventure} from './adventure.js';
import {initVillage} from './village.js';
import {createResidentConversation} from './resident-conversation.js';
import {residentDemoReply} from './resident-demo.js';
import {residentVisitFor,residentSquadParty,companionRoster,buildResidentContext} from './resident-companions.js';
import {initDiscoverySharing} from './discovery-sharing.js';
import {initProjects} from './projects.js';
import {projectVillageActivities} from './village-activity.js';
import {createWorldRoom,button as roomButton} from './world-room.js';
import {projectDemo} from './project-demo.js';
import {villageDemoChats,villageDemoActivityState,villageDemoQuestSource} from './village-demo.js';
import {renderAgentDelegation} from './agent-delegation-view.js';
import {withAgentDelegationSample} from './agent-delegation-demo.js';
import {createDraftPersistence,mergeRecoveredDrafts} from './draft-persistence.js';
import {mapStorage} from './map-storage.js';
import {requestForSend,sendWasAccepted,recoverSendDrafts,restoreSendDraft} from './send-delivery.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const demo = new URLSearchParams(location.search).get('demo') === '1';
const villageSample=demo&&new URLSearchParams(location.search).get('village')==='sample';
const projectSample=demo&&new URLSearchParams(location.search).get('projects')==='sample';
const subagentSample=demo&&new URLSearchParams(location.search).get('subagents')==='sample';
const desktop = window.desktop?.isElectron || window.desktop?.isTauri ? window.desktop : null;
await mapStorage.initialize({desktop,demo,onError:error=>toast(error.message)});
const desktopName = desktop?.isTauri ? 'Tauri' : 'Electron';
const storeKey = demo ? 'chat-ui-demo' : 'chat-ui';
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
const statusLabels = {idle:'待機中', starting:'開始中', running:'実行中', stopping:'停止待ち', completed:'完了', cancelled:'停止', failed:'エラー'};
let state = {connected:false, account:null, limits:null, models:[], policy:{ok:false, reason:'Codexに接続してください。'}};
let chats = [], selected = null, layout = 1, drafts = {}, sendRequests = {}, view = 'town', steerPending = false, sendBlocked = true;
const groupSelections=new Map();
const pendingSends=new Set();
const conversationModeRequests=new Map();
let demoCharacterNames={};
let villageChatSeed, projectSeed;
try{const saved=JSON.parse(localStorage.getItem(storeKey+'-character-names')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))demoCharacterNames=saved;}catch{}
function nameDemoChats(rows){
  for(const chat of rows)if(typeof demoCharacterNames[chat.id]==='string'&&demoCharacterNames[chat.id].trim())chat.characterName=demoCharacterNames[chat.id];
  assignCharacterNames([...chats.filter(chat=>!rows.some(row=>row.id===chat.id)),...rows]);
  for(const chat of rows)demoCharacterNames[chat.id]=chat.characterName;
  try{localStorage.setItem(storeKey+'-character-names',JSON.stringify(demoCharacterNames));}catch{}
  return rows;
}
let motionPreference = 'system', demoDelay, demoStream;
let renderedNavigation = '';
let conversationRenderTimer = 0;
let booting = true, connectionRequested = false, connectionBusy = false, connectionError = '', serverUnavailable = false, eventStream;
let offlineBrowsing=false,historyLoaded=false,historyLoadError='';
let connectionReadiness;
let practiceEffortInitialized=false;
let townToolsOpen=false,townSidebarWasCollapsed=false,currentTownSection='town';
let contextBoard = [];
let activeEncounter = null;
const panels = new Map();
let draftSaveNotice, draftSaveMessage, draftSaveRetry;
let desktopDraftReadError=null,desktopDraftReloading=false;
function showDraftSaveError(error){
  if(!draftSaveNotice){
    draftSaveNotice=document.createElement('div');draftSaveNotice.className='notice';draftSaveNotice.setAttribute('role','alert');
    draftSaveMessage=document.createElement('span');draftSaveRetry=document.createElement('button');
    draftSaveRetry.type='button';draftSaveRetry.className='text-btn';draftSaveRetry.onclick=retryDesktopDrafts;
    draftSaveNotice.append(draftSaveMessage,draftSaveRetry);$('#composer').before(draftSaveNotice);
  }
  draftSaveNotice.hidden=false;
  draftSaveMessage.textContent=(desktopDraftReadError?chatText('下書きの保存を止めています。'):chatText('下書きを保存できませんでした。'))+error.message+' ';
  draftSaveRetry.textContent=desktopDraftReadError?chatText('下書きの読み込みを再試行'):chatText('下書きの保存を再試行');
}
const desktopDrafts=desktop&&!demo?createDraftPersistence({
  write:snapshot=>{if(desktopDraftReadError)throw desktopDraftReadError;return desktop.saveUiState(snapshot);},
  onChange:status=>{
    if(!draftSaveNotice)return;
    draftSaveNotice.hidden=!status.error&&!desktopDraftReadError;
    draftSaveRetry.disabled=status.saving||desktopDraftReloading;
    draftSaveRetry.textContent=desktopDraftReloading?chatText('読み込んでいます…'):status.saving?chatText('保存しています…'):desktopDraftReadError?chatText('下書きの読み込みを再試行'):chatText('下書きの保存を再試行');
  },
  onError:showDraftSaveError
}):null;
async function retryDesktopDrafts(){
  if(!desktopDraftReadError)return desktopDrafts?.retry();
  if(desktopDraftReloading)return;
  const wasInert=document.body.inert,focused=document.activeElement;
  desktopDraftReloading=true;document.body.inert=true;
  try{
    // No old fallback snapshot can race the recovered snapshot into the host.
    await desktopDrafts.flush().catch(()=>{});
    const saved=await desktop.getUiState();
    if(!saved||saved.loadError)throw Error(saved?.loadError||chatText('前回の下書きを読み込めませんでした。'));
    recoverSendDrafts(saved.sendRequests||{},chats,saved.drafts||{});
    const recovered=mergeRecoveredDrafts(saved,{drafts,sendRequests,selected,layout,motion:motionPreference});
    drafts=recovered.drafts;sendRequests=recovered.sendRequests;selected=recovered.selected;
    desktopDraftReadError=null;
    $('#prompt').value=drafts[selected]||'';
    persist();await desktopDrafts.flush();renderChats();
  }catch(error){showDraftSaveError(error);}
  finally{desktopDraftReloading=false;document.body.inert=wasInert;focused?.focus?.();if(draftSaveRetry){draftSaveRetry.disabled=false;draftSaveRetry.textContent=desktopDraftReadError?chatText('下書きの読み込みを再試行'):chatText('下書きの保存を再試行');}}
}
let closeFocus=null;
desktop?.onBeforeClose?.(async closing=>{
  if(!closing){mapStorage.resume();document.body.inert=false;closeFocus?.focus?.();closeFocus=null;return;}
  closeFocus ||= document.activeElement;
  document.body.inert=true;
  village.saveView?.();projects.saveView?.();
  await mapStorage.flush();
  await desktopDrafts?.flush();
});
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
try {
  drafts = JSON.parse(localStorage.getItem(storeKey + '-drafts') || '{}');
  sendRequests = JSON.parse(localStorage.getItem(storeKey + '-send-requests') || '{}');
  selected = localStorage.getItem(storeKey + '-selected');
  layout = Number(localStorage.getItem(storeKey + '-layout') || 1);
  motionPreference = localStorage.getItem('chat-ui-motion') || 'system';
} catch {}
if (![1,2,4].includes(layout)) layout = 1;
if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) drafts = {};
if (!sendRequests || typeof sendRequests !== 'object' || Array.isArray(sendRequests)) sendRequests = {};
const chatVisible=()=>!$('#workspace').hidden&&!$('#chat-view').hidden;
const contextSharing = initContextSharing({
  getChats:() => chats, getBoard:() => contextBoard,
  onBoard:entries => { contextBoard = entries; renderChats(); },
  api, demo, available:chatVisible,
  notify:toast
});

const attachments=initAttachments({getSelected:()=>selected,onChange:()=>updateComposer(),notify:toast,isAvailable:()=>chatVisible()&&Boolean(selected),demo});
function boardActive(){return ['gathering','starting','running'].includes(state.boardDispatch?.active?.status);}
function partyActive(){return ['running','stopping'].includes(state.party?.quest?.status);}
const equipment=initEquipment({api,demo,storeKey,getChats:()=>chats,getSelected:()=>selected,onSelect:id=>select(id,'equipment'),onChat:chat=>{
  const index=chats.findIndex(item=>item.id===chat.id);if(index>=0)chats[index]=chat;renderChats();
},onUse:()=>switchView('chat',()=>$('#prompt').focus()),isVisible:()=>!$('#workspace').hidden&&view==='equipment',isLocked:()=>partyActive()||boardActive(),onShopChange:shop=>town.setShop(shop)});
const party=initParty({api,demo,storeKey,getChats:()=>chats,getState:()=>villageSample?{...state.party,party:villageDemoActivityState(state).party.party}:state.party,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),canConnect:()=>demo||(!serverUnavailable&&state.connected&&state.account?.type==='chatgpt'),onState:applyPartyState,onChat:chat=>{
  const index=chats.findIndex(item=>item.id===chat.id);if(index>=0)chats[index]=chat;renderChats();
},onSelect:id=>select(id),onDemoTurn:chat=>equipment.demoTurn(chat),onPersistQuest:quest=>todoView.syncDemoQuest(quest)});
const castle=initCastle({api,demo,getPractice:practiceMode,getTodos:()=>state.todos,onTodo:id=>switchView('todos',()=>todoView.open(id)),getState:()=>state.party,getChats:()=>chats,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),canConnect:()=>demo||(!serverUnavailable&&state.connected&&state.account?.type==='chatgpt'),getPolicy:()=>demo?{ok:true}:state.policy,getDraft:()=>party.getQuestDraft(),setDraft:value=>party.setQuestDraft(value),onStart:value=>party.startQuest(value),onTavern:()=>switchView('tavern'),onTodos:()=>switchView('todos'),onProgress:()=>openFacilityView('progress')});
const pluginView=initPlugins({api,demo,storeKey,onBoard:openPartyBoard,getTodos:()=>state.todos,onTodo:id=>switchView('todos',()=>todoView.open(id)),onDisabled:()=>{if(view==='backlog')switchView('settings');},onTeamsDisabled:()=>{if(view==='teams')switchView('settings');},getChats:()=>chats,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),getState:()=>state,onSelect:id=>select(id),onOpenExternal:openTeamsExternal,notify:toast});
const mediaView=initMedia({api,getState:()=>state.media,isVisible:()=>!$('#workspace').hidden&&view==='image',motionAllowed:()=>document.body.dataset.motion!=='reduced',onState:value=>{state.media=value;mediaView.render();todoView.hydrate();},onAttach:file=>switchView('chat',()=>attachments.addFiles([file])),notify:toast});
const todoView=initTodos({api,demo,storeKey,onTeams:id=>switchView('teams',()=>pluginView.openTeamsDraft(id)),getState:()=>state.todos,getChats:()=>chats,getParty:()=>state.party,getMedia:()=>state.media,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),canRun:()=>demo||(!serverUnavailable&&state.policy?.ok),onState:value=>{state.todos=value;todoView.hydrate();village.render();},onSelect:id=>select(id),onTavern:()=>switchView('tavern'),onMedia:id=>switchView('image',()=>mediaView.select(id)),onDemoStart:params=>party.startTodo(params),onDemoAction:(action,retry)=>party.todoAction(action,retry)});
const town=initTown({api,demo,onTeams:id=>switchView('teams',()=>pluginView.openTeamsDraft(id)),getModel:()=>({model:$('#model').value,effort:$('#effort').value}),onProgress:()=>openFacilityView('progress'),onTodo:id=>switchView('todos',()=>todoView.open(id)),getState:()=>state,getChats:()=>chats,getSelected:()=>selected,onNavigate:place=>switchView(place==='tavern'?'tavern':place==='castle'?'castle':'equipment',()=>{if(!['tavern','castle'].includes(place))equipment.open(place);}),onRefresh:refreshUsage,onCharacterChat:id=>select(id,'chat',()=>$('#prompt').focus()),onCharacterEquip:(id,slot)=>select(id,'equipment',()=>{equipment.open(slot);$('#equipment-chat').focus();})});
const workspaceTabs=initWorkspaceTabs({getGroups:()=>state.chatGroups,getChats:()=>chats,getSelected:()=>selected,getView:()=>view,onMap:()=>switchView('town',()=>townSection(currentTownSection==='projects'?'projects':'town')),onGroup:chooseChatGroup,onAdd:addChatGroup});
function openFacilityView(place) {
  const next = place === 'progress' ? 'tavern' : place === 'weapon' ? 'equipment' : place;
  switchView(next, () => {
    if (place === 'weapon') {
      equipment.open('weapon');
      $('#equipment-chat').focus();
    } else if (place === 'castle') {
      if (demo) $('#castle-direct-quest').open = true;
      $(demo ? '#castle-quest' : '#castle-work-request').focus();
    } else if (place === 'progress') {
      party.openRecord();
    }
  });
}
const castleRecords = {
  getProgress() {
    const quest = state.party?.quest;
    return {quest, squads: quest ? [] : projectVillageActivities(villageState(), chats).allSquads};
  },
  onProgress(record) {
    if (record.questId && state.party?.quest?.id === record.questId) {
      openFacilityView('progress');
      return;
    }
    switchView('town', () => {
      townSection('town');
      village.openSquadRecord(record.squadId);
    });
  },
};
const villageRoom = createWorldRoom({
  id: 'village-room', onExit: () => village.render(),
  ...castleRecords,
});
function visitVillageFacility(place) {
  const facility = {id: place, name: place === 'weapon' ? chatText('スキルの武器屋') : place === 'castle' ? chatText('王城') : chatText('旅立ちの酒場'),
    host: place === 'weapon' ? chatText('武器屋の店主') : place === 'castle' ? chatText('王様') : chatText('酒場の主人')};
  const label = place === 'weapon' ? chatText('武器を選んで試着する') : place === 'castle' ? chatText('依頼を書く') : chatText('仲間と役割を編成する');
  villageRoom.open(facility, village.getControlledParty()?.members.length || 1, (content, close) => {
    content.append(roomButton(label, () => { close(); openFacilityView(place); }, 'primary'));
  });
}
function villageState(){return villageSample?villageDemoActivityState(state):state;}
function villageIdeaBlock(){
 if(boardActive()||['running','stopping','paused'].includes(state.party?.quest?.status)||state.workQuestPlanning||state.projects?.activeCount||chats.some(active))return chatText('今の作業が終わったら始めよう。');
 if(!demo&&(serverUnavailable||!state.connected||state.account?.type!=='chatgpt'||state.login))return chatText('開始するにはCodexに接続してください。');
 if(!state.policy?.ok)return chatError(state.policy?.reason)||chatText('現在は依頼を開始できません。');
 return $('#model').value?'':chatText('使用するモデルを選んでください。');
}
async function acceptVillageIdea(invite){
 const blocked=villageIdeaBlock();if(blocked)throw Error(blocked);
 const source=villageState(),party=source.party?.party;
 const sampleItem=villageSample&&source.todos.items.find(task=>task.id===invite.id);
 return todoView.startInvitation(invite,{party,sampleItem});
}
const village=initVillage({api,demo,initiative:{blocked:villageIdeaBlock,start:acceptVillageIdea},getState:villageState,getChats:()=>chats,onState:applyVillageState,onOpenChat:openResidentChat,onOpenQuest:openVillageQuest,onOpenHistory:()=>history.open(),onNavigate:visitVillageFacility,onOpenBoard:()=>projects.openBoard(),
  teamMessaging:{
    read:id=>({draft:drafts[id]||'',...teamSendStatus(id)}),
    refreshQuota:refreshUsage,
    write:(id,text)=>{
      if(!chats.some(chat=>chat.id===id))return;
      drafts[id]=text;if(selected===id)$('#prompt').value=text;persist();
    },
    send:sendTeamChatMessage
  }});
const adventure=initAdventure({api,demo,getState:()=>state,getChats:()=>chats,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),onState:applyAdventureState,onProgress:()=>openFacilityView('progress'),onTown:()=>{townSection('town');village.focus();},notify:toast});
const discoveries=initDiscoverySharing({host:$('#adventure-world'),api,demo,getState:()=>state.discoveries,getAdventure:()=>state.adventure,onState:applyDiscoveryState,notify:toast});
const projects=initProjects({api,demo,castleRecords,getState:()=>state,getChats:()=>chats,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),onChat:openResidentChat,onMap:showProjectMap,onLegacy:()=>{townSection('town');village.focus();},onNavigate:openFacilityView,onState:value=>{state.projects=value;projects.render();updateComposer();},notify:toast});
// Panels are detached when switching a single-pane conversation. Keep the
// question card itself reachable while its previous transcript is off-screen.
const projectChatContext=$('#project-chat-context');
const residentConversation=createResidentConversation({host:$('#chat-view'),onParty:()=>switchView('tavern'),onExpand:()=>{
  switchView('chat',()=>{if(!$('#composer').hidden)$('#prompt').focus({preventScroll:true});});
},onReturn:()=>{
  const source=activeEncounter?.source;
  switchView('town',()=>{townSection(source==='projects'?'projects':'town');(source==='projects'?projects:village).focus();});
}});
function currentResidentParty(){
 if(activeEncounter?.source!=='village')return null;
 if(activeEncounter.squadId===undefined)return villageState().party?.party;
 if(village.getControlledSquadId()!==activeEncounter.squadId)throw Error(chatText('操作する隊が変わりました。地図でもう一度話しかけてください。'));
 return residentSquadParty(activeEncounter.squadId,villageState(),chats);
}
function residentVisitForChat(id){return activeEncounter?.conversationId===id?residentVisitFor(activeEncounter,id,currentResidentParty()):null;}
function scrollChatLatest(id){
  requestAnimationFrame(()=>{const list=panels.get(id)?.element.querySelector('.messages');if(list)list.scrollTop=list.scrollHeight;});
}
function endResidentConversation(){
  if(!activeEncounter)return;
  residentConversation.undock();
  $('#chat-view').hidden=view!=='chat';
  const source=activeEncounter.source==='projects'?projects:village;
  if(source.getEncounter()?.conversationId===activeEncounter.conversationId)source.endEncounter();
  activeEncounter=null;residentConversation.show(null);queueConversationRender();
}
function openResidentChat(id,encounter){
  if(!chats.some(chat=>chat.id===id)){toast(chatText('この会話を開けませんでした。'));return;}
  if(activeEncounter?.source!==encounter?.source||activeEncounter?.conversationId!==id)endResidentConversation();
  const focusChat=()=>{if(!$('#composer').hidden)$('#prompt').focus({preventScroll:true});scrollChatLatest(id);};
  if(!encounter?.scene){select(id,'chat',focusChat);return;}
  select(id,'town',()=>{
    activeEncounter=encounter;
    residentConversation.show(encounter,{recordOnly:Boolean(chats.find(chat=>chat.id===id)?.project)});
    const sourceMap=encounter.source==='projects'?'#project-village':'#history-village';
    residentConversation.dockIn($('#town-view'),$(sourceMap));
    renderChats(); focusChat();
  });
}
function showProjectMap(){switchView('town',()=>{townSection('projects');projects.focus();});}
function openPartyMap(onOpen){
  switchView('town',()=>{
    townSection('town');
    const facilities=$('#town-facilities');facilities.open=true;town.render();
    facilities.scrollIntoView({block:'start',behavior:'instant'});
    $('#town-walkfield').focus({preventScroll:true});
    onOpen?.();
  });
}
function openPartyBoard(){openPartyMap(()=>town.openBoard());}
const activityView=initActivity({api,demo,storeKey,getState:()=>state,getChats:()=>chats,getContextBoard:()=>contextBoard,getModel:()=>({model:$('#model').value,effort:$('#effort').value}),onState:(kind,value)=>{state[kind]=value;activityView.render();},onOpen:openActivitySource,notify:toast});
const history=initHistory({api,getDemo:()=>demo,getPersistenceError:()=>state.persistenceError,onRetrySave:async()=>{await api('history/save');state.persistenceError=null;updateState();history.render();},onImported:result=>{
  for(const chat of result.conversations||[])if(!chats.some(item=>item.id===chat.id))chats.push(chat);
  applyChatGroups(result.chatGroups);historyLoaded=true;historyLoadError='';renderChats();
},getChats:()=>chats,getSelected:()=>selected,isLoaded:()=>historyLoaded,getError:()=>historyLoadError,onSelect:id=>{
  offlineBrowsing=true;updateState();
  select(id,'chat',()=>panels.get(id)?.element.focus({preventScroll:true}));
  renderChats();
}});
function openActivitySource(source){
 const target=source.type==='schedule'?source.target:source;
 if(!target||target.type==='none')return switchView('schedules');
 const id=target.id||target.conversationId||target.todoId||target.questId;
 if(target.type==='chat'){if(!chats.some(chat=>chat.id===id))return toast(chatText('元の会話が見つかりません。'));return select(id);}
 if(target.type==='todo'){if(!state.todos?.items.some(item=>item.id===id))return toast(chatText('元のTODOが見つかりません。'));return switchView('todos',()=>todoView.open(id));}
 if(target.type==='party'){
  if(source.todoId&&state.todos?.items.some(item=>item.id===source.todoId))return switchView('todos',()=>todoView.open(source.todoId));
  if(id&&state.party?.quest?.id!==id)toast(chatText('過去のクエストの通知です。現在保存されている冒険の記録を開きます。'));
  return switchView('tavern');
 }
 switchView('schedules');
}
function openVillageQuest(activity){
 const sampleId=villageSample&&!state.todos?.items?.some(item=>item.id===activity.todoId)&&villageDemoQuestSource(activity.todoId);
 if(sampleId)return select(sampleId,'chat',()=>panels.get(sampleId)?.element.focus({preventScroll:true}));
 if(activity.todoId&&state.todos?.items.some(item=>item.id===activity.todoId))return switchView('todos',()=>todoView.open(activity.todoId));
 if(activity.questId&&state.party?.quest?.id===activity.questId||!activity.questId&&!activity.todoId)return switchView('tavern');
 if(activity.targetConversationId&&chats.some(chat=>chat.id===activity.targetConversationId))return select(activity.targetConversationId,'chat',()=>panels.get(activity.targetConversationId)?.element.focus({preventScroll:true}));
 toast(chatText('この依頼の元の記録が見つかりません。'));
}
function currentChatGroup(){return groupForConversation(state.chatGroups,chats,selected)||chatGroupsFor(state.chatGroups,chats)[0];}
function chooseChatGroup(group){
  const remembered=groupSelections.get(group.id),id=group.conversationIds.includes(selected)?selected:group.conversationIds.includes(remembered)?remembered:group.conversationIds[0];
  if(!id)return;
  layout=4;
  if(selected===id&&view==='chat'&&!pendingView)renderChats();else select(id);
}
async function addChatGroup(){
  let result;
  if(demo){
    const groups=chatGroupsFor(state.chatGroups,chats),id=crypto.randomUUID();
    const conversations=nameDemoChats(Array.from({length:4},(_,index)=>({id:crypto.randomUUID(),title:chatText('チャット {index}',{index:groups.length+1})+' · '+(index+1),status:'idle',messages:[]})));
    const group={id,title:chatText('チャット {index}',{index:groups.length+1}),conversationIds:conversations.map(chat=>chat.id)};
    result={group,conversations,chatGroups:{version:1,revision:(state.chatGroups?.revision||0)+1,items:[...groups,group]}};
  }else result=await api('chat-groups',{locale:getLocale()});
  for(const chat of result.conversations)if(!chats.some(item=>item.id===chat.id))chats.push(chat);
  applyChatGroups(result.chatGroups);chooseChatGroup(result.group);
}
function applyChatGroups(value){
  if(!value||(value.revision||0)<(state.chatGroups?.revision||0))return;
  state.chatGroups=value;renderedNavigation='';workspaceTabs.render();
}
function applyPartyState(value){
  if(!value||(value.revision||0)<(state.party?.revision||0))return;
  state.party=value;updateComposer();equipment.render();town.render();village.render();pluginView.render();
}
function applyDiscoveryState(value){
  if(!value||(value.revision||0)<(state.discoveries?.revision||0))return;
  state.discoveries=value;discoveries.render();
}
function applyAdventureState(value){
  if(!value||(value.revision||0)<(state.adventure?.revision||0))return;
  state.adventure=value;adventure.render();discoveries.render();town.render();
  updateAdventureReturn();
}
function updateAdventureReturn(){
  const button=$('#party-world-return');
  button.hidden=!state.adventure?.active&&!state.adventure?.candidate;
  button.textContent=state.adventure?.candidate?chatText('世界地図で成果を確認 →'):chatText('世界地図へ戻る →');
}
function townSection(section){
  currentTownSection=section;
  projects.setVisible(view==='town'&&section==='projects',{preserveEncounter:activeEncounter?.source==='projects'&&view==='chat'});
  for(const id of ['history-village','adventure-world','town-facilities'])$('#'+id).hidden=section==='projects';
  for(const [id,value] of [['adventure-home','adventure'],['adventure-town-nav','town']]){
    const button=$('#'+id);
    if(view==='town'&&(section===value||section==='projects'&&value==='town'))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  village.setVisible(view==='town'&&section==='town'&&!$('#town-view').hidden&&!$('#workspace').hidden,{preserveEncounter:activeEncounter?.source==='village'&&view==='chat'});
  updateAppNavigation();
}
function updateAppNavigation(){
  const titles={chat:chatText('会話'),tavern:chatText('仲間'),equipment:chatText('装備'),castle:chatText('依頼'),terminal:chatText('ターミナル'),usage:chatText('利用状況'),settings:chatText('設定'),todos:chatText('依頼ノート'),image:chatText('画像と資料'),backlog:'Backlog',teams:'Teams',inbox:chatText('お知らせ'),reports:chatText('日報'),schedules:chatText('予約')};
  $('#town-navigation-title').textContent=view==='town'?(currentTownSection==='projects'?chatText('開発の街'):currentTownSection==='town'?chatText('村'):chatText('冒険')):(titles[view]||chatText('旅人の街'));
  for(const [id,current]of [['town-nav-tavern',view==='tavern'],['town-nav-chat',view==='chat'],['town-tools-toggle',!['town','tavern','chat'].includes(view)]]){
    const node=$('#'+id);if(current)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
  }
}
function applyVillageState(value){
  if(!value||value.revision<(state.village?.revision||0))return;
  state.village=value;village.render();
}

function persist() {
  const savedDrafts=Object.fromEntries(Object.entries(drafts).filter(([,text])=>text!==''));
  try {
    localStorage.setItem(storeKey + '-drafts', JSON.stringify(savedDrafts));
    localStorage.setItem(storeKey + '-send-requests', JSON.stringify(sendRequests));
    localStorage.setItem(storeKey + '-selected', selected || '');
    localStorage.setItem(storeKey + '-layout', layout);
  } catch {}
  desktopDrafts?.persist({drafts:savedDrafts,sendRequests,selected:selected || null,layout,motion:motionPreference});
}
function setText(selector, value) { const element = $(selector); if (element && element.textContent !== String(value)) element.textContent = value; }
function toast(message) {
  setText('#toast', message);
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').hidden = true, 5500);
}
async function api(route, data = {}) {
  const response = await fetch('/api/' + route, {method:'POST', headers:{'Content-Type':'application/json', 'X-Chat-UI':'1'}, body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) {
    const reason=result.error || '操作に失敗しました。';
    throw Object.assign(Error(chatError(reason)),{displayReason:reason});
  }
  return result;
}
function loginUrl() {
  try {
    const url = new URL(state.login?.authUrl);
    if (url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['auth.openai.com','login.openai.com','chatgpt.com','auth.chatgpt.com'].includes(url.hostname)) return url.href;
  } catch {}
  return null;
}
async function openTeamsExternal(value){
 if(demo)throw Error(chatText('デモではMicrosoftの認証画面やTeamsを開きません。'));
 let url;try{url=new URL(value);}catch{throw Error(chatText('Teamsのリンクを確認できません。'));}
 const device=url.href==='https://microsoft.com/devicelogin',teams=url.hostname==='teams.microsoft.com'&&url.pathname.startsWith('/l/');
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>6000||(!device&&!teams))throw Error(chatText('Microsoftの接続画面またはTeamsのメッセージリンクだけを開けます。'));
 if(desktop)await desktop.openExternal(url.href);else window.open(url.href,'_blank','noopener,noreferrer');
}
function practiceMode(){return desktop?.isTauri===true&&desktop.practice===true&&state.practice===true;}
function updateConnectionScreen() {
  const practice=practiceMode();
  $('#connect-practice-badge').hidden=!practice;$('#practice-banner').hidden=!practice;
  document.body.classList.toggle('practice-mode',practice);
  const authenticated = state.connected && state.account?.type === 'chatgpt' && !state.login;
  const showWorkspace = demo || offlineBrowsing || (connectionRequested && !connectionBusy && !connectionError && !serverUnavailable && authenticated);
  const workspace = $('#workspace'), screen = $('#connect-screen'), changed = workspace.hidden === showWorkspace;
  workspace.hidden = !showWorkspace;
  workspace.inert = !showWorkspace;
  screen.hidden = showWorkspace;
  const url = loginUrl(), waiting = Boolean(state.login && !serverUnavailable), error = connectionError || (!authenticated || serverUnavailable ? state.error : '') || '';
  $('#start-connect').disabled = booting || connectionBusy;
  $('#open-offline').disabled = booting || connectionBusy;
  $('#connect-spinner').hidden = !(booting || connectionBusy || waiting);
  $('#connect-screen').setAttribute('aria-busy', String(booting || connectionBusy));
  setText('#start-connect-label', booting ? chatText('準備中…') : connectionBusy ? chatText('接続中…') : waiting ? chatText('ログインをやり直す') : error || connectionRequested ? chatText('再接続') : 'Connect');
  const status = booting ? chatText('保存した街の状態を読み込んでいます…') : connectionBusy ? chatText('Codexへの接続・ログイン状態を確認しています…') : waiting ? chatText('ブラウザでログインを完了してください。完了後にメイン画面へ進みます。') : '';
  setText('#connect-status', status); $('#connect-status').hidden = !status;
  setText('#connect-error', chatError(error)); $('#connect-error').hidden = !error;
  const link = $('#connect-login-link'); link.hidden = !url || serverUnavailable;
  if (url) link.href = url;
  if (changed) {
    if (showWorkspace) { applyView('town'); $('#town-navigation-title').focus(); }
    else {
      clearTimeout(viewTransitionTimer); pendingView = null; pendingViewFocus = null; viewTransition.hidden = true;
      $('#start-connect').focus();
      equipment.invalidate();
    }
  }
  contextSharing.render();
  mediaView.visible(showWorkspace&&view==='image');
}
let terminal, terminalFit, terminalSession, terminalStream, terminalOpening, terminalStarted = false;
let terminalWriting = Promise.resolve(), terminalResizeTimer;
function terminalStatus(text, running = false) {
  setText('#terminal-status', text);
  $('#terminal-interrupt').disabled = !running;
  $('#terminal-close').disabled = !running;
}
function writeTerminal(data) {
  const session = terminalSession;
  if (!session || session.ended) return;
  // Preserve keystroke order and keep each paste within the server input bound.
  for (let start = 0; start < data.length; start += 4096) {
    const chunk = data.slice(start, start + 4096);
    terminalWriting = terminalWriting.then(() => api('terminal/input', {id:session.id, data:chunk})).catch(error => { terminalStatus(error.message); });
  }
}
function fitTerminal() {
  if (view !== 'terminal' || !terminal || !$('#terminal-container').clientHeight) return;
  terminalFit.fit();
}
async function openTerminal(restart = false) {
  if (terminalOpening) return terminalOpening;
  if (terminalStarted && !restart) { fitTerminal(); terminal?.focus(); return; }
  terminalOpening = (async () => {
    $('#terminal-start').disabled = true;
    terminalStatus(chatText('起動中…'));
    try {
      if (!terminal) {
        const [{Terminal}, {FitAddon}] = await Promise.all([import('/vendor/xterm.mjs'), import('/vendor/addon-fit.mjs')]);
        terminal = new Terminal({cursorBlink:true, fontFamily:'"Share Tech Mono", monospace', fontSize:14, scrollback:3000, screenReaderMode:true, theme:{background:'#090f17',foreground:'#c6e9e5',cursor:'#a5fff1',selectionBackground:'#416b7c80'}});
        terminalFit = new FitAddon(); terminal.loadAddon(terminalFit);
        terminal.open($('#terminal-container'));
        terminal.textarea.setAttribute('aria-label', chatText('ターミナル入力'));
        terminal.onData(writeTerminal);
        terminal.onResize(({cols,rows}) => {
          clearTimeout(terminalResizeTimer);
          terminalResizeTimer = setTimeout(() => { if (terminalSession && !terminalSession.ended) api('terminal/resize',{id:terminalSession.id,cols,rows}).catch(error => terminalStatus(error.message)); },120);
        });
        new ResizeObserver(fitTerminal).observe($('#terminal-container'));
      }
      if (restart) { await closeTerminal(); terminal.reset(); }
      await document.fonts.ready;
      fitTerminal();
      terminalSession = await api('terminal/start',{cols:terminal.cols,rows:terminal.rows});
      terminalStarted = true;
      const session = terminalSession;
      terminalStream = new EventSource('/api/terminal/events?id=' + encodeURIComponent(session.id));
      const stream = terminalStream;
      stream.addEventListener('open', () => terminalStatus(session.shell + ' · ' + session.cwd, true));
      stream.addEventListener('output', event => terminal.write(JSON.parse(event.data).data));
      stream.addEventListener('gap', () => terminal.writeln('\r\n[' + chatText('再接続前の古い出力を省略しました') + ']'));
      stream.addEventListener('exit', event => {
        const result = JSON.parse(event.data); session.ended = true; stream.close();
        terminal.writeln('\r\n[' + chatText('シェル終了: {code}', {code:result.exitCode}) + ']'); terminalStatus(chatText('終了 · 新しいシェルで再開できます'));
      });
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) { session.ended = true; terminalStatus(chatText('接続終了 · 新しいシェルで再開できます')); }
        else terminalStatus(chatText('ターミナルに再接続中…'));
      };
      terminalStatus(session.shell + ' · ' + session.cwd, true);
      terminal.focus();
    } catch (error) { terminalStatus(chatText('起動失敗: ') + error.message); throw error; }
    finally { $('#terminal-start').disabled = false; }
  })();
  try { await terminalOpening; } finally { terminalOpening = null; }
}
async function closeTerminal() {
  const session = terminalSession;
  terminalStream?.close(); terminalStream = null;
  terminalSession = null;
  clearTimeout(terminalResizeTimer);
  if (session) await api('terminal/close',{id:session.id});
  terminalStatus(chatText('終了 · 新しいシェルで再開できます'));
}
$('#terminal-start').onclick = () => openTerminal(true).catch(error => toast(error.message));
$('#terminal-interrupt').onclick = () => { writeTerminal('\u0003'); terminal?.focus(); };
$('#terminal-close').onclick = () => closeTerminal().catch(error => toast(error.message));
addEventListener('pagehide', () => {
  if (terminalSession) fetch('/api/terminal/close',{method:'POST',headers:{'Content-Type':'application/json','X-Chat-UI':'1'},body:JSON.stringify({id:terminalSession.id}),keepalive:true}).catch(() => {});
});
const active = chat => ['starting','running','stopping'].includes(chat?.status);
let pendingView = null, pendingViewFocus, viewTransitionTimer;
const viewTransition = $('#view-transition');
function applyView(next) {
  residentConversation.undock();
  if(next!=='chat')endResidentConversation();
  if(next==='backlog'&&!pluginView.enabled())next='settings';
  if(next==='teams'&&!pluginView.teamsEnabled())next='settings';
  view = next;
  document.body.dataset.view=next;
  $('#town-navigation').hidden=false;
  townSection(currentTownSection);
  if(next==='chat')$('#town-nav-chat').setAttribute('aria-current','page');else $('#town-nav-chat').removeAttribute('aria-current');
  for (const name of ['chat','terminal','usage','settings','equipment','tavern','castle','todos','image','backlog','teams','town','inbox','reports','schedules']) $('#' + name + '-view').hidden = name !== next;
  $$('button[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === next));
  const subtitles = {chat:'A2ACRAFT · TOPPY', terminal:'LOCAL TERMINAL', usage:'CODEX PLAN · ACCOUNT QUOTA', settings:'CHATGPT AUTH · LOCAL APP SERVER',equipment:'SKILL EQUIPMENT · ADVENTURER’S SHOP',tavern:'TAVERN · PARTY QUEST',castle:'CASTLE · QUEST REQUEST',todos:'TODO · PARTY QUEST',image:'IMAGE · ORIGINAL MEDIA',backlog:'EXTERNAL SERVICE · PLUGIN',teams:'TEAMS · REVIEWED REPLY',town:'ADVENTURER’S TOWN',inbox:'INBOX · LOCAL ACTIVITY',reports:'DAILY REPORT · SAVED RECORDS',schedules:'SCHEDULED TASKS · LOCAL REMINDERS'};
  setText('#page-subtitle', subtitles[next]);
  contextSharing.render();
  if (next === 'terminal') openTerminal().catch(error => toast(error.message));
  if (next === 'equipment') equipment.open();
  if (next === 'tavern') party.open();
  if (next === 'castle') party.open().then(()=>castle.open());
  if (next === 'todos') todoView.open();
  if (next === 'image') mediaView.open();
  if (['inbox','reports','schedules'].includes(next))activityView.open(next);
  mediaView.visible(next==='image');
  town.setView(next);
  village.setVisible(next==='town'&&currentTownSection==='town',{preserveEncounter:activeEncounter?.source==='village'&&next==='chat'});
  projects.setVisible(next==='town'&&currentTownSection==='projects',{preserveEncounter:activeEncounter?.source==='projects'&&next==='chat'});
  adventure.render();discoveries.render();
  workspaceTabs.render();
  if(next==='chat'&&activeEncounter)renderChats();
}
function finishViewTransition() {
  clearTimeout(viewTransitionTimer);
  viewTransition.hidden = true;
  if (!pendingView) return;
  const next = pendingView, onSwitch = pendingViewFocus;
  pendingView = null; pendingViewFocus = null;
  applyView(next);
  onSwitch?.();
}
function switchView(next, onSwitch) {
  if ($('#workspace').hidden) return;
  if(!townToolsOpen){
    const changed=next!==view;
    pendingView=next;pendingViewFocus=onSwitch;finishViewTransition();
    if(changed&&document.body.dataset.motion!=='reduced'&&!reducedMotion.matches){
      $('#'+view+'-view').animate([{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:160,easing:'ease-out'});
    }
    return;
  }
  if (next === view || document.body.dataset.motion === 'reduced' || reducedMotion.matches) {
    pendingView = next; pendingViewFocus = onSwitch;
    finishViewTransition();
    return;
  }
  const transitioning = pendingView !== null;
  pendingView = next; pendingViewFocus = onSwitch;
  if (transitioning) return;
  viewTransition.hidden = false;
  // Fall back if an animation is interrupted or its end event is not delivered.
  viewTransitionTimer = setTimeout(finishViewTransition, 650);
}
viewTransition.addEventListener('animationend', event => {
  if (event.target === viewTransition) finishViewTransition();
});
function buckets() {
  return state.limits?.rateLimitsByLimitId ? Object.values(state.limits.rateLimitsByLimitId) : state.limits?.rateLimits ? [state.limits.rateLimits] : [];
}
function windowLabel(window, fallback) {
  const minutes = window.windowDurationMins;
  if (!Number.isFinite(minutes)) return fallback;
  if (minutes >= 1440 && minutes % 1440 === 0) return chatText('{duration}日間の枠', {duration:minutes / 1440});
  if (minutes >= 60 && minutes % 60 === 0) return chatText('{duration}時間の枠', {duration:minutes / 60});
  return chatText('{duration}分間の枠', {duration:minutes});
}
function quotaHtml() {
  let output = '';
  for (const bucket of buckets()) for (const [index, window] of [bucket.primary, bucket.secondary].entries()) if (window) {
    const valid = Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100;
    const left = valid ? Math.round(100 - window.usedPercent) : null;
    const reset = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString(getLocale(), {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : chatText('未取得');
    output += `<div class="quota-window"><div class="quota-label"><span>${esc(windowLabel(window,index ? chatText('追加枠') : chatText('利用枠')))}</span><strong>${left === null ? '—' : left + '%'} <small>${chatText('残り')}</small></strong></div><div class="bar"><div class="fill ${left !== null && left <= 20 ? 'warn' : ''}" style="width:${left || 0}%"></div></div><div class="quota-reset">${esc(bucket.limitName || bucket.limitId || 'Codex')} · ${esc(chatText('{when} リセット', {when:reset}))}</div></div>`;
  }
  return output || `<div class="quota-window"><div class="quota-label"><span>${chatText('利用枠')}</span><strong>— <small>${chatText('未取得')}</small></strong></div><div class="bar"></div><div class="quota-reset">${chatText('接続後に実際の残量を表示します')}</div></div>`;
}
function updateState() {
  projects.render();
  if(!demo&&state.plugins)pluginView.hydrate(state.plugins);else pluginView.render();todoView.hydrate();mediaView.render();
  if(!demo){pluginView.teamsStatusChanged(state.teams);pluginView.teamsDraftsChanged(state.teamsDrafts);}
  updateConnectionScreen();
  town.render();
  village.render();
  workspaceTabs.render();
  $('#quota-windows').innerHTML = quotaHtml();
  $('#usage-detail').innerHTML = '<div class="quota-windows">' + quotaHtml() + '</div>';
  setText('#plan-caption', state.account?.type === 'chatgpt' ? (state.account.planType || 'ChatGPT').toUpperCase() + ' · ' + (demo ? 'SAMPLE' : 'CONNECTED') : chatText('ChatGPTログイン待ち'));
  $('#connection-dot').classList.toggle('mint', state.connected);
  setText('#connection-text', demo ? 'DEMO MODE' : state.connected ? 'APP SERVER ONLINE' : 'DISCONNECTED');
  setText('#quota-updated', state.updatedAt ? chatText('{when} 更新', {when:new Date(state.updatedAt).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}) : chatText('未取得'));
  const offline=offlineBrowsing&&!demo&&(!state.connected||state.account?.type!=='chatgpt');
  const policyReason=!state.policy?.ok?state.policy?.reason||'':'';
  // Only routine sign-in guidance becomes a chip. Unknown policy failures,
  // persistence failures and runtime errors must retain their full notice.
  const routineSignIn=['','Codexに接続してください。','ChatGPTアカウントでログインしてください。APIキー接続は利用できません。'].includes(policyReason);
  const blockingNotice=state.persistenceError||state.error||(!routineSignIn?policyReason:'');
  $('#chat-connect').hidden=!offline;
  $('#notice').dataset.kind=blockingNotice?'error':offline?'offline':'policy';
  setText('#notice',chatError(blockingNotice||(offline?chatText('Codexは未接続です。送信するにはCodexに接続してください。'):policyReason)));
  history.render();
  setText('#connect-btn', demo ? 'DEMO ONLINE' : state.connected ? (state.account?.type === 'chatgpt' ? 'CODEX ONLINE ✓' : chatText('ChatGPTでログイン ↗')) : chatText('Codexに接続 ↗'));
  setText('#auth-pill', state.account?.type === 'chatgpt' ? chatText('ChatGPT認証済み') : state.connected ? chatText('未ログイン') : chatText('未接続'));
  setText('#account-label', state.account?.type === 'chatgpt' ? (state.account.email || chatText('ChatGPTアカウント')) + ' · ' + (state.account.planType || '') : chatText('アカウント未接続'));
  $('#logout-btn').disabled = !state.account || chats.some(active);
  $('#login-btn').disabled = chats.some(active);
  const oldModel = $('#model').value, models = state.models || [];
  $('#model').innerHTML = models.length ? models.map(model => `<option value="${esc(model.model)}">${esc(model.displayName || model.model)}</option>`).join('') : `<option value="">${chatText('接続後にモデルを取得')}</option>`;
  if (models.some(model => model.model === oldModel)) $('#model').value = oldModel;
  else if (models.length) $('#model').value = (models.find(model => model.isDefault) || models[0]).model;
  updateEfforts();
  const url = loginUrl(), link = $('#login-link');
  link.hidden = true;
  if (url) { link.href = url; link.hidden = false; }
  updateComposer();
}
function updateEfforts() {
  const oldEffort = $('#effort').value, model = state.models.find(model => model.model === $('#model').value);
  const choices = model?.supportedReasoningEfforts || [{reasoningEffort:'medium'}];
  const names = {none:chatText('なし'), minimal:chatText('最小'), low:chatText('軽め'), medium:chatText('標準'), high:chatText('深め'), xhigh:chatText('最大')};
  $('#effort').innerHTML = choices.map(choice => `<option value="${esc(choice.reasoningEffort)}">${esc(names[choice.reasoningEffort] || choice.reasoningEffort)}</option>`).join('');
  $('#effort').value = choices.some(choice => choice.reasoningEffort === oldEffort) ? oldEffort : (model?.defaultReasoningEffort || choices[0]?.reasoningEffort || 'medium');
  if(practiceMode()&&!practiceEffortInitialized&&model){practiceEffortInitialized=true;if(choices.some(choice=>choice.reasoningEffort==='low'))$('#effort').value='low';}
}
function createPanel(chat) {
  const element = document.createElement('article');
  element.className = 'chat-panel';
  element.tabIndex = 0;
  element.dataset.select = chat.id;
  element.innerHTML = '<div class="panel-head"><div class="panel-name"><span class="panel-index"></span><span class="panel-title"></span></div><div class="panel-state"><span class="pane-spinner" aria-hidden="true" hidden></span><span class="status"></span><button class="context-share text-btn" >↗</button></div></div><div class="messages"></div><div class="panel-error" hidden></div><details class="panel-notice" hidden><summary class="panel-notice-title"></summary><p class="panel-notice-body"></p></details><div class="panel-foot"><span class="panel-model"></span><span class="context-count" hidden></span><span class="panel-count"></span></div>';
  element.querySelector('.messages').dataset.chat = chat.id;
  const result = {element, messages:new Map()};
  panels.set(chat.id, result);
  return result;
}
function streamingMessage(chat) {
  if (chat.status !== 'running') return null;
  let lastPrompt = -1, lastAssistant = -1;
  chat.messages.forEach((message, index) => { if (message.role === 'user' && !message.steer) lastPrompt = index; if (message.role === 'assistant') lastAssistant = index; });
  return lastAssistant > lastPrompt ? chat.messages[lastAssistant] : null;
}
function updatePanel(chat, index) {
  const panel = panels.get(chat.id) || createPanel(chat), element = panel.element;
  element.querySelector('.panel-head').title=chatText('別のペインへドラッグしてコンテキストを共有');
  const share=element.querySelector('.context-share');share.title=chatText('共有先を選択');share.setAttribute('aria-label',chatText('この会話のコンテキストを共有'));
  element.classList.toggle('selected', chat.id === selected);
  for (const status of ['running','starting','stopping']) element.classList.toggle('is-' + status, chat.status === status);
  element.setAttribute('aria-label', chatText('{title}を選択', {title:chat.title}));
  element.setAttribute('aria-busy', String(active(chat)));
  element.querySelector('.pane-spinner').hidden = !active(chat);
  element.querySelector('.panel-index').textContent = chatText('会話 {index}', {index:index + 1});
  element.querySelector('.panel-title').textContent = chat.title;
  const status = element.querySelector('.status');
  status.className = 'status' + (active(chat) ? ' running' : chat.id === selected ? ' selected-status' : '');
  status.textContent = (chat.id === selected ? chatText('選択中 · ') : '') + (chatText(statusLabels[chat.status] || chat.status));
  const error = element.querySelector('.panel-error');
  error.hidden = !chat.error; error.textContent = chatError(chat.error || '');
  const notice = element.querySelector('.panel-notice');
  notice.hidden = !chat.threadRecovery&&!chat.migration;
  notice.querySelector('summary').textContent = chat.migration ? chatText('移行した会話 · 元の作業環境は引き継ぎません') : chatText('保存した履歴から会話を再開しています');
  notice.querySelector('p').textContent = chat.migration ? (chat.migration.method==='local'?chatText('Codexから移行した会話です。送信すると元の履歴を複製して続けます。'):chatText('ファイルから移行した会話です。最初の送信で過去の本文を新しい会話に渡します。添付の実体・ツール結果は引き継ぎません。'))+chatText(' 作業場所はこのアプリ専用のフォルダです。元のプロジェクトは開きません。') : chat.threadRecovery ? chatText('履歴を引き継いだ新しい接続で続けています。元の会話は保持しています。') : '';
  element.querySelector('.panel-model').textContent = chat.model || chatText('モデル未選択');
  const list = element.querySelector('.messages');
  // A focusable region lets keyboard and assistive-technology users reach the
  // scrollable history. Imported transcripts must not become live announcements.
  list.tabIndex = 0;
  list.setAttribute('role', 'region');
  list.setAttribute('aria-label', chatText('{title}の会話履歴', {title:chat.title}));
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const current = streamingMessage(chat), ids = new Set();
  const residentView = activeEncounter?.conversationId === chat.id;
  let visibleCount = 0;
  for (const [index, message] of chat.messages.entries()) {
    const body = demo && message.demoMessage ? chatText(message.demoMessage) : residentView ? mapTranscriptText(message.text) : message.text;
    // Only omit records whose entire body was internal context. Keep blank
    // streaming placeholders and messages with attachments or equipped skills.
    if (residentView && !body && message.text?.trim() && !message.attachments?.length && !message.skills?.length) continue;
    const id = message.id || `${chat.id}:${index}:${message.role}`;
    ids.add(id);
    let node = panel.messages.get(id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'msg ' + (message.role === 'user' ? 'user' : 'assistant') + ' message-enter';
      node.dataset.message = id;
      node.innerHTML = '<div class="msg-label"><span></span><b></b></div><div class="message-attachments"></div><div class="msg-text"></div><span class="streaming-caret" aria-hidden="true" hidden></span>';
      panel.messages.set(id, node);
      list.append(node);
      node.addEventListener('animationend', () => node.classList.remove('message-enter'), {once:true});
    }
    node.querySelector('.msg-label b').textContent = message.role === 'user' ? (message.steer ? 'YOU · STEER' : 'YOU') + (message.contextIds?.length ? ' · CONTEXT ' + message.contextIds.length : '') : activeEncounter?.conversationId===chat.id ? activeEncounter.name+(demo?chatText(' · デモ'):' · Codex') : 'CODEX';
    const text = node.querySelector('.msg-text');
    renderMessageMarkdown(text, body, {openLink:desktop ? url=>desktop.openExternal(url) : undefined,onLinkError:error=>toast(error.message)});
    attachments.renderMessage(node.querySelector('.message-attachments'),message.attachments || []);
    equipment.renderMessage(node,message.skills||[]);
    let partyLabel=node.querySelector('.party-message-label');
    if(message.partyRole&&!partyLabel){partyLabel=document.createElement('div');partyLabel.className='party-message-label';node.querySelector('.msg-label').after(partyLabel);}
    if(partyLabel)partyLabel.textContent=message.partyRole?'PARTY · '+message.partyRole:'';
    let visitLabel=node.querySelector('.resident-message-context');
    if(message.residentContext&&!visitLabel){visitLabel=document.createElement('div');visitLabel.className='resident-message-context';node.querySelector('.msg-label').after(visitLabel);}
    if(visitLabel)visitLabel.textContent=message.residentContext?.companions?.length?chatText('同行：{party}',{party:message.residentContext.companions.map(member=>getLocale()==='en'?member.name+' ('+member.role+')':member.name+'（'+member.role+'）').join(getLocale()==='en'?', ':'・')}):chatText('ひとりで相談');
    node.querySelector('.streaming-caret').hidden = message !== current || Boolean(demo && chat.project);
    if(list.children[visibleCount]!==node)list.insertBefore(node,list.children[visibleCount]||null);
    visibleCount++;
  }
  for (const [id, node] of panel.messages) if (!ids.has(id)) { node.remove(); panel.messages.delete(id); }
  panel.visibleMessageCount = visibleCount;
  element.querySelector('.panel-count').textContent = (demo ? 'DEMO' : 'CODEX PLAN') + ' · ' + messageCount(visibleCount);
  if (visibleCount) list.querySelector('.empty')?.remove();
  else if (!list.querySelector('.empty')) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.innerHTML = '<div class="empty-icon" aria-hidden="true">＋</div><p></p><small></small>';
    list.prepend(empty);
  }
  const empty=list.querySelector('.empty');
  if(empty){empty.querySelector('p').textContent=chatText('この会話へ入力できます');empty.querySelector('small').textContent=chatText('下の入力欄から相談を始めましょう');}
  let progress = list.querySelector('.run-progress');
  if (active(chat)) {
    if (!progress) {
      progress = document.createElement('div'); progress.className = 'run-progress';
      progress.innerHTML = '<div class="typing-indicator" aria-hidden="true"><span class="typing-orbit"></span><span class="typing-dots"><i></i><i></i><i></i></span></div><span class="progress-label" role="status"></span>';
      list.append(progress);
    }
    const label = progress.querySelector('.progress-label');
    const progressText = chat.status === 'starting' ? chatText('実行を準備しています') : chat.status === 'stopping' ? chatText('停止を待っています') : chat.project ? chatText('作業を進めています') : chatText('応答を作成しています');
    if (label.textContent !== progressText) label.textContent = progressText;
    list.append(progress);
  } else progress?.remove();
  if (nearBottom) list.scrollTop = list.scrollHeight;
  equipment.renderPane(element,chat);
  party.renderPane(element,chat);
  renderAgentDelegation(element,chat,{sample:subagentSample});
  return element;
}
function queueConversationRender() {
  // Apply every incoming record immediately, but paint a burst of history
  // imports or streamed tokens together instead of rebuilding all screens.
  if (!conversationRenderTimer) conversationRenderTimer = setTimeout(() => {
    conversationRenderTimer = 0;
    renderChats();
  },16);
}
function renderChats() {
  clearTimeout(conversationRenderTimer); conversationRenderTimer = 0;
  if (!chats.some(chat => chat.id === selected)) selected = chats[0]?.id || null;
  if(activeEncounter&&activeEncounter.conversationId!==selected)endResidentConversation();
  equipment.render();
  setText('#count', chats.length === 1 ? chatText('1件の会話') : chatText('{count}件の会話', {count:chats.length}));
  const group=currentChatGroup(),groupChats=(group?.conversationIds||[]).map(id=>chats.find(chat=>chat.id===id)).filter(Boolean);
  const navigation = JSON.stringify([getLocale(),selected,group?.id,group?.conversationIds,chats.map(chat => [chat.id,chat.title,active(chat)])]);
  if (navigation !== renderedNavigation) {
    const focusedChat = document.activeElement?.matches('.conversation-link,.chat-tab') ? {id:document.activeElement.dataset.select,tab:document.activeElement.matches('.chat-tab')} : null;
    $('#mobile-chat').innerHTML = groupChats.map(chat => `<option value="${esc(chat.id)}">${esc(chat.title)}</option>`).join('');
    $('#mobile-chat').value = selected;
    $('#conversation-list').innerHTML = chats.map((chat,index) => `<button class="conversation-link ${chat.id === selected ? 'selected' : ''}" data-select="${esc(chat.id)}"><small>${String(index + 1).padStart(2,'0')}</small>${esc(chat.title)}${active(chat) ? `<span class="conversation-running" aria-label="${chatText('実行中')}"></span>` : ''}</button>`).join('');
    if ($('#chat-tabs')) $('#chat-tabs').innerHTML = groupChats.map((chat,index) => `<button class="chat-tab ${chat.id === selected ? 'selected' : ''} ${active(chat) ? 'running' : ''}" data-select="${esc(chat.id)}" aria-pressed="${chat.id === selected}"><strong class="tab-name">${esc(chat.title)}</strong><span class="tab-index">${chatText('会話 {index}', {index:index + 1})}</span><small class="tab-state">${chat.id === selected ? 'Active' : active(chat) ? 'Running' : 'Waiting'}</small></button>`).join('');
    renderedNavigation = navigation;
    if (focusedChat) $((focusedChat.tab ? '.chat-tab' : '.conversation-link') + '[data-select="' + CSS.escape(focusedChat.id) + '"]')?.focus({preventScroll:true});
  }
  // Show only the person being addressed beside the map. Expanding the
  // conversation restores the workspace layout without changing its setting.
  const paneLayout=activeEncounter&&view==='town'?1:layout;
  const selectedIndex = Math.max(0,groupChats.findIndex(chat => chat.id === selected)), count = paneLayout === 1 ? 1 : paneLayout === 2 ? 2 : 4;
  const start = Math.floor(selectedIndex / count) * count, shown = groupChats.slice(start,start + count), grid = $('#grid');
  for (const value of [1,2,4]) grid.classList.toggle('layout-' + value, paneLayout === value);
  $('#chat-view').classList.toggle('multi-chat',paneLayout>1);
  for (const child of [...grid.children]) if (!shown.some(chat => chat.id === child.dataset.select)) child.remove();
  shown.forEach((chat,index) => {
    const panel=updatePanel(chat,chats.indexOf(chat));
    if(grid.children[index]!==panel)grid.insertBefore(panel,grid.children[index]||null);
  });
  for (const id of panels.keys()) if (!chats.some(chat => chat.id === id)) panels.delete(id);
  $$('[data-layout]').forEach(button => { const on = +button.dataset.layout === layout; button.classList.toggle('selected',on); button.setAttribute('aria-pressed',on); });
  updateComposer(); persist(); contextSharing.render();workspaceTabs.render();town.render();history.render();village.render();
}
function updateHud() {
  setText('#town-connection-status',demo?chatText('デモ'):serverUnavailable?chatText('再接続が必要です'):state.connected&&state.account?.type==='chatgpt'?chatText('Codex 接続済み'):chatText('Codex 未接続'));
  const running = chats.find(active), chat = chats.find(chat => chat.id === selected);
  setText('#hud-active', running ? '1' : '0');
  setText('#hud-model', $('#model').selectedOptions[0]?.textContent || 'MODEL PENDING');
  setText('#hud-effort', $('#effort').value.toUpperCase());
  setText('#mission-title', running?.title || chat?.title || chatText('会話未選択'));
  setText('#mission-state', running ? (chatText(statusLabels[running.status] || running.status)).toUpperCase() : chatText('READY · 入力待ち'));
  activityView.render();
  setText('#service-codex', demo ? 'CODEX DEMO' : state.connected ? 'CODEX ONLINE' : 'CODEX OFFLINE');
  setText('#service-runtime', desktop ? desktopName.toUpperCase() + ' · LOCAL' : 'BROWSER · LOCAL');
  document.body.classList.toggle('has-running-task', Boolean(running));
}
function normalSendUnavailable(chat,steering){
  return $('#workspace').hidden || (!demo&&(!state.connected||state.account?.type!=='chatgpt'||state.login||serverUnavailable)) || Boolean(state.workQuestPlanning) || boardActive() || partyActive() || !chat || steerPending || pendingSends.has(chat.id) || conversationModeRequests.has(chat.id) || !state.policy?.ok || (chats.some(active) && !steering) || !$('#model').value;
}
function teamSendStatus(id){
  const chat=chats.find(item=>item.id===id);
  if(!chat)return {reason:chatText('会話を開けません。')};
  if(chat.project)return {reason:chatText('この会話は作業の記録です。')};
  if(chat.workMode==='work')return {reason:chatText('作業モードの会話です。送信は会話画面で確認してください。')};
  if(!demo&&(!state.connected||state.account?.type!=='chatgpt'||state.login||serverUnavailable))return {reason:chatText('送信するにはCodexに接続してください。')};
  if(attachments.get(id).length||attachments.busy(id))return {reason:chatText('準備中の添付を会話画面で確認してください。')};
  if(!state.policy?.ok){
    const quota=state.policy?.quota, reason=chatError(state.policy?.reason)||chatText('現在は送信できません。');
    if(!quota)return {reason};
    const bucket=buckets()[quota.bucketIndex], window=bucket?.[quota.slot];
    if(!window)return {reason,refreshQuota:true};
    const name=windowLabel(window,quota.slot==='secondary'?chatText('追加枠'):chatText('利用枠'));
    const remaining=new Intl.NumberFormat(getLocale(),{maximumFractionDigits:1}).format(100-window.usedPercent);
    const reset=new Date(window.resetsAt*1000);
    const next=Number.isFinite(window.resetsAt)&&reset.getTime()>Date.now()
      ? chatText('（{when} リセット予定）', {when:reset.toLocaleString(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}):'';
    return {reason:reason+' '+(bucket.limitName||bucket.limitId||'Codex')+' · '+name+' '+chatText('残り{left}%', {left:remaining})+next,refreshQuota:true};
  }
  if(normalSendUnavailable(chat,false)||connectionReadiness?.busy||state.projects?.activeCount)return {reason:chatText('現在は送信できません。')};
  return {reason:''};
}
function sendTeamChatMessage(id,mapSquadId){
  if(typeof mapSquadId!=='string'||!mapSquadId)return;
  const chat=chats.find(item=>item.id===id),text=(drafts[id]||'').trim();
  if(!text||teamSendStatus(id).reason)return;
  return sendConversationTurn(chat,text,{mapSquadId});
}
function updateComposer() {
  const chat = chats.find(chat => chat.id === selected), steering = !chat?.project&&chat?.status === 'running';
  updateConversationMode(chat);
  const project=state.projects?.items.find(p=>p.id===chat?.project?.id),question=project?.events.find(e=>e.conversationId===chat?.id&&e.kind!=='progress'&&e.status==='open');
  // A project asks for input only when it actually has an open question.
  // Normal chat keeps its composer; autonomous work shows its record instead.
  $('#composer').hidden=Boolean(chat?.project&&!question);
  projects.chatContext(chat,option=>{$('#prompt').value=option;drafts[selected]=option;updateComposer();$('#prompt').focus();});
  // Questions are part of the transcript, so even a long set of choices cannot
  // take height away from the conversation and composer as separate panels.
  const transcript=panels.get(selected)?.element.querySelector('.messages'),questionCard=projectChatContext;
  if(transcript&&questionCard&&questionCard!==transcript.lastElementChild){
    const atBottom=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<60;
    transcript.append(questionCard);if(atBottom)transcript.scrollTop=transcript.scrollHeight;
  }
  if(activeEncounter?.conversationId===selected){
    try{residentConversation.updateCompanions(companionRoster(currentResidentParty(),chats,selected));}
    catch(error){residentConversation.updateCompanions([],error.message);}
  }
  setText('#target', activeEncounter?.name || (chat ? chat.title : chatText('会話を作成してください')));
  setText('#chat-heading',activeEncounter?.name || chat?.characterName || chat?.title || chatText('会話'));
  const topic=(activeEncounter?.name||chat?.characterName)&&chat?.title!==$('#chat-heading').textContent?chat?.title:'';
  setText('#chat-topic',topic||'');$('#chat-topic').hidden=!topic;$('#chat-topic').title=topic||'';
  setText('#chat-status',demo?chatText('デモ'):chat?(chatText(statusLabels[chat.status]||chat.status)):'');
  setText('#chat-information',chat?(chat.model||chatText('モデル未選択'))+' · '+messageCount(panels.get(chat.id)?.visibleMessageCount??chat.messages.length)+' · '+chatText('会話ごとに下書きを保存'):chatText('履歴を選ぶか、新しい会話を作成してください。'));
  $('#chat-share').disabled=!chat;
  const files=attachments.get(selected),model=state.models.find(item=>item.model===(steering?chat?.model:$('#model').value));
  const unsupportedImage=files.some(file=>file.kind==='image')&&Array.isArray(model?.inputModalities)&&!model.inputModalities.includes('image');
  sendBlocked = normalSendUnavailable(chat,steering) || (!$('#prompt').value.trim() && !files.length) || attachments.busy(selected) || unsupportedImage;
  if(chat?.project)sendBlocked=demo||!question||serverUnavailable||$('#workspace').hidden||steerPending||!$('#prompt').value.trim()||files.length>0;
  else if(state.projects?.activeCount)sendBlocked=true;
  if(connectionReadiness?.busy)sendBlocked=true;
  attachments.render();
  $('#send-btn').setAttribute('aria-disabled', String(sendBlocked));
  $('#send-btn').innerHTML = steering ? chatText('追加') + ' <span>↗</span>' : chatText('送信') + ' <span>↑</span>';
  $('#send-btn').setAttribute('aria-label',steering?chatText('実行中の会話に指示を追加'):chatText('メッセージを送信'));
  setText('#send-hint', state.workQuestPlanning?chatText('お城でクエストを分解中です'):boardActive()?chatText('掲示板の仲間が集合・処理中です'):partyActive()?chatText('PARTY QUEST · 酒場でクエストを停止できます'):unsupportedImage?chatText('画像対応モデルを選択してください'):attachments.busy(selected)?chatText('添付の準備完了を待つか、エラーの添付を削除してください'):steering ? chatText('STEER · 実行中の会話へ指示を追加') : chatText('Enter 送信 · Shift+Enter 改行'));
  if(chat?.project){setText('#send-hint',demo?question?chatText('会話内の選択肢から回答を選んでください'):chatText('作業の記録'):question?chatText('回答を送信すると、条件を確認して自動で再開します'):chatText('作業の記録です。必要な判断があるときだけ確認します'));$('#send-btn').textContent=chatText('回答 ↑');$('#send-btn').setAttribute('aria-label',chatText('相談への回答を送信'));}
  $('#prompt').placeholder = steering ? chatText('追加の指示…') : chatText('メッセージを入力…');
  $('#prompt').readOnly = Boolean(chat?.project && (demo || !question));
  if ($('#prompt').readOnly) $('#prompt').placeholder = demo ? question?chatText('回答を選ぶ'):chatText('作業の記録') : chatText('相談が届くと回答できます');
  $('#prompt').title=$('#send-hint').textContent;
  $('#stop-btn').hidden = !active(chat);
  $('#stop-btn').disabled = chat?.status !== 'running';
  setText('#stop-btn', chat?.status === 'stopping' ? chatText('停止待ち') : chatText('停止'));
  $('#stop-btn').setAttribute('aria-label',chat?.status === 'stopping'?chatText('停止要求中'):chatText('この会話を停止'));
  $('#model').disabled = Boolean(state.workQuestPlanning)||boardActive()||partyActive()||chats.some(active); $('#effort').disabled = Boolean(state.workQuestPlanning)||boardActive()||partyActive()||chats.some(active);
  $('#logout-btn').disabled = !state.account || connectionBusy || Boolean(connectionReadiness?.busy) || Boolean(state.workQuestPlanning)||boardActive()||partyActive()||chats.some(active);
  $('#login-btn').disabled = connectionBusy || Boolean(connectionReadiness?.busy) || Boolean(state.workQuestPlanning)||boardActive()||partyActive()||chats.some(active);
  connectionReadiness?.render();
  party.render();castle.render();for(const chat of chats){const panel=panels.get(chat.id);if(panel)party.renderPane(panel.element,chat);}
  todoView.render();
  adventure.render();discoveries.render();updateAdventureReturn();
  updateHud();
}
function select(id,nextView='chat',onSwitch) {
  if(activeEncounter&&activeEncounter.conversationId!==id)endResidentConversation();
  if (selected === id && view === nextView && !pendingView) {onSwitch?.();return;}
  if (selected) { drafts[selected] = $('#prompt').value; const group=currentChatGroup();if(group)groupSelections.set(group.id,selected); }
  selected = id; $('#prompt').value = drafts[id] || '';
  switchView(nextView,onSwitch); renderChats();
}
async function addChat() {
  if (demo) { const [chat]=nameDemoChats([{id:crypto.randomUUID(),title:`Prompt ${chats.length + 1}`,status:'idle',messages:[]}]); chats.push(chat); select(chat.id); return; }
  try { const chat = await api('conversations',{locale:getLocale()}); if (!chats.some(item => item.id === chat.id)) chats.push(chat); select(chat.id); } catch (error) { toast(error.message); }
}
async function connect(login = false) {
  if (demo) return toast(chatText('デモ表示です。実接続モードでログインできます。'));
  if (booting || connectionBusy || connectionReadiness?.busy) return;
  connectionReadiness?.reset();
  offlineBrowsing=false;
  connectionRequested = true; connectionBusy = true; connectionError = ''; updateState();
  try {
    // Re-read account state on every retry, including when the app-server is still alive.
    state = await api('connect'); serverUnavailable = false; subscribeEvents(); updateState();
    if (login || state.account?.type !== 'chatgpt' || state.login) {
      const pendingLogin = await api('login');
      // A completion notification can arrive before the HTTP response.
      if (!state.login && !state.error && state.account?.type !== 'chatgpt') state.login = pendingLogin;
    }
  } catch (error) { connectionError = error.displayReason || error.message; }
  finally { connectionBusy = false; updateState(); }
}
function applyMotion() {
  const reduced = motionPreference === 'reduced' || (motionPreference === 'system' && reducedMotion.matches);
  document.body.dataset.motion = reduced ? 'reduced' : 'full';
  window.dispatchEvent(new Event('chat-ui-motion'));
  if (reduced || reducedMotion.matches) finishViewTransition();
  if (reduced) document.getAnimations().filter(animation=>animation.effect?.target?.getRootNode()===document).forEach(animation => animation.cancel());
  contextSharing.render();
  const button = $('#motion-toggle');
  if (button) { button.setAttribute('aria-pressed', !reduced); button.title = reduced ? chatText('アニメーションを有効にする') : chatText('アニメーションを減らす'); button.querySelector('[data-motion-label]')?.replaceChildren(document.createTextNode(reduced ? 'MOTION OFF' : 'MOTION ON')); }
}
reducedMotion.addEventListener('change', applyMotion);
$('#motion-toggle')?.addEventListener('click', () => { motionPreference = document.body.dataset.motion === 'full' ? 'reduced' : 'full'; try { localStorage.setItem('chat-ui-motion',motionPreference); } catch {} applyMotion(); persist(); });
$('#sidebar-toggle')?.addEventListener('click', () => { const collapsed = document.body.classList.toggle('sidebar-collapsed'); $('#sidebar-toggle').setAttribute('aria-expanded', !collapsed); });
$$('[data-window-action]').forEach(button => { button.hidden = !desktop; button.onclick = () => { const actions = {minimize:'minimize',maximize:'toggleMaximize',close:'close'}; desktop?.[actions[button.dataset.windowAction]]?.(); }; });
async function updateDesktopSettings() {
  if (!desktop) return;
  const container = $('#desktop-settings'); if (container) container.hidden = false;
  setText('#desktop-version', desktopName + ' ' + desktop.version);
  setText('#desktop-runtime', desktopName.toUpperCase() + ' RUNTIME');
  const settings = await desktop.getSettings();
  setText('#codex-path', settings.codexPath || chatText('アプリに同梱したCodex'));
  setText('#work-directory', settings.workDirectory || chatText('アプリ専用の作業フォルダ'));
  if($('#work-directory-input'))$('#work-directory-input').value=settings.workDirectory||'';
  setText('#desktop-settings-status',settings.restartRequired?chatText('保存しました。アプリを終了して開き直すと反映されます。'):'');
}
$('#select-codex-path')?.addEventListener('click', async () => { try { await desktop.selectCodexPath(); await updateDesktopSettings(); } catch (error) { toast(error.message); } });
$('#reset-codex-path')?.addEventListener('click', async () => { try { await desktop.resetCodexPath(); await updateDesktopSettings(); } catch (error) { toast(error.message); } });
$('#select-work-directory')?.addEventListener('click', async () => { try { await desktop.selectWorkDirectory(); await updateDesktopSettings(); } catch (error) { setText('#desktop-settings-status',error.message); } });
$('#save-work-directory')?.addEventListener('click', async () => { try { await desktop.setWorkDirectory($('#work-directory-input').value.trim()); await updateDesktopSettings(); } catch (error) { setText('#desktop-settings-status',error.message); } });
if (desktop) {
  document.body.classList.add('desktop-app', ...(desktop.isTauri ? ['tauri-app','is-tauri'] : ['electron-app','is-electron']));
  document.body.dataset.platform = desktop.platform;
  for (const link of [$('#login-link'),$('#connect-login-link')]) link.addEventListener('click', async event => {
    event.preventDefault();
    try { await desktop.openExternal(event.currentTarget.href); }
    catch (error) { connectionError = error.displayReason || error.message; updateState(); }
  });
  desktop.onWindowState?.(windowState => { document.body.classList.toggle('window-maximized',windowState.maximized); for (const button of $$('[data-window-action="maximize"]')) { button.title = windowState.maximized ? chatText('元のサイズに戻す') : chatText('最大化'); button.setAttribute('aria-label',button.title); } });
  updateDesktopSettings().catch(error => toast(error.message));
}
function updateClock() { setText('#hud-clock', new Date().toLocaleTimeString('en-GB',{hour12:false})); }
updateClock(); setInterval(updateClock,1000); applyMotion();
const workspaceMenu=$('#workspace-menu');
$$('button[data-view]').forEach(button => button.onclick = () => {if(workspaceMenu.open)workspaceMenu.close();switchView(button.dataset.view);});
$('#settings-shortcut').onclick = () => switchView('settings');
$('#adventure-home').onclick=()=>switchView('town',()=>{townSection('adventure');adventure.focusCurrent();});
$('#adventure-town-nav').onclick=()=>switchView('town',()=>$('#adventure-town-access').click());
$('#adventure-town-access').addEventListener('click',()=>townSection('town'));
$('#town-facilities').addEventListener('toggle',()=>town.render());
$('#town-tools-toggle').onclick=()=>{workspaceMenu.showModal();$('#town-tools-toggle').setAttribute('aria-expanded','true');};
$('#chat-navigation').onclick=()=>{workspaceMenu.showModal();$('#chat-navigation').setAttribute('aria-expanded','true');};
$('#chat-connect').onclick=()=>switchView('settings');
$('#workspace-menu-close').onclick=()=>workspaceMenu.close();
$('#workspace-menu-party-map').onclick=()=>{workspaceMenu.close();openPartyMap();};
$('#workspace-menu-village-preview').onclick=()=>location.assign('/?demo=1&village=sample');
workspaceMenu.addEventListener('close',()=>{for(const id of ['town-tools-toggle','chat-navigation'])$('#'+id).setAttribute('aria-expanded','false');});
$('#workspace-menu-open-history').addEventListener('click',()=>workspaceMenu.close(),{capture:true});
$('#workbench-toggle').onclick=()=>{
  workspaceMenu.close();
  townToolsOpen=!townToolsOpen;
  document.body.dataset.townTools=townToolsOpen?'open':'closed';
  if(townToolsOpen){townSidebarWasCollapsed=document.body.classList.contains('sidebar-collapsed');document.body.classList.remove('sidebar-collapsed');}
  else if(townSidebarWasCollapsed)document.body.classList.add('sidebar-collapsed');
  $('#workbench-toggle').setAttribute('aria-pressed',String(townToolsOpen));
  $('#workbench-toggle').textContent=townToolsOpen?chatText('シンプルな画面に戻す'):chatText('詳細な作業デスクを表示');
  $('#sidebar-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-collapsed')));
};
$('#party-world-return').onclick=()=>switchView('town',()=>{townSection('adventure');adventure.focusCurrent();});
function openOfflineWorkspace() {
  if (booting || connectionBusy) return;
  offlineBrowsing=true;updateState();
  const chat=chats.find(chat=>chat.id===selected);
  if(chat&&(drafts[chat.id]||chat.messages?.length))select(chat.id,'chat',()=>$('#prompt').focus());
  else switchView('town',()=>{townSection('town');village.focus();});
}
$('#open-offline').onclick = openOfflineWorkspace;
$('#connect-settings').onclick = () => {
  offlineBrowsing=true;updateState();
  switchView('settings',()=>$('#settings-connect-btn').focus());
};
connectionReadiness=initConnectionReadiness({api,getState:()=>({...state,connected:state.connected&&!serverUnavailable}),demo,onConnect:()=>connect(),
  isBlocked:()=>booting||connectionBusy||Boolean(state.login)||Boolean(state.workQuestPlanning)||boardActive()||partyActive()||Boolean(state.projects?.activeCount)||chats.some(active),
  onBusyChange:busy=>{for(const id of ['select-codex-path','reset-codex-path','select-work-directory','save-work-directory'])$('#'+id).disabled=busy;updateComposer();}});
$('#start-connect').onclick = () => connect(); $('#connect-btn').onclick = () => connect(); $('#login-btn').onclick = () => connect(true);
$('#logout-btn').onclick = async () => { if (demo) return toast(chatText('デモアカウントです。')); try { await api('logout'); } catch (error) { toast(error.message); } };
async function refreshUsage() { if (demo) { state.updatedAt = Date.now(); updateState(); return toast(chatText('デモの残量表示を更新しました。')); } try { state = await api('refresh'); updateState(); } catch (error) { toast(error.message); } }
$('#refresh-btn').onclick = refreshUsage;
$('#mobile-chat').onchange = () => {select($('#mobile-chat').value);$('#chat-actions').open=false;$('#prompt').focus();};
$('#add-side').onclick = addChat; $('#add-chat').onclick = addChat;
$('#chat-share').onclick=()=>panels.get(selected)?.element.querySelector('.context-share')?.click();
const chatDisclosures=$$('.chat-disclosure');
for(const disclosure of chatDisclosures){
  disclosure.addEventListener('toggle',()=>{if(disclosure.open)for(const other of chatDisclosures)if(other!==disclosure)other.open=false;});
  disclosure.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&disclosure.open){event.preventDefault();event.stopPropagation();disclosure.open=false;disclosure.querySelector('summary').focus();}
  });
  disclosure.addEventListener('click',event=>{if(event.target.closest('button'))disclosure.open=false;});
}
document.addEventListener('pointerdown',event=>{for(const disclosure of chatDisclosures)if(disclosure.open&&!disclosure.contains(event.target))disclosure.open=false;});
document.addEventListener('click', event => {
  const target=event.target.closest('[data-select]');if(!target)return;
  const control=event.target.closest('a,button,input,textarea,select,summary,details,label,[role="button"],[contenteditable]:not([contenteditable="false"])');
  // A transcript control owns its action. Only the conversation selector itself
  // (including a tab's nested text) should also select a chat.
  if(control&&control!==target)return;
  if(view==='town'&&activeEncounter&&target.classList.contains('chat-panel'))return;
  select(target.dataset.select);
});
document.addEventListener('keydown', event => { if (event.target.matches('.chat-panel') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if(view!=='town'||!activeEncounter)select(event.target.dataset.select); } });
$$('[data-layout]').forEach(button => button.onclick = () => {
  if (layout === +button.dataset.layout) return;
  const before = new Map($$('.chat-panel').map(panel => [panel.dataset.select,panel.getBoundingClientRect()]));
  layout = +button.dataset.layout; $('#grid').classList.add('is-layout-changing'); renderChats();
  if (document.body.dataset.motion !== 'reduced') for (const panel of $$('.chat-panel')) {
    const old = before.get(panel.dataset.select), next = panel.getBoundingClientRect();
    if (old && next.width && next.height) panel.animate([
      {transformOrigin:'top left',transform:`translate(${old.x - next.x}px,${old.y - next.y}px) scale(${old.width / next.width},${old.height / next.height})`},
      {transformOrigin:'top left',transform:'none'}
    ],{duration:380,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
  clearTimeout(renderChats.layoutTimer);
  renderChats.layoutTimer = setTimeout(() => $('#grid').classList.remove('is-layout-changing'),400);
});
let pointerFrame;
$('#grid').addEventListener('pointermove',event => {
  if (event.pointerType === 'touch' || document.body.dataset.motion === 'reduced') return;
  const panel = event.target.closest('.chat-panel'); if (!panel) return;
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(() => {
    const rectangle = panel.getBoundingClientRect();
    panel.style.setProperty('--pointer-x',((event.clientX - rectangle.x) / rectangle.width * 100).toFixed(1) + '%');
    panel.style.setProperty('--pointer-y',((event.clientY - rectangle.y) / rectangle.height * 100).toFixed(1) + '%');
  });
});
$$('[data-prompt]').forEach(button => button.onclick = () => { switchView('chat', () => $('#prompt').focus()); $('#prompt').value = button.dataset.prompt; if (selected) drafts[selected] = $('#prompt').value; persist(); updateComposer(); });
$('#prompt').oninput = () => { if (selected) drafts[selected] = $('#prompt').value; persist(); updateComposer(); };
$('#model').onchange = () => { updateEfforts(); updateComposer(); }; $('#effort').onchange = updateComposer;
function updateConversationMode(chat) {
  const request=conversationModeRequests.get(selected),control=$('#conversation-mode');
  control.value=request?.pending?request.mode:chat?.workMode==='work'?'work':'chat';
  control.disabled=demo||!chat||Boolean(chat.project)||active(chat)||pendingSends.has(selected)||Boolean(request?.pending)||serverUnavailable;
  setText('#conversation-mode-note',chat?.project?chatText('この作業の範囲は依頼時の設定に従います。'):control.value==='work'?chatText('この会話の専用フォルダにファイルを作成・編集します。'):chatText('相談ではファイルを変更しません。'));
  setText('#conversation-mode-error',request?.error||'');$('#conversation-mode-error').hidden=!request?.error;
  const retry=$('#conversation-mode-retry');retry.hidden=!request?.error;retry.disabled=control.disabled;
}
async function changeConversationMode(mode) {
  const id=selected,chat=chats.find(chat=>chat.id===id),previous=conversationModeRequests.get(id);
  if(demo||!chat||chat.project||active(chat)||pendingSends.has(id)||previous?.pending||serverUnavailable||!['chat','work'].includes(mode))return updateComposer();
  if(!previous&&mode===(chat.workMode==='work'?'work':'chat'))return;
  const request={mode,pending:true,error:''};conversationModeRequests.set(id,request);updateComposer();
  try {
    const saved=await api('conversation-mode',{id,mode});
    if(saved?.id!==id||(saved.workMode==='work'?'work':'chat')!==mode)throw Error(chatText('実行範囲の保存を確認できませんでした。'));
    const current=chats.find(chat=>chat.id===id);if(current)current.workMode=mode;
    conversationModeRequests.delete(id);
  } catch(error) {
    request.pending=false;request.error=chatText('実行範囲を保存できませんでした。送信前に再試行してください。 ')+error.message;
  } finally {updateComposer();}
}
$('#conversation-mode').onchange=()=>changeConversationMode($('#conversation-mode').value);
$('#conversation-mode-retry').onclick=()=>{const request=conversationModeRequests.get(selected);if(request)changeConversationMode(request.mode);};
$('#prompt').onkeydown = event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); $('#send-btn').focus(); }
  else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!sendBlocked) $('#composer').requestSubmit(); }
};
function cancelDemoTimers() { clearTimeout(demoDelay); clearInterval(demoStream); }
function startDemoResponse(chat,residentContext=null,fromMap=false) {
  const resident=fromMap||Boolean(residentContext?.metadata);
  const lastText=chat.messages.filter(m=>m.role==='user').at(-1)?.text||'';
  demoDelay = setTimeout(() => {
    const response = {id:crypto.randomUUID(),role:'assistant',text:''}; chat.messages.push(response);
    const reply = resident ? residentDemoReply(chat,lastText,residentContext?.metadata) : chatText('これは画面確認用の応答です。\n実接続ではChatGPT認証済みのCodex App Serverが応答します。\n\n会話・下書きは各ペインで独立しています。実行中はSteerで補足を追加し、停止ボタンで処理を中断できます。');
    const speaker=(chat.characterName||chatText('街の人'))+'：';
    const output=fromMap&&reply.startsWith(speaker)?reply.slice(speaker.length):reply;
    let cursor = 0;
    demoStream = setInterval(() => { cursor += 7; response.text = output.slice(0,cursor); if (cursor >= output.length) { clearInterval(demoStream); chat.status = 'completed'; } renderChats(); },70);
  },900);
}
$('#composer').onsubmit = async event => {
  event.preventDefault(); if (sendBlocked||pendingSends.has(selected)) return;
  const projectChat=chats.find(chat=>chat.id===selected);
  if(projectChat?.project){
    const project=state.projects.items.find(p=>p.id===projectChat.project.id),question=project.events.find(e=>e.conversationId===selected&&e.kind!=='progress'&&e.status==='open');if(!question)return;
    const submittedDraft=$('#prompt').value,text=submittedDraft.trim(),id=selected,deliveryKey=storeKey+'-project-answer-'+question.id;let delivery;
    try{delivery=JSON.parse(localStorage.getItem(deliveryKey));}catch{}if(delivery?.text!==text)delivery={text,requestId:crypto.randomUUID()};try{localStorage.setItem(deliveryKey,JSON.stringify(delivery));}catch{}
    steerPending=true;updateComposer();
    try{
      state.projects=await api('projects/answer',{id:project.id,eventId:question.id,...delivery});
      // A reply may finish after the user has begun another draft or selected
      // another conversation. Only consume the text this request submitted.
      if(drafts[id]===submittedDraft)drafts[id]='';
      if(selected===id&&$('#prompt').value===submittedDraft)$('#prompt').value='';
      try{localStorage.removeItem(deliveryKey);}catch{}
      persist();projects.render();
    }
    catch(error){toast(error.message);}finally{steerPending=false;updateComposer();}return;
  }
  return sendConversationTurn(projectChat,$('#prompt').value.trim());
};
async function sendConversationTurn(chat,text,{mapSquadId}={}) {
  const fromMap=mapSquadId!==undefined;
  const id=chat.id,isSteer=!fromMap&&chat.status==='running',expectedTurnId=chat.turnId;
  let residentVisit;
  try{if(!fromMap)residentVisit=residentVisitForChat(id);}catch(error){toast(error.message);return;}
  const model=$('#model').value,effort=$('#effort').value,previousStatus=chat.status,files=fromMap?[]:attachments.take(id);
  const mapContext=fromMap?{mapSquadId}:residentVisit?{residentVisit}:{};
  const requestId=demo?null:requestForSend(sendRequests,id,{...mapContext,text,model,effort,attachmentIds:files.map(file=>file.id),kind:isSteer?'steer':'send',expectedTurnId:isSteer?expectedTurnId:null});
  let dispatched=false;pendingSends.add(id);
  drafts[id] = ''; if(selected===id)$('#prompt').value=''; persist(); chat.error = null;
  if (!isSteer) chat.status = 'starting'; else steerPending = true;
  renderChats();scrollChatLatest(id);
  try {
    if (demo) {
      if(files.length)await api('attachments/demo-send',{conversationId:id,attachmentIds:files.map(file=>file.id)});
      const pending = contextBoard.filter(entry => entry.targetId === id && entry.status === 'pending');
      const residentContext=buildResidentContext({visit:residentVisit,conversation:chat,conversations:chats,party:currentResidentParty(),getVillageState:villageState});
      chat.messages.push({id:crypto.randomUUID(),role:'user',text,...(residentContext.metadata?{residentContext:residentContext.metadata}:{}),skills:equipment.demoTurn(chat),attachments:files,steer:isSteer,contextIds:pending.map(entry => entry.id)});
      for (const entry of pending) entry.status = 'attached';
      if (!isSteer) { chat.status = 'running'; chat.turnId = crypto.randomUUID(); startDemoResponse(chat,residentContext,fromMap); }
      renderChats();return;
    }
    // Keep the retry identity durable before dispatching a desktop request.
    await desktopDrafts?.flush();
    dispatched=true;
    await api(isSteer ? 'steer' : 'send',{id,text,...mapContext,attachmentIds:files.map(file=>file.id),expectedTurnId:isSteer?expectedTurnId:null,model,effort,requestId});
    delete sendRequests[id];persist();
  } catch (error) {
    let accepted=false;
    if(demo||!dispatched)chat.status=previousStatus;
    else try {
      const response=await fetch('/api/state');
      if(!response.ok)throw Error(chatText('状態を取得できません。'));
      const result=await response.json();chats=result.conversations || [];state=result;
      // Both text-only and attached messages carry a durable retry identity.
      accepted=sendWasAccepted(chats,id,requestId,files);
    } catch { state.policy={ok:false,reason:chatText('サーバーへの接続を確認してください。')}; }
    if(accepted)delete sendRequests[id];
    if(!accepted){
      attachments.restore(id,files);
      drafts[id]=restoreSendDraft(sendRequests,id,text,drafts[id]);
      if(selected===id)$('#prompt').value=drafts[id] || '';
    }
    persist();toast(accepted?chatText('送信は受け付けられています。応答を取得できなかったため、会話を更新しました。'):error.message);
    updateState();renderChats();
  } finally { pendingSends.delete(id);steerPending = false; updateComposer(); }
}
$('#stop-btn').onclick = async () => { const chat = chats.find(chat => chat.id === selected); if (demo) { cancelDemoTimers(); chat.status = 'cancelled'; renderChats(); return; } try { await api('stop',{id:chat.id}); } catch (error) { toast(error.message); } };
async function boot() {
  if (desktop && !demo) {
    try{
      const saved = await desktop.getUiState();
      if(saved?.loadError)throw Error(saved.loadError);
      if (saved && typeof saved === 'object') {
        drafts = saved.drafts || {}; sendRequests = saved.sendRequests || {}; selected = saved.selected || null;
        if ([1,2,4].includes(saved.layout)) layout = saved.layout;
        if (['system','full','reduced'].includes(saved.motion)) motionPreference = saved.motion;
        applyMotion();
      }
    }catch(error){desktopDraftReadError=error;showDraftSaveError(error);}
  }
  if (demo) {
    setText('#mode-tag','DEMO');
    const now = Date.now();
    state = {connected:true,account:{type:'chatgpt',email:'demo@example.com',planType:'pro'},limits:{rateLimits:{limitId:'codex',primary:{usedPercent:24,windowDurationMins:300,resetsAt:Math.floor(now/1000)+7800},secondary:{usedPercent:42,windowDurationMins:10080,resetsAt:Math.floor(now/1000)+259200}}},models:[{model:'demo-model',displayName:'CODEX · DEMO MODEL',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}]}],policy:{ok:true,reason:''},updatedAt:now};
    state.todos=todoView.demoSnapshot();
    villageChatSeed=villageSample?villageDemoChats():[];
    chats = nameDemoChats([
      {id:'demo1',title:'Main',model:'CODEX · DEMO MODEL',status:'completed',messages:[{id:'demo-user',role:'user',text:'このUIをCodexの利用枠で使いたい。',demoMessage:'このUIをCodexの利用枠で使いたい。'},{id:'demo-assistant',role:'assistant',text:'ChatGPTアカウントを接続して、Codexの利用枠で会話を始められます。\n\n各ペインの会話は独立し、利用枠はアカウント全体で共有します。',demoMessage:'ChatGPTアカウントを接続して、Codexの利用枠で会話を始められます。\n\n各ペインの会話は独立し、利用枠はアカウント全体で共有します。'}]},
      {id:'demo2',title:'Prompt 17',status:'idle',messages:[]}, {id:'demo3',title:'Prompt 18',status:'idle',messages:[]}, {id:'demo4',title:'Prompt 19',status:'idle',messages:[]},
      ...structuredClone(villageChatSeed)
    ]);
    try { const response=await fetch('/api/state');if(response.ok){const saved=await response.json();state.media=saved.media;attachments.hydrate((saved.attachmentDrafts||[]).filter(item=>chats.some(chat=>chat.id===item.conversationId)));} } catch {}
  } else {
    subscribeEvents();
    const response = await fetch('/api/state');
    if (!response.ok) throw Error(chatText('GUIサーバーの状態を取得できません ({status})。', {status:response.status}));
    state = await response.json(); chats = state.conversations || []; contextBoard = state.contextBoard || []; attachments.hydrate(state.attachmentDrafts || []);
    if (!chats.length) for (const title of ['Main','Prompt 17','Prompt 18','Prompt 19']) {
      const chat = await api('conversations',{title,locale:getLocale()});
      if (!chats.some(item => item.id === chat.id)) chats.push(chat);
    }
  }
  if(!demo){recoverSendDrafts(sendRequests,chats,drafts);persist();}
  historyLoaded=true;historyLoadError='';
  if(projectSample){projectSeed=projectDemo();const sample=structuredClone(projectSeed);state.projects=sample.projects;chats.push(...nameDemoChats(sample.chats));}
  if(subagentSample)chats=withAgentDelegationSample(chats,{enabled:true});
  if (!chats.some(chat => chat.id === selected)) selected = chats[0]?.id;
  $('#prompt').value = drafts[selected] || ''; updateState(); renderChats();
  if(demo&&new URLSearchParams(location.search).get('village')==='sample')switchView('town',()=>{townSection('town');village.focus();});
  if(state.projects?.items?.length){currentTownSection='projects';showProjectMap();}
}
function subscribeEvents() {
  if (eventStream && eventStream.readyState !== EventSource.CLOSED) return;
  eventStream = new EventSource('/events');
  eventStream.addEventListener('state',event => { state = JSON.parse(event.data); serverUnavailable = false; updateState(); });
  eventStream.addEventListener('conversations',event => { chats = JSON.parse(event.data); queueConversationRender(); });
  eventStream.addEventListener('chat-groups',event=>{applyChatGroups(JSON.parse(event.data));queueConversationRender();});
  eventStream.addEventListener('context-board',event => { contextBoard = JSON.parse(event.data); contextSharing.render(); });
  eventStream.addEventListener('skills-changed',()=>equipment.invalidate());
  eventStream.addEventListener('party',event=>applyPartyState(JSON.parse(event.data)));
  eventStream.addEventListener('discoveries',event=>applyDiscoveryState(JSON.parse(event.data)));
  eventStream.addEventListener('adventure',event=>applyAdventureState(JSON.parse(event.data)));
  eventStream.addEventListener('village',event=>applyVillageState(JSON.parse(event.data)));
  eventStream.addEventListener('projects',event=>{state.projects=JSON.parse(event.data);projects.render();updateComposer();});
  eventStream.addEventListener('backlog',event=>pluginView.statusChanged(JSON.parse(event.data)));
  eventStream.addEventListener('teams',event=>{state.teams=JSON.parse(event.data);pluginView.teamsStatusChanged(state.teams);town.render();});
  eventStream.addEventListener('teams-drafts',event=>{state.teamsDrafts=JSON.parse(event.data);pluginView.teamsDraftsChanged(state.teamsDrafts);town.render();});
  eventStream.addEventListener('plugins',event=>{state.plugins=JSON.parse(event.data);pluginView.hydrate(state.plugins);town.render();});
  eventStream.addEventListener('board-dispatch',event=>{state.boardDispatch=JSON.parse(event.data);updateState();town.render();});
  eventStream.addEventListener('todos',event=>{state.todos=JSON.parse(event.data);todoView.hydrate();castle.render();town.render();village.render();pluginView.render();});
  eventStream.addEventListener('media',event=>{state.media=JSON.parse(event.data);mediaView.render();todoView.hydrate();});
  for(const kind of ['inbox','schedules','reports'])eventStream.addEventListener(kind,event=>{state[kind]=JSON.parse(event.data);activityView.render();});
  eventStream.addEventListener('activity-error',event=>toast(JSON.parse(event.data).error));
  eventStream.addEventListener('conversation',event => { const chat = JSON.parse(event.data), index = chats.findIndex(item => item.id === chat.id); if (index < 0) chats.push(chat); else chats[index] = chat; queueConversationRender(); });
  eventStream.onerror = () => {
    serverUnavailable = true;
    state.error = chatText('GUIサーバーとの接続が切れました。サーバーの起動を確認して再接続してください。');
    state.policy = {ok:false,reason:state.error}; updateState();
  };
}
onLocaleChange(() => {
  if(villageChatSeed?.length){
    const translated=villageDemoChats();refreshSampleCopy(chats,villageChatSeed,translated);villageChatSeed=translated;
  }
  if(projectSeed){
    const translated=projectDemo();refreshSampleCopy(chats,projectSeed.chats,translated.chats);refreshSampleCopy(state.projects,projectSeed.projects,translated.projects);projectSeed=translated;
  }
  if(subagentSample)chats=withAgentDelegationSample(chats,{enabled:true});
  updateAppNavigation();
  updateAdventureReturn();
  updateState();
  renderChats();
});
boot().catch(error => { connectionError = error.displayReason || error.message;historyLoadError=error.message;history.render(); }).finally(()=>{booting=false;updateState();});
