import {mapStorage} from './map-storage.js';
import {buildConversationAffinity} from './conversation-affinity.js';
import {buildVillageSemanticLayout} from './village-semantic-layout.js';
import {projectVillage,VILLAGE_STAGES} from './village-model.js';
import {drawVillageWorld,drawVillageIslandBackground,drawVillageConversationFocus,worldPersonColor} from './village-art.js';
import {delegationCacheKey,delegationSummary,villageDelegateActors} from './village-delegates.js';
import {projectVillageActivities} from './village-activity.js';
import {VILLAGE_WORLD,VILLAGE_PLACES} from './village-world.js';
import {PartyTravel} from './world-travel.js';
import {sceneBuildingObstacles} from './project-buildings.js';
import {villageRiverWater,villageBridge} from './world-terrain.js';
import {residentReport,acknowledgeResidentReport} from './world-dialogue.js';
import {renderMessageMarkdown} from './message-markdown.js';
import {renderConversationDetails} from './conversation-details.js';
import {createWorld3D} from './world-3d.js';
import {village3DScene,readVillageView,villageFacing,villageEncounterActors,villageEncounterApproach,villageEncounterSightline,villageSpeechPlacement,villageIsland,villageOverviewCamera,villageResidentCamera,villageBiomes,VILLAGE_MIN_ZOOM} from './village-3d-scene.js';
import {drawIslandWater,clipIslandLand,drawIslandCoast} from './world-island-art.js';
import {pointInIsland} from './world-island.js';
import {islandLandRoute,islandWaterObstacles,islandRouteWalkable} from './world-island-travel.js';

const WORLD=VILLAGE_WORLD.core,PROJECTS_PER_DISTRICT=12,RESIDENT_LIMIT=180,LIST_PAGE=50;
const DEMO_KEY='chat-ui-demo-village';
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const button=(id,label,handler,className='outline')=>{const node=make('button',label,className);node.id=id;node.type='button';node.onclick=handler;return node;};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase();
const labels=Object.fromEntries(VILLAGE_STAGES.map(stage=>[stage.id,stage.label]));
const shortLabels={planned:'構想',building:'建設',testing:'検証',complete:'完成'};
const iconPaths={find:'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',history:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',quests:'M5 21V3m0 1h14l-3 5 3 5H5',shop:'m4 4 16 16M7 3 3 7m14 10 4 4M5 19l14-14m-4-2 6 6',tavern:'M4 9h13v11H4zm13 2h3v6h-3M6 3v3m5-3v3m5-3v3',castle:'M3 21V5h4v4h3V3h4v6h3V5h4v16H3m7 0v-6h4v6',board:'M3 4h18v13H3zm4 13v4m10-4v4M7 8h10M7 12h7'};
function iconButton(node,key,label){node.title=label;node.setAttribute('aria-label',label);node.replaceChildren();const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',iconPaths[key]);icon.append(path);node.append(icon);return node;}

export function initVillage({api,demo=false,getChats,getState,onState,onOpenChat,onOpenHistory,onNavigate,onOpenBoard,onOpenQuest}){
 const root=document.querySelector('#history-village');if(!root)return {render(){},setVisible(){},focus(){},getEncounter(){return null;},endEncounter(){}};
 root.classList.add('history-village');root.setAttribute('aria-labelledby','village-title');
 let visible=false,disposed=false,projection=projectVillage([],[]),signature='',district=0,selected=null,busy=false;
 let demoOverrides=[],demoRevision=0;
 try{const stored=JSON.parse(mapStorage.getItem(DEMO_KEY)||'null');if(demo&&Array.isArray(stored?.overrides)){demoOverrides=stored.overrides;demoRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;}}catch{}
 const heading=make('header',undefined,'village-heading'),headingCopy=make('div');
 const title=make('h2','会話が息づく村');title.id='village-title';title.tabIndex=-1;
 const intro=make('p','会話が村人に。ソフトづくりが建物に。','village-intro');headingCopy.append(title,intro);
 const headerActions=make('div',undefined,'village-header-actions');
 const find=iconButton(button('village-find','村人を探す',()=>{closeQuestPeek(false);directory.open=true;questDrawer.hidden=true;search.focus();}), 'find','村人を探す');find.setAttribute('aria-expanded','false');
 const history=iconButton(button('village-history','履歴を取り込む',()=>onOpenHistory?.()),'history','履歴を取り込む');
 const questButton=iconButton(button('village-quests','冒険中の隊を見る',()=>{questDrawer.hidden=!questDrawer.hidden;if(!questDrawer.hidden){closeQuestPeek(false);directory.open=false;questClose.focus();}questButton.setAttribute('aria-expanded',String(!questDrawer.hidden));}),'quests','依頼とパーティを見る');questButton.setAttribute('aria-expanded','false');headerActions.append(find,history,questButton);heading.append(headingCopy,headerActions);
 const statistics=make('div',undefined,'village-statistics');statistics.setAttribute('aria-label','村の成長');
 const stat=(id,label)=>{const row=make('div'),value=make('strong','0');value.id=id;row.append(value,make('span',label));statistics.append(row);return value;};
 const population=stat('village-population','人'),projectCount=stat('village-project-count','棟'),finished=stat('village-completed-count','完成');
 const previewNote=make('p',undefined,'village-preview-note');previewNote.id='village-preview-note';previewNote.hidden=!demo;
 if(demo){const sample=new URLSearchParams(location.search).get('village')==='sample';previewNote.append(make('span',sample?'にぎやかな村':'会話の村'));if(!sample){const link=make('a','にぎやかな村へ →');link.href='/?demo=1&village=sample';previewNote.append(link);}const back=make('a','自分の街に戻る');back.id='village-preview-return';back.href='/';previewNote.append(back);}
 const mapSection=make('section',undefined,'village-map-section');mapSection.setAttribute('aria-label','村の風景');
 const frame=make('div',undefined,'village-map-frame'),canvas=make('canvas');canvas.id='village-canvas';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','会話の村。村人に話しかけ、建物やパーティを確認できます。Enterで名簿、矢印キーで見回す、WASDキーで仲間と歩きます。');canvas.setAttribute('aria-describedby','village-map-help');
 const sites=make('div',undefined,'village-sites');sites.setAttribute('aria-label','この地区の建物');
 const questSites=make('div',undefined,'village-quest-sites');questSites.setAttribute('aria-label','村にいるパーティ');
 const speech=make('section',undefined,'village-speech');speech.id='village-speech';speech.hidden=true;speech.setAttribute('role','dialog');speech.setAttribute('aria-modal','false');speech.setAttribute('aria-labelledby','village-speech-name');
 const speechName=make('strong');speechName.id='village-speech-name';const speechClose=button('village-speech-close','×',()=>closeSpeech());speechClose.setAttribute('aria-label','吹き出しを閉じる');
 const speechText=make('div');speechText.id='village-speech-text';const speechSource=make('small');speechSource.id='village-speech-source';
 const speechActions=make('div',undefined,'village-speech-actions');speechActions.append(button('village-speech-chat','話す',()=>{const id=speechId,snapshot=getEncounter();closeSpeech(false,{preserveEncounter:true});if(id)onOpenChat?.(id,snapshot);},'primary'),button('village-speech-detail','詳しく',()=>{const id=speechId;closeSpeech(false);if(id)openResident(id);}));speech.append(speechName,speechClose,speechText,speechSource,speechActions);
 const empty=make('div',undefined,'village-empty');empty.id='village-empty';empty.append(make('strong','最初の村人を迎えましょう'),make('p','このアプリにある過去の会話が、村の住民になります。'));
 empty.append(button('village-import','会話の履歴を開く',()=>onOpenHistory?.(),'primary'));
 const places=make('div',undefined,'village-places');places.setAttribute('aria-label','道の先にある施設');
 for(const place of VILLAGE_PLACES){const entry=button('village-enter-'+place.id,place.shortName+'に入る →',()=>{cancelTravel();onNavigate?.(place.id);},'village-place');entry.dataset.villagePlace=place.id;entry.hidden=true;entry.setAttribute('aria-label',place.name+'に入る');places.append(entry);}
 frame.append(canvas,sites,questSites,places,empty,speech);
 const mapControls=make('div',undefined,'village-map-controls'),cameraControls=make('div',undefined,'village-camera-controls');
 const zoomOut=button('village-zoom-out','−',()=>changeZoom(zoom/1.2));zoomOut.setAttribute('aria-label','村を縮小');
 const fit=button('village-fit','全体へ',()=>{cancelTravel();automaticZoom=false;fitIsland();draw();queueViewSave();});fit.setAttribute('aria-label','島全体を見る');
 const zoomIn=button('village-zoom-in','＋',()=>changeZoom(zoom*1.2));zoomIn.setAttribute('aria-label','村を拡大');cameraControls.append(zoomOut,fit,zoomIn);
 const districtControls=make('div',undefined,'village-district-controls');
 const previous=button('village-district-prev','←',()=>changeDistrict(district-1));previous.setAttribute('aria-label','前の地区');
 const districtLabel=make('span','第1地区');districtLabel.id='village-district-label';districtLabel.setAttribute('role','status');
 const next=button('village-district-next','→',()=>changeDistrict(district+1));next.setAttribute('aria-label','次の地区');districtControls.append(previous,districtLabel,next);
 const pause=button('village-motion','動きを止める',()=>{locallyPaused=!locallyPaused;syncAnimation();});pause.setAttribute('aria-pressed','false');
 mapControls.append(cameraControls,districtControls,pause);
 const mapHelp=make('p','近い会話は近くに · 強い関連の主な道を表示 · 太い道ほど強い関連','village-map-help');mapHelp.id='village-map-help';
 const populationNote=make('p',undefined,'village-population-note');populationNote.id='village-population-note';
 const legend=make('div',undefined,'village-legend');legend.setAttribute('aria-label','建物の育ち方');for(const stage of VILLAGE_STAGES){const item=make('span',stage.label);item.dataset.stage=stage.id;legend.append(item);}
 mapSection.append(frame,mapControls,mapHelp,populationNote,legend);
 const inset=make('section',undefined,'world-3d-inset');inset.id='village-leader-window';inset.hidden=true;inset.setAttribute('aria-label','リーダー目線の小窓');
 const insetHeader=make('header',undefined,'world-3d-inset-header'),insetTitle=make('strong','リーダー目線');insetTitle.title='操作中のパーティ先頭の目線';
 const insetClose=button('village-leader-close','×',()=>setInsetVisible(false,true),'world-3d-inset-close');insetClose.setAttribute('aria-label','リーダー目線の小窓を閉じる');insetHeader.append(insetTitle,insetClose);
 const canvas3D=make('canvas',undefined,'world-3d-inset-canvas');canvas3D.id='village-map-3d';canvas3D.tabIndex=0;canvas3D.setAttribute('role','img');canvas3D.setAttribute('aria-label','リーダー目線。俯瞰地図と同じ隊の視界です。ドラッグ・矢印キーで見回し、WASDで歩けます。');
 inset.append(insetHeader,canvas3D);frame.append(inset);
 const insetToggle=button('village-leader-toggle','目線を表示',()=>setInsetVisible(true,true),'world-3d-inset-toggle village-leader-toggle');insetToggle.setAttribute('aria-controls',inset.id);insetToggle.setAttribute('aria-expanded','true');insetToggle.hidden=true;
 const viewError=make('p',undefined,'world-3d-error village-inset-error');viewError.id='village-3d-error';viewError.hidden=true;viewError.setAttribute('role','status');mapSection.append(insetToggle,viewError);
 const services=make('nav',undefined,'village-services');services.setAttribute('aria-label','村の施設');services.append(iconButton(button('village-shop','武器屋',()=>travelTo('weapon')),'shop','武器屋へ向かう'),iconButton(button('village-tavern','酒場と仲間',()=>travelTo('tavern')),'tavern','酒場へ向かう'),iconButton(button('village-castle','お城で依頼',()=>travelTo('castle')),'castle','お城へ向かう'),iconButton(button('village-board','隊の掲示板',()=>onOpenBoard?.()),'board','隊の掲示板'));
 const directory=make('details',undefined,'village-directory');directory.id='village-directory';
 const directorySummary=make('summary','村の名簿');const directoryClose=button('village-directory-close','閉じる',()=>{directory.open=false;find.focus();});directory.append(directorySummary,directoryClose);directory.ontoggle=()=>find.setAttribute('aria-expanded',String(directory.open));
 const searchLabel=make('label','名前や会話のタイトルで探す');searchLabel.htmlFor='village-search';
 const search=make('input');search.id='village-search';search.type='search';search.placeholder='探したい会話の言葉';
 const directoryCount=make('p',undefined,'village-directory-count');directoryCount.id='village-directory-count';directoryCount.setAttribute('role','status');
 const residentList=make('div',undefined,'village-residents');residentList.id='village-residents';residentList.setAttribute('role','list');
 let listLimit=LIST_PAGE;
 const more=button('village-more','さらに50人を見る',()=>{listLimit+=LIST_PAGE;renderDirectory();});
 directory.append(searchLabel,search,directoryCount,residentList,more);
 search.oninput=()=>{listLimit=LIST_PAGE;renderDirectory();};
 const questDrawer=make('section',undefined,'village-quest-drawer');questDrawer.id='village-quest-drawer';questDrawer.hidden=true;questDrawer.setAttribute('aria-labelledby','village-quest-title');const questTitle=make('h3','依頼とパーティ');questTitle.id='village-quest-title';const questClose=button('village-quest-close','閉じる',()=>{questDrawer.hidden=true;questButton.setAttribute('aria-expanded','false');questButton.focus();});const questSummary=make('p');questSummary.id='village-quest-summary';const questList=make('div',undefined,'village-quest-list');questList.id='village-quest-list';questDrawer.append(questTitle,questClose,questSummary,questList);
 const questPeek=make('section',undefined,'village-quest-peek');questPeek.id='village-quest-peek';questPeek.hidden=true;questPeek.setAttribute('role','dialog');questPeek.setAttribute('aria-modal','false');questPeek.setAttribute('aria-labelledby','village-quest-peek-title');
 const peekHeading=make('header',undefined,'village-peek-heading'),questPartyName=make('p');questPartyName.id='village-quest-party-name';
 const questPeekTitle=make('h3');questPeekTitle.id='village-quest-peek-title';
 const questPeekClose=button('village-quest-peek-close','×',()=>closeQuestPeek());questPeekClose.setAttribute('aria-label','パーティの案内を閉じる');peekHeading.append(questPartyName,questPeekTitle,questPeekClose);
 const questBody=make('div',undefined,'village-peek-body'),questPeekStatus=make('p');questPeekStatus.id='village-quest-peek-status';questPeekStatus.setAttribute('role','status');
 const questCurrent=make('p');questCurrent.id='village-quest-current';
 const questProgress=make('p');questProgress.id='village-quest-progress';
 const questTask=make('p');questTask.id='village-quest-task';
 const questResult=make('p');questResult.id='village-quest-result';
 const questNote=make('p');questNote.id='village-quest-note';
 const questMore=make('details',undefined,'village-peek-more');questMore.append(make('summary','役割と達成条件'));
 const questCriteria=make('p');questCriteria.id='village-quest-criteria';const questArtifact=make('p');questArtifact.id='village-quest-artifact';
 const questPeekMembers=make('div',undefined,'village-quest-peek-members');questPeekMembers.id='village-quest-members';questPeekMembers.setAttribute('aria-label','この隊の仲間と役割');questMore.append(questCriteria,questArtifact,questPeekMembers);
 questBody.append(questPeekStatus,questCurrent,questProgress,questTask,questResult,questNote,questMore);
 const questFooter=make('footer',undefined,'village-peek-footer'),questActions=make('div',undefined,'village-peek-actions');
 const questOpen=button('village-quest-open','依頼を開く →',()=>{const squad=selectedSquad();closeQuestPeek(false);if(squad?.id==='protagonist')onNavigate?.('tavern');else if(squad)onOpenQuest?.(squad);},'primary');
 const questChat=button('village-quest-chat','担当の会話',()=>{const id=questChat.dataset.conversationId;closeQuestPeek(false);if(id)onOpenChat?.(id);});questActions.append(questOpen,questChat);
 const questCycle=make('nav',undefined,'village-peek-cycle');questCycle.setAttribute('aria-label','確認するパーティを切り替える');
 const questPrevious=button('village-quest-prev','‹ 前の隊',()=>cycleSquad(-1));const questNext=button('village-quest-next','次の隊 ›',()=>cycleSquad(1));const questLocate=button('village-quest-locate','隊の場所へ',()=>locateSquad());questCycle.append(questPrevious,questLocate,questNext);questFooter.append(questActions,questCycle);questPeek.append(peekHeading,questBody,questFooter);
 const note=make('p','建物の段階は会話からの推定です。','village-explanation');
 const wayfinding=make('nav',undefined,'village-wayfinding');wayfinding.setAttribute('aria-label','道の先へ');
 for(const place of VILLAGE_PLACES){const guide=button('village-travel-'+place.id,place.shortName,()=>travelTo(place.id),'village-waypoint');guide.dataset.destination=place.id;guide.setAttribute('aria-label',place.name+'へ向かう');wayfinding.append(guide);}
 const journey=make('p',undefined,'village-journey');journey.id='village-journey';journey.setAttribute('role','status');journey.hidden=true;
 root.replaceChildren(mapSection,heading,statistics,previewNote,services,wayfinding,journey,directory,questDrawer,questPeek,note);

 const detail=make('dialog',undefined,'village-detail');detail.id='village-detail';detail.setAttribute('aria-labelledby','village-detail-title');
 const detailHeader=make('div',undefined,'village-detail-header'),detailTitle=make('h2');detailTitle.id='village-detail-title';
 const close=button('village-detail-close','閉じる',()=>detail.close());detailHeader.append(detailTitle,close);
 const detailChat=make('p',undefined,'village-detail-chat');detailChat.id='village-detail-chat';
 const detailStage=make('p',undefined,'village-detail-stage');detailStage.id='village-detail-stage';
 const detailContent=make('div');detailContent.id='village-detail-content';
 const openChat=button('village-open-chat','この会話を開く →',()=>{const id=selected;if(!id)return;detail.close();onOpenChat?.(id);},'primary');
 const evidence=make('details',undefined,'village-evidence');evidence.append(make('summary','この建物になった手がかり'));
 const evidenceList=make('ul');evidenceList.id='village-evidence';evidence.append(evidenceList);
 const form=make('form',undefined,'village-correction');form.id='village-correction';
 const formHeading=make('h3','村での見え方を整える'),kindLabel=make('label','会話の種類');kindLabel.htmlFor='village-kind';
 const kind=make('select');kind.id='village-kind';for(const [value,label]of [['auto','会話から自動で判定'],['software','ソフトづくり · 建物にする'],['resident','住民として暮らす · 建物にしない']])kind.add(new Option(label,value));
 const stageLabel=make('label','建物の進み具合');stageLabel.htmlFor='village-stage';const stage=make('select');stage.id='village-stage';stage.add(new Option('会話から推定する','auto'));for(const item of VILLAGE_STAGES)stage.add(new Option(item.label,item.id));
 const correctionHelp=make('p','会話だけでは分からない進み具合は、自分で直せます。ここで変わるのは村の表示だけです。');
 const save=button('village-save','村の記録を保存',null,'primary');save.type='submit';
 const error=make('p',undefined,'village-error');error.id='village-error';error.hidden=true;error.setAttribute('role','alert');
 const feedback=make('p',undefined,'village-feedback');feedback.id='village-feedback';feedback.hidden=true;feedback.setAttribute('role','status');
 form.append(formHeading,kindLabel,kind,stageLabel,stage,correctionHelp,save,error,feedback);detail.append(detailHeader,detailChat,detailStage,openChat,detailContent,evidence,form);document.body.append(detail);
 kind.onchange=()=>{if(kind.value==='resident')stage.value='auto';stage.disabled=kind.value==='resident'||busy;};
 let previousFocus=null;
 function overrides(){return demo?demoOverrides:getState()?.village?.overrides||[];}
 function openResident(id){
  if(!projection.residents.some(item=>item.conversationId===id))return;
  closeSpeech(false);
  selected=id;previousFocus=document.activeElement;centerResident(id);error.hidden=true;feedback.hidden=true;evidence.open=false;refreshDetail(true);detail.showModal();close.focus();syncAnimation();draw();
 }
 function refreshDetail(resetFields=false){
  const resident=projection.residents.find(item=>item.conversationId===selected);if(!resident){if(detail.open)detail.close();return;}
  const project=projection.projects.find(item=>item.conversationId===selected);
  detailTitle.textContent=resident.name;detailChat.textContent=resident.title;
  renderConversationDetails(detailContent,getChats().find(chat=>chat.id===selected));
  detailStage.textContent=project?(project.source==='manual'?'自分で指定した進み具合':'会話からの推定')+' · '+project.stageLabel:'この会話は、村で暮らす住民です。';detailStage.dataset.stage=project?.stage||'resident';
  evidence.hidden=!project;evidenceList.replaceChildren(...(project?.evidence||[]).map(item=>make('li',item.text)));
  if(project&&!evidenceList.children.length)evidenceList.append(make('li',project.source==='manual'?'村の見え方を自分で指定しています。':'ソフトづくりの会話として、建物の場所を用意しました。'));
  if(resetFields){const value=overrides().find(item=>item.conversationId===selected);kind.value=value?.kind||'auto';stage.value=value?.stage||'auto';}
  kind.disabled=busy;stage.disabled=busy||kind.value==='resident';save.disabled=busy;save.textContent=busy?'保存しています…':'村の記録を保存';
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!selected)return;
  const params={conversationId:selected,kind:kind.value,stage:kind.value==='resident'?'auto':stage.value};busy=true;error.hidden=true;feedback.hidden=true;refreshDetail();
  try{
   let result;
   if(demo){const next=demoOverrides.filter(item=>item.conversationId!==params.conversationId);if(params.kind!=='auto'||params.stage!=='auto')next.push(params);result={version:1,revision:demoRevision+1,overrides:next};mapStorage.setItem(DEMO_KEY,JSON.stringify(result));demoOverrides=next;demoRevision=result.revision;}
   else result=await api('village/configure',params);
   onState?.(result);signature='';updateProjection();feedback.textContent=demo?'このデモの村に保存しました。':'村の記録を保存しました。';feedback.hidden=false;
  }catch(reason){error.textContent=reason?.message||'村の記録を保存できませんでした。';error.hidden=false;}
  finally{busy=false;refreshDetail();}
 };
 detail.addEventListener('close',()=>{selected=null;draw();if(visible&&previousFocus?.isConnected&&previousFocus.getClientRects().length)previousFocus.focus({preventScroll:true});syncAnimation();});

 const layoutKey=demo?'chat-ui-demo-village-layout':'chat-ui-village-layout';
 let assignments=new Map(),projectSlots=[],shownResidents=[],positions=[],frameId=0,lastFrame=0,lastPaint=0,elapsed=0,lastProjection=0,projectionTimer=0,overlaySignature='';
 let semanticLayout=null,semanticSignature='',residentCameraCell='';
 let activities={protagonist:null,squads:[],allSquads:[],stats:{}},activitySignature='',activityReferences=[],squadScenes=[],heroScene=null,selectedSquadId=null,peekSignature='';
 let speechId=null,speechAnchor=null,heroPoint={x:490,y:430},heroGoal=null,heroTrail=[{x:490,y:430}],heroLastTime=0,heroRouteIndex=0;
 let encounter=null,latestScene=null;const residentPauses=new Map();
 try{const rows=JSON.parse(mapStorage.getItem(layoutKey)||'[]'),used=new Set();if(Array.isArray(rows))for(const row of rows.slice(0,20000)){if(Array.isArray(row)&&typeof row[0]==='string'&&row[0].length<=512&&Number.isSafeInteger(row[1])&&row[1]>=0&&row[1]<20000&&!used.has(row[1])){assignments.set(row[0],row[1]);used.add(row[1]);}}}catch{}
 const chatCache=new Map();
 let locallyPaused=false,zoom=1,automaticZoom=true,camera={x:500,y:320},dimensions={width:0,height:0},transform={scale:1,x:0,y:0};
 const viewKey=demo?'chat-ui-demo-village-view':'chat-ui-village-view';
 let savedView=readVillageView(null),savedHero=null,insetVisible=true,insetInitialized=false,insetCamera=null,world3D=null,viewSaveTimer=0,leaderHeading=0,leaderPrevious=null;
 try{const value=JSON.parse(mapStorage.getItem(viewKey)||'null');savedView=readVillageView(value);savedHero=value?.hero||null;insetVisible=value?.insetVisible!==false;insetCamera=value?.insetCamera||null;}catch{}
 if(savedView.camera){camera={x:savedView.camera.x,y:savedView.camera.y};zoom=savedView.camera.zoom;automaticZoom=false;}
 district=savedView.district;
 let drag=null,suppressMapClick=false,travel=null,arrivalFocus=null,travelVersion=0,arrivalMembers=null;
 let heard={};try{heard=JSON.parse(mapStorage.getItem('chat-ui-resident-heard'+(demo?'-demo':''))||'{}');}catch{}
 const media=matchMedia('(prefers-reduced-motion: reduce)'),context=canvas.getContext('2d');
 const motionEnabled=()=>!locallyPaused&&!media.matches&&document.body.dataset.motion!=='reduced';
 const canAnimate=()=>visible&&!document.hidden&&!detail.open&&!document.querySelector('dialog[open]')&&motionEnabled()&&(travel||shownResidents.length>0||activities.protagonist||activities.squads.length>0)&&frame.clientWidth>0;
 function saveView(){clearTimeout(viewSaveTimer);viewSaveTimer=0;try{mapStorage.setItem(viewKey,JSON.stringify({mode:'2d',camera:{...camera,zoom},district,insetVisible,insetCamera:world3D?.getCameraState()||insetCamera,
  hero:savedHero||{point:{...heroPoint},heading:leaderHeading,members:(travel?.engine.members||arrivalMembers||heroScene?.members||[heroPoint]).slice(0,8).map(({x,y})=>({x,y}))}}));}catch{}}
 function queueViewSave(){clearTimeout(viewSaveTimer);viewSaveTimer=setTimeout(saveView,300);}
 function fail3D(){setInsetVisible(false);viewError.textContent='目線の小窓を表示できません。俯瞰地図はそのまま使えます。';viewError.hidden=false;insetToggle.disabled=true;}
 function resizeInset(){if(insetVisible&&canvas3D.clientWidth&&canvas3D.clientHeight)world3D?.resize(canvas3D.clientWidth,canvas3D.clientHeight,Math.min(devicePixelRatio||1,2));}
 function setInsetVisible(value,focus=false){
  insetInitialized=true;insetVisible=Boolean(value);inset.hidden=!insetVisible;root.dataset.viewMode='2d';root.dataset.leaderInset=String(insetVisible);
  insetToggle.hidden=insetVisible;insetToggle.setAttribute('aria-expanded',String(insetVisible));viewError.hidden=true;
  if(insetVisible&&!world3D){world3D=createWorld3D({canvas:canvas3D,onGround:point=>moveHero(point.x,point.y),onSelect:hit=>{if(hit.id.startsWith('project:'))openResident(hit.id.slice(8));else if(hit.id.startsWith('resident:'))openSpeech(hit.id.slice(9));else if(hit.id.startsWith('place:'))travelTo(hit.id.slice(6));else if(hit.id.startsWith('party:')){const groupId=hit.id.slice(6,hit.id.lastIndexOf(':')),group=[...squadScenes,...(heroScene?[heroScene]:[])].find(item=>item.id===groupId),member=group?.members[Number(hit.id.slice(hit.id.lastIndexOf(':')+1))];if(member?.conversationId&&!isControlledLeader(member))openSpeech(member.conversationId);else selectSquad(groupId);}},onFailure:()=>queueMicrotask(fail3D),onCameraChange:queueViewSave});
   if(!world3D.supported){fail3D();return;}
   if(insetCamera)world3D.setCameraState(insetCamera);world3D.setMode('leader');
  }
  world3D?.setVisible(visible&&insetVisible&&!document.hidden);resizeInset();draw();queueViewSave();
  if(focus)(insetVisible?canvas3D:insetToggle).focus({preventScroll:true});
 }
 for(const event of ['pointerup','wheel','keydown'])frame.addEventListener(event,queueViewSave,{passive:true});
 function getEncounter(){
  if(!encounter||!latestScene)return null;
  const person=latestScene.people.find(item=>item.conversationId===encounter.conversationId);
  if(!person)return null;
  return structuredClone({source:'village',conversationId:encounter.conversationId,name:encounter.name,status:encounter.status,phase:encounter.status,
   person:{...encounter.person,...person,name:encounter.name},leader:{...controlledLeader(),...latestScene.leader},scene:latestScene});
 }
 function endEncounter({redraw=true}={}){
  if(encounter){residentPauses.set(encounter.conversationId,(residentPauses.get(encounter.conversationId)||0)+Math.max(0,elapsed-encounter.heldAt));if(encounter.status==='approaching')cancelTravel();}
  encounter=null;speech.hidden=true;speechId=null;speechAnchor=null;delete root.dataset.speechResident;delete root.dataset.encounterId;delete root.dataset.encounterStatus;delete root.dataset.encounterPersonHeading;delete root.dataset.encounterLeaderHeading;delete root.dataset.encounterPose;delete root.dataset.encounterCamera;
  if(redraw)draw();
 }
 function closeSpeech(focus=true,{preserveEncounter=false}={}){if(!preserveEncounter)endEncounter({redraw:false});speech.hidden=true;speechId=null;speechAnchor=null;delete root.dataset.speechResident;if(focus&&visible)canvas.focus({preventScroll:true});draw();}
 function controlledLeader(){const group=heroScene||squadScenes.find(item=>item.isProtagonist);return group?.members.find(member=>member.isLeader||member.conversationId&&member.conversationId===group.leaderId)||group?.members[0]||heroPoint;}
 function isControlledLeader(member){const leader=controlledLeader();return member===leader||Boolean(member.conversationId&&member.conversationId===leader.conversationId);}
 function openSpeech(id){
  const person=projection.residents.find(r=>r.conversationId===id);if(!person)return;
  if(id===controlledLeader().conversationId){onOpenChat?.(id);return;}
  const candidates=[...positions,...[...squadScenes,...(heroScene?[heroScene]:[])].flatMap(group=>group.members.map((member,index)=>({...member,color:worldPersonColor(member,{hero:group.isProtagonist,party:true,index,squadSeed:group.seed})})))].filter(item=>item.conversationId===id);
  endEncounter({redraw:false});cancelTravel();centerResident(id);
  const leader=controlledLeader(),target=candidates.sort((a,b)=>Math.hypot(a.x-leader.x,a.y-leader.y)-Math.hypot(b.x-leader.x,b.y-leader.y))[0]||residentPosition(person);
  encounter={conversationId:id,name:person.name,person:{...person,...target},status:'approaching',heldAt:elapsed};
  root.dataset.encounterId=id;root.dataset.encounterStatus='approaching';
  const terrain=movementTerrain(),goal=villageEncounterApproach(target,leader,[...movementObstacles(),...islandWaterObstacles(terrain.water,terrain.bridges)]);
  if(!goal||!moveHero(goal.x,goal.y,()=>showSpeech(id),{preserveEncounter:true}))endEncounter();else directory.open=false;
 }
 function showSpeech(id){
  const resident=projection.residents.find(item=>item.conversationId===id);if(!resident)return;
  if(!encounter||encounter.conversationId!==id)return;encounter.status='talking';root.dataset.encounterStatus='talking';
  closeSpeech(false,{preserveEncounter:true});selectedSquadId=null;delete root.dataset.selectedSquad;questPeek.hidden=true;directory.open=false;questDrawer.hidden=true;questButton.setAttribute('aria-expanded','false');centerResident(id);
  world3D?.setMode('leader');world3D?.reset();
  speechId=id;speechAnchor=residentPosition(resident);speech.dataset.conversationId=id;root.dataset.speechResident=id;speechName.textContent=resident.name;
  const chat=getChats().find(c=>c.id===id),report=residentReport(chat||{id,title:resident.title,messages:[]},null,heard[id]);
  renderMessageMarkdown(speechText,report.text);speechSource.textContent=report.label+' · '+resident.title;speechSource.title=resident.title;
  speech.hidden=false;heard[id]=acknowledgeResidentReport(heard[id],report);try{mapStorage.setItem('chat-ui-resident-heard'+(demo?'-demo':''),JSON.stringify(heard));}catch{}speechClose.focus({preventScroll:true});draw();
 }
 function projectFor(resident){
  const home=semanticLayout?.homes.get(resident.conversationId);if(!home)return null;
  let nearest=null,distance=350;
  for(const project of projectSlots){const next=Math.hypot(project.x-home.x,project.y-home.y);if(next<distance){nearest=project;distance=next;}}
  return nearest;
 }
 function topicScore(terms,project){const words=project.topicKeywords||[];return (terms||[]).reduce((score,word)=>score+(words.includes(word)?3:word.length>=2&&words.some(other=>other.length>=2&&(other.includes(word)||word.includes(other)))?1:0),0);}
 function cachedProjection(chats){
  const settings=new Map(overrides().map(item=>[item.conversationId,item])),seen=new Set(),activeIds=new Set();
  const result={residents:[],projects:[],stats:{population:0,projects:0,working:0,stages:Object.fromEntries(VILLAGE_STAGES.map(item=>[item.id,0]))}};
  let changed=false;
  for(const chat of chats){
   if(!chat||typeof chat.id!=='string'||seen.has(chat.id))continue;
   activeIds.add(chat.id);const messages=Array.isArray(chat.messages)?chat.messages:[],last=messages.at(-1),override=settings.get(chat.id);
   const key=JSON.stringify([chat.title,chat.characterName,chat.status,chat.updatedAt,messages.length,last?.id,last?.text?.length,last?.text?.slice(-240),override?.kind,override?.stage,chat.threadId,delegationCacheKey(chat.delegation)]);
   let entry=chatCache.get(chat.id);
   // Bulk state snapshots can replace objects without changing their contents.
   // Compare strings cheaply, and only run transcript analysis for changed chats.
   const sameMessages=entry&&entry.key===key&&(entry.chat===chat||(entry.chat.messages||[]).length===messages.length&&messages.every((message,index)=>{const before=entry.chat.messages[index];return before?.id===message?.id&&before?.role===message?.role&&before?.text===message?.text&&before?.createdAt===message?.createdAt;}));
   if(!sameMessages){entry={key,chat,value:projectVillage([chat],override?[override]:[])};chatCache.set(chat.id,entry);changed=true;}else entry.chat=chat;
   const value=entry.value;if(value.residents.length)seen.add(chat.id);result.residents.push(...value.residents);result.projects.push(...value.projects);result.stats.working+=value.stats.working;
   for(const item of VILLAGE_STAGES)result.stats.stages[item.id]+=value.stats.stages[item.id];
  }
  for(const id of chatCache.keys())if(!activeIds.has(id)){chatCache.delete(id);changed=true;}
  result.stats.population=result.residents.length;result.stats.projects=result.projects.length;
  return {value:result,changed};
 }
 function updateProjection(){
  if(disposed)return;
  const chats=getChats()||[],cached=cachedProjection(chats);lastProjection=performance.now();
  const state=getState()||{},references=[state.party,state.todos,state.boardDispatch];let activityChanged=false;
  if(cached.changed||references.some((value,index)=>value!==activityReferences[index])||!activitySignature){activityReferences=references;const next=projectVillageActivities(state,chats),key=JSON.stringify(next);if(key!==activitySignature){activities=next;activitySignature=key;activityChanged=true;}}
  if(!cached.changed&&!activityChanged&&signature){syncAnimation();return;}signature='ready';projection=cached.value;
  // A streaming delta never moves somebody's home underneath the player.
  // Recompute after settled content changes and preserve the current camera.
  if(!semanticLayout||!chats.some(chat=>['starting','running','stopping'].includes(chat.status))){
   const affinity=buildConversationAffinity(chats),key=affinity.signature+'|'+projection.projects.map(p=>p.conversationId).sort().join('|');
   if(!semanticLayout||key!==semanticSignature){
    const base=village3DScene({population:projection.residents.length});
    semanticLayout=buildVillageSemanticLayout({residents:projection.residents,projects:projection.projects,affinity,island:villageIsland(),
     terrain:base,obstacles:sceneBuildingObstacles(base),biomes:villageBiomes()});semanticSignature=key;
   }
  }
  const previousAssignments=JSON.stringify([...assignments]);
  const ids=new Set(projection.projects.map(item=>item.conversationId));for(const id of assignments.keys())if(!ids.has(id))assignments.delete(id);
  const used=new Set(assignments.values());for(const project of [...projection.projects].sort((a,b)=>a.seed-b.seed||a.conversationId.localeCompare(b.conversationId))){if(assignments.has(project.conversationId))continue;let index=0;while(used.has(index))index++;assignments.set(project.conversationId,index);used.add(index);}
  const nextAssignments=JSON.stringify([...assignments]);if(nextAssignments!==previousAssignments)try{mapStorage.setItem(layoutKey,nextAssignments);}catch{}
  population.textContent=String(projection.stats.population);projectCount.textContent=String(projection.stats.projects);finished.textContent=String(projection.stats.stages.complete||0);
  root.dataset.population=String(projection.stats.population);root.dataset.projectCount=String(projection.stats.projects);
  directorySummary.textContent='村の名簿 · '+projection.residents.length+'人';empty.hidden=projection.residents.length>0;
  district=clamp(district,0,districtCount()-1);syncDistrict();renderDirectory();renderActivities();if(detail.open)refreshDetail();const heldId=encounter?.conversationId||speechId;if(heldId&&!projection.residents.some(item=>item.conversationId===heldId))closeSpeech(false);
 }
 function districtCount(){return Math.max(1,semanticLayout?.neighborhoods.length||1);}
 function syncDistrict(){
  projectSlots=(semanticLayout?.projects||[]).map(item=>({...item,...projection.projects.find(p=>p.conversationId===item.conversationId),x:item.x,y:item.y}));
  restoreHeroView();
  refreshNearbyResidents();
  root.dataset.district=String(district+1);root.dataset.renderedResidents=String(shownResidents.length);canvas.dataset.renderedResidents=String(shownResidents.length);
  districtLabel.textContent='集落 '+(district+1)+' / '+districtCount();previous.disabled=district===0;next.disabled=district>=districtCount()-1;
  populationNote.textContent=projection.residents.length>RESIDENT_LIMIT?'この景色には'+shownResidents.length+'人。全'+projection.residents.length+'人の会話は、村の名簿で探せます。':projection.projects.length?'ソフトづくりの会話ごとに1棟。建物を選ぶと、元の会話と進み具合が分かります。':'ソフトづくりの会話が増えると、この村に建設現場が生まれます。';
  populationNote.classList.toggle('village-cap-note',projection.residents.length>RESIDENT_LIMIT);
  const focused=sites.contains(document.activeElement)?document.activeElement.dataset.villageProject:null;
  sites.replaceChildren(...projectSlots.map(project=>{const control=button('',undefined,()=>openResident(project.conversationId),'village-building');control.dataset.villageProject=project.conversationId;control.dataset.stage=project.stage;control.setAttribute('aria-label',project.title+' · '+project.stageLabel+' · 会話と建物を確認');control.title=project.title;control.onfocus=()=>{if(control.matches(':focus-visible'))centerResident(project.conversationId);};const tag=make('span',shortLabels[project.stage],'village-building-tag');tag.setAttribute('aria-hidden','true');control.append(tag);return control;}));overlaySignature='';
  if(focused)Array.from(sites.children).find(item=>item.dataset.villageProject===focused)?.focus({preventScroll:true});
  syncQuestSites();draw();syncAnimation();
 }
 function refreshNearbyResidents(){
  const partyIds=new Set([...(activities.protagonist?.members||[]),...visibleSquads().flatMap(squad=>squad.members)].map(member=>member.conversationId));
  const held=encounter?.conversationId||speechId||selected;
  shownResidents=projection.residents.filter(item=>!partyIds.has(item.conversationId)&&semanticLayout?.homes.has(item.conversationId)).sort((a,b)=>{
   if(a.conversationId===held)return -1;if(b.conversationId===held)return 1;
   const left=semanticLayout.homes.get(a.conversationId),right=semanticLayout.homes.get(b.conversationId);
   return Math.hypot(left.x-camera.x,left.y-camera.y)-Math.hypot(right.x-camera.x,right.y-camera.y)||a.seed-b.seed;
  }).slice(0,RESIDENT_LIMIT);
  residentCameraCell=Math.floor(camera.x/320)+':'+Math.floor(camera.y/320);
 }
 function changeDistrict(value){cancelTravel();closeSpeech(false);district=clamp(value,0,districtCount()-1);const place=semanticLayout?.neighborhoods[district];if(place){camera={x:place.x,y:place.y};zoom=Math.max(zoom,1);automaticZoom=false;}syncDistrict();queueViewSave();}
 function centerResident(id){
  cancelTravel();
  const resident=projection.residents.find(item=>item.conversationId===id);if(!resident)return;
  if(!shownResidents.some(item=>item.conversationId===id)){shownResidents=shownResidents.slice(0,RESIDENT_LIMIT-1).concat(resident);}
  const project=projectSlots.find(item=>item.conversationId===id),point=encounter?.conversationId===id?encounter.person:project?{x:project.x,y:project.y-35}:residentPosition(resident);
  const focused=villageResidentCamera(dimensions.width,dimensions.height,point,zoom);
  camera={x:focused.x,y:focused.y};zoom=focused.zoom;automaticZoom=false;draw();queueViewSave();
 }
 function inspectionSquads(){return [...(activities.protagonist&&!activities.protagonist.activityId?[activities.protagonist]:[]),...activities.allSquads];}
 function selectedSquad(){return activities.allSquads.find(item=>item.id===selectedSquadId)||(selectedSquadId==='protagonist'?activities.protagonist:null);}
 function visibleSquads(){const selected=activities.allSquads.find(item=>item.id===selectedSquadId);return selected&&!activities.squads.some(item=>item.id===selected.id)?[...activities.squads.slice(0,-1),selected]:activities.squads;}
 function closeQuestPeek(focus=true){questPeek.hidden=true;selectedSquadId=null;peekSignature='';delete root.dataset.selectedSquad;syncDistrict();if(focus&&visible)canvas.focus({preventScroll:true});}
 function locateSquad(){
  cancelTravel();const squad=selectedSquad();if(!squad)return;
  updateSquadScenes();const scene=squadScenes.find(item=>item.id===selectedSquadId)||(selectedSquadId==='protagonist'?heroScene:null);if(!scene)return;
  const scale=transform.scale||1,small=dimensions.width<600;
  const desiredX=small?dimensions.width/2:Math.max(120,(dimensions.width-questPeek.offsetWidth-36)/2),desiredY=small?Math.max(155,Math.min(200,dimensions.height*.3)):dimensions.height*.47;
  camera={x:scene.x+(dimensions.width/2-desiredX)/scale,y:scene.y+(dimensions.height/2-desiredY)/scale};draw();
 }
 function selectSquad(id,{focus=true}={}){
  cancelTravel();if(id==='protagonist'&&activities.protagonist?.activityId)id=activities.protagonist.activityId;
  const squad=activities.allSquads.find(item=>item.id===id)||(id==='protagonist'?activities.protagonist:null);if(!squad)return;
  closeSpeech(false);directory.open=false;questDrawer.hidden=true;questButton.setAttribute('aria-expanded','false');selectedSquadId=id;root.dataset.selectedSquad=id;peekSignature='';questMore.open=false;questPeek.hidden=false;
  syncDistrict();renderQuestPeek();locateSquad();if(focus)questPeekClose.focus({preventScroll:true});
 }
 function cycleSquad(direction){const groups=inspectionSquads(),index=groups.findIndex(item=>item.id===selectedSquadId);if(groups.length)selectSquad(groups[(Math.max(0,index)+direction+groups.length)%groups.length].id,{focus:false});}
 function renderQuestPeek(){
  if(questPeek.hidden)return;
  if(selectedSquadId==='protagonist'&&activities.protagonist?.activityId){selectedSquadId=activities.protagonist.activityId;root.dataset.selectedSquad=selectedSquadId;draw();}
  const squad=selectedSquad();if(!squad){closeQuestPeek();return;}
  questPrevious.disabled=questNext.disabled=inspectionSquads().length<2;const key=JSON.stringify(squad);if(key===peekSignature)return;peekSignature=key;
  const info=squad.details||{},current=info.current,steps=info.steps||[],progress=info.progress,idle=squad.id==='protagonist';
  questPeek.dataset.questId=squad.id;questPeek.dataset.live=String(Boolean(info.live));questPartyName.textContent=squad.partyName||squad.name||'依頼のパーティ';questPartyName.title=questPartyName.textContent;
  questPeekTitle.textContent=idle?'次の冒険へ':squad.title;questPeekTitle.title=questPeekTitle.textContent;questPeekStatus.textContent=squad.statusLabel+(squad.provisional?' · 保存した編成で待機':'');questPeekStatus.dataset.status=squad.status;
  questCurrent.textContent=current?current.name+' · '+current.role+'を担当中':idle?'仲間と村を歩いています':squad.status==='completed'?'作業を終えて帰還しました':squad.status==='paused'?'作業を中断しています':squad.status==='waiting'?'この依頼の開始を待っています':squad.status==='uncertain'?'保存された記録を確認できます':squad.status==='gathering'?'依頼に向けて仲間が集合しています':squad.status==='cancelled'?'この依頼は終了しています':squad.status==='running'?'依頼を進めています':'作業の状態を確認できます';
  questProgress.hidden=!progress;questProgress.textContent=progress?'工程 '+progress.completed+' / '+progress.total+' 完了':'';
  questTask.textContent=info.description|| (idle?'酒場で仲間を編成し、お城や依頼ノートから仕事を受けられます。':'');questTask.hidden=!questTask.textContent;
  questResult.textContent=info.error?'確認が必要です: '+info.error:info.summary?'成果: '+info.summary:'';questResult.hidden=!questResult.textContent;questResult.dataset.error=String(Boolean(info.error));
  questNote.textContent=info.note||'';questNote.hidden=!questNote.textContent;
  questCriteria.textContent=info.criteria?'達成条件: '+info.criteria:'';questCriteria.hidden=!questCriteria.textContent;questArtifact.textContent=info.artifact?'残す成果: '+info.artifact:'';questArtifact.hidden=!questArtifact.textContent;
  const focused=questPeekMembers.contains(document.activeElement)?document.activeElement.dataset.villageMember:null;
  const stepLabels={pending:'これから',running:'担当中',completed:'完了',interrupted:'中断',failed:'失敗',blocked:'確認待ち',uncertain:'記録の確認待ち',paused:'中断'};
  questPeekMembers.replaceChildren(...squad.members.map(member=>{const step=steps.find(item=>item.conversationId===member.conversationId),status=step?.status||'unknown';const row=button('',undefined,()=>{closeQuestPeek(false);onOpenChat?.(member.conversationId);},'village-quest-member');row.dataset.villageMember=member.conversationId;row.dataset.status=status;row.setAttribute('aria-label',member.name+'の会話を開く');row.append(make('strong',member.name),make('span',step?.role||member.role),make('small',stepLabels[status]||'会話を見る →'));return row;}));
  if(focused)Array.from(questPeekMembers.children).find(item=>item.dataset.villageMember===focused)?.focus({preventScroll:true});
  const conversationId=current?.conversationId||squad.targetConversationId;questChat.dataset.conversationId=conversationId||'';questChat.hidden=!conversationId;questChat.textContent=current?'担当の会話':'関連する会話';
  questOpen.textContent=idle?'酒場で編成を見る →':'この依頼を開く →';
 }
 function renderActivities(){
  const stats=activities.stats;questSummary.textContent=stats.total?stats.total+'件の依頼 · 進行中 '+stats.running+'隊 · 待機 '+stats.waiting+'隊 · 帰還 '+stats.returned+'隊':'まだ依頼の記録はありません。酒場で仲間を編成できます。';
  questButton.setAttribute('aria-label','依頼とパーティを見る · '+(stats.total||0)+'件');root.dataset.questCount=String(stats.total||0);
  questList.replaceChildren(...inspectionSquads().map(squad=>{const row=button('',undefined,()=>selectSquad(squad.id),'village-quest-row');row.dataset.villageQuestRow=squad.id;row.dataset.status=squad.status;row.append(make('strong',squad.partyName||squad.name||'依頼のパーティ'),make('span',squad.title||'次の冒険を待っています'),make('small',squad.statusLabel+(squad.details?.current?' · '+squad.details.current.role+'を担当中':'')));return row;}));renderQuestPeek();
 }
 function syncQuestSites(){
  const groups=[...visibleSquads(),...(activities.protagonist&&!activities.protagonist.activityId?[activities.protagonist]:[])];
  questSites.replaceChildren(...groups.map(squad=>{const control=button('',undefined,()=>selectSquad(squad.id),'village-quest-flag');control.dataset.villageQuest=squad.id;control.dataset.status=squad.status;control.dataset.motion=squad.motion;control.setAttribute('aria-label',(squad.title||squad.name||'あなたのパーティ')+' · '+squad.statusLabel);control.title=control.getAttribute('aria-label');const tag=make('span',squad.id==='protagonist'?'あなたの隊':({working:'作業',gathering:'集合',waiting:'待機',paused:'中断',returned:'帰還'}[squad.motion]||squad.statusLabel));control.append(tag);control.onfocus=()=>{if(control.matches(':focus-visible')){const scene=squadScenes.find(item=>item.id===squad.id)||(squad.id==='protagonist'?heroScene:null);if(scene){camera={x:scene.x,y:scene.y};draw();}}};return control;}));
 }
 function renderDirectory(){
  const query=normalized(search.value),matches=projection.residents.filter(item=>!query||normalized(item.name+' '+item.title).includes(query));
  const focused=residentList.contains(document.activeElement)?document.activeElement.dataset.villageResident:null;
  directoryCount.textContent=query?matches.length+'人が見つかりました':'過去の会話がある '+matches.length+'人の村人';
  const projectById=new Map(projection.projects.map(item=>[item.conversationId,item]));
  residentList.replaceChildren(...matches.slice(0,listLimit).map(resident=>{
   const row=make('div',undefined,'village-resident-row');row.setAttribute('role','listitem');const control=button('',undefined,()=>openSpeech(resident.conversationId),'village-resident');control.dataset.villageResident=resident.conversationId;control.dataset.villageTalk=resident.conversationId;control.setAttribute('aria-label',resident.name+'に話しかける');const nearby=projectFor(resident);control.dataset.gatheringProject=nearby?.conversationId||'';
   const portrait=make('span',undefined,'village-resident-portrait');portrait.style.setProperty('--villager-shirt',['#c6ac6a','#8ab2b3','#b893a9','#afbc77'][resident.seed%4]);portrait.setAttribute('aria-hidden','true');
   const copy=make('span',undefined,'village-resident-copy');copy.append(make('strong',resident.name),make('span',resident.title));const project=projectById.get(resident.conversationId);copy.append(make('small',project?project.stageLabel+' · '+(project.source==='manual'?'自分で指定':'会話から推定'):nearby?'「'+nearby.title+'」のそば':resident.messageCount+'件のメッセージ'));
   const delegates=delegationSummary(resident.delegation);if(delegates){copy.append(make('small',delegates,'village-native-delegates'));control.setAttribute('aria-label',resident.name+'に話しかける · '+delegates);row.dataset.nativeSubagents=String(resident.delegation.total);}
   control.append(portrait,copy);const records=button('','住民の記録',()=>openResident(resident.conversationId),'village-resident-talk');records.dataset.villageRecord=resident.conversationId;records.setAttribute('aria-label',resident.name+'の住民の記録を開く');row.append(control,records);return row;
  }));
  if(!matches.length)residentList.append(make('p',query?'見つかりませんでした。別の言葉で探してみてください。':'履歴を読み込むと、村人がここに並びます。','village-list-empty'));
  more.hidden=matches.length<=listLimit;more.textContent='さらに'+Math.min(LIST_PAGE,Math.max(0,matches.length-listLimit))+'人を見る';
  if(focused)residentList.querySelectorAll('[data-village-resident]').forEach(item=>{if(item.dataset.villageResident===focused)item.focus({preventScroll:true});});
 }
 function residentPosition(resident){
  if(encounter?.conversationId===resident.conversationId)return {...resident,...encounter.person,...villageFacing(encounter.person,controlledLeader()),walking:false,conversing:true};
  const seed=resident.seed>>>0,project=projectSlots.find(item=>item.conversationId===resident.conversationId),home=semanticLayout?.homes.get(resident.conversationId);
  const points=home?.patrol||[{x:490,y:430},{x:510,y:430}];
  const lengths=points.map((point,index)=>{const next=points[(index+1)%points.length];return Math.hypot(next.x-point.x,next.y-point.y);}),total=lengths.reduce((a,b)=>a+b,0)||1;
  const speed=resident.activity==='working'?23:12+(seed%12),cycle=total/speed+8,seconds=((elapsed-(residentPauses.get(resident.conversationId)||0))/1000+(seed%1000)/17)%cycle;
  let distance=Math.min(total,seconds*speed),point=points[0],direction='right';
  for(let index=0;index<points.length;index++){if(distance<=lengths[index]||index===points.length-1){const from=points[index],to=points[(index+1)%points.length],ratio=lengths[index]?distance/lengths[index]:0;point={x:from.x+(to.x-from.x)*ratio,y:from.y+(to.y-from.y)*ratio};direction=Math.abs(to.x-from.x)>Math.abs(to.y-from.y)?to.x>from.x?'right':'left':to.y>from.y?'down':'up';break;}distance-=lengths[index];}
  return {...resident,x:point.x,y:point.y,walking:seconds<total/speed&&motionEnabled(),direction,worker:Boolean(project)};
 }
 function holdTravelPosition(engine){
  heroPoint={...engine.position};heroGoal={...heroPoint};arrivalMembers=engine.members.map(({x,y})=>({x,y}));
  heroTrail=arrivalMembers.slice().reverse();if(!heroTrail.length)heroTrail=[{...heroPoint}];
 }
 function cancelTravel(){travelVersion++;arrivalFocus=null;if(travel?.walking){holdTravelPosition(travel.engine);travel.engine.cancel();}travel=null;root.dataset.travelling='';root.dataset.arrivedPlace='';journey.hidden=true;}
 function travelTo(id){
  const place=VILLAGE_PLACES.find(item=>item.id===id);if(!place)return;
  const walking=true,from=walking?{...heroPoint}:{...camera};
  const north=VILLAGE_PLACES.find(item=>item.id==='weapon').entrance.y,lane=Math.abs(from.x-310)<Math.abs(from.x-630)?310:630;
  // All facilities join the same road network. Leaving the northern shop
  // returns through its junction before crossing the east/west bridge road.
  const northApproach=Math.abs(from.x-310)<16?[{x:310,y:400}]:[{x:from.x,y:north},{x:310,y:north},{x:310,y:400}];
  const approach=from.y<98?place.id==='weapon'?[{x:from.x,y:north}]:northApproach:from.x<138||from.x>829?[{x:from.x,y:400}]:[{x:lane,y:from.y},{x:lane,y:400}];
  const destination=place.id==='weapon'&&from.y>=98?[{x:310,y:400},{x:310,y:north},{...place.entrance}]:[{...place.entrance}];
  const oldRoute=[from,...approach,...destination].filter((point,index,all)=>!index||point.x!==all[index-1].x||point.y!==all[index-1].y);
  const options={obstacles:movementObstacles(),...movementTerrain()};let points=[from];
  for(const end of oldRoute.slice(1)){
   const segment=islandLandRoute(points.at(-1),end,villageIsland(),options);
   if(!segment.length){points=islandLandRoute(from,place.entrance,villageIsland(),options);break;}
   points.push(...segment.slice(1));
  }
  if(!points.length)return false;
  cancelTravel();closeSpeech(false);questPeek.hidden=true;directory.open=false;questDrawer.hidden=true;questButton.setAttribute('aria-expanded','false');
  const engine=new PartyTravel({...heroPoint},(activities.protagonist?.activityId?1:activities.protagonist?.members.length)||1),version=travelVersion;
  travel={place,walking:true,engine,follow:true,last:elapsed};arrivalMembers=null;
  root.dataset.travelling=id;journey.textContent=place.shortName+'へ向かっています';journey.hidden=false;automaticZoom=false;
  engine.go(points,()=>{
   if(version!==travelVersion)return;
   holdTravelPosition(engine);queueViewSave();
   if(travel?.follow)camera=travelCamera(place.entrance);
   root.dataset.travelling='';root.dataset.arrivedPlace=place.id;journey.textContent=place.shortName+'に着きました';travel=null;
   queueMicrotask(()=>{if(version===travelVersion&&visible)onNavigate?.(place.id);});
  });
  draw();syncAnimation();
 }
 function entranceBottomSpace(){return dimensions.width<600?132:76;}
 function travelCamera(point){
  const {width,height}=dimensions,scale=Math.min(width/WORLD.width,height/WORLD.height)*zoom;
  // Keep the entrance and its action above the floating controls, including
  // short windows where centering the world point alone would hide the door.
  const entranceY=Math.min(height/2+80*scale,height-entranceBottomSpace()-62);
  return {x:point.x,y:point.y-(entranceY-height/2)/scale};
 }
 function updateTravel(){
  if(!travel)return;
  const trip=travel,dt=motionEnabled()?Math.max(0,elapsed-trip.last)/1000:Infinity;trip.last=elapsed;
  trip.engine.advance(dt);heroPoint={...trip.engine.position};heroGoal={...heroPoint};
  if(trip.follow)camera=travelCamera(heroPoint);
 }
 function movementObstacles(){
  return [...sceneBuildingObstacles(village3DScene({projects:projectSlots,population:projection.residents.length})),...(semanticLayout?.mountains||[])];
 }
 let movementTerrainCache;
 function movementTerrain(){
  const island=villageIsland();
  if(!movementTerrainCache||movementTerrainCache.island!==island)movementTerrainCache={island,
   water:[...villageRiverWater(island.bounds.top,VILLAGE_WORLD.top,{x:0,y:0},20),
    ...villageRiverWater(VILLAGE_WORLD.top,VILLAGE_WORLD.bottom),
    ...villageRiverWater(VILLAGE_WORLD.bottom,island.bounds.bottom,{x:0,y:0},20)],bridges:[villageBridge]};
  return movementTerrainCache;
 }
 function restoreHeroView(){
  if(!savedHero)return;const saved=savedHero;savedHero=null;
  const terrain=movementTerrain(),obstacles=movementObstacles(),walkable=point=>islandRouteWalkable([point,point],terrain.island,{...terrain,obstacles});
  // Old camera-only records still work. Changed terrain or damaged storage
  // must never place the restored party in the sea, river or a new building.
  if(!walkable(saved.point))return;
  heroPoint={x:saved.point.x,y:saved.point.y};heroGoal={...heroPoint};heroTrail=[{...heroPoint}];
  if(Number.isFinite(saved.heading))leaderHeading=Math.atan2(Math.sin(saved.heading),Math.cos(saved.heading));
  leaderPrevious={...heroPoint};
  const members=Array.isArray(saved.members)?saved.members.slice(0,8):[];
  arrivalMembers=members.length&&members.every(point=>walkable(point)&&Math.hypot(point.x-heroPoint.x,point.y-heroPoint.y)<=144)
   ?members.map(({x,y})=>({x,y})):[{...heroPoint}];
  arrivalMembers[0]={...heroPoint};
 }
 function moveHero(x,y,onArrival,{preserveEncounter=false}={}){
  if(!pointInIsland({x,y},villageIsland()))return false;
  const goal={x,y};
  const route=islandLandRoute(heroPoint,goal,villageIsland(),{obstacles:movementObstacles(),...movementTerrain()});if(!route.length)return false;
  cancelTravel();closeSpeech(false,{preserveEncounter});arrivalMembers=null;
  const engine=new PartyTravel({...heroPoint},(activities.protagonist?.activityId?1:activities.protagonist?.members.length)||1),version=travelVersion;
  travel={engine,walking:true,place:{entrance:goal},follow:false,last:elapsed};
  engine.go(route,()=>{if(version!==travelVersion)return;holdTravelPosition(engine);travel=null;queueViewSave();onArrival?.();});
  root.dataset.heroGoalX=goal.x.toFixed(1);root.dataset.heroGoalY=goal.y.toFixed(1);draw();syncAnimation();return true;
 }
 function followingPoint(distance){let rest=distance;for(let index=heroTrail.length-1;index>0;index--){const a=heroTrail[index],b=heroTrail[index-1],length=Math.hypot(a.x-b.x,a.y-b.y);if(rest<=length)return {x:a.x+(b.x-a.x)*rest/(length||1),y:a.y+(b.y-a.y)*rest/(length||1)};rest-=length;}return heroTrail[0]||heroPoint;}
 function updateSquadScenes(){
  const hero=(activities.protagonist&&!activities.protagonist.activityId?activities.protagonist:null)||{id:'protagonist',members:[{seed:'hero',conversationId:null}]},route=[{x:330,y:400},{x:630,y:400},{x:630,y:570},{x:310,y:570},{x:310,y:230},{x:710,y:230}];
  if(hero&&!hero.activityId){
   const target=travel?heroPoint:heroGoal||route[heroRouteIndex%route.length],distance=Math.hypot(target.x-heroPoint.x,target.y-heroPoint.y),dt=Math.min(80,Math.max(0,elapsed-heroLastTime))/1000,step=motionEnabled()?Math.min(distance,dt*46):0;
   if(step>0){heroPoint={x:heroPoint.x+(target.x-heroPoint.x)*step/distance,y:heroPoint.y+(target.y-heroPoint.y)*step/distance};const last=heroTrail.at(-1);if(Math.hypot(heroPoint.x-last.x,heroPoint.y-last.y)>2){heroTrail.push({...heroPoint});if(heroTrail.length>200)heroTrail.shift();}}else if(distance<1&&!heroGoal)heroRouteIndex++;
   const ordered=[...hero.members].sort((a,b)=>Number(Boolean(b.isLeader))-Number(Boolean(a.isLeader)));
   heroScene={...hero,isProtagonist:true,x:heroPoint.x,y:heroPoint.y,members:ordered.map((member,index)=>({...member,...(travel?.engine.members[index]||arrivalMembers?.[index]||followingPoint(index*15)),walking:(distance>1||Boolean(travel))&&motionEnabled(),direction:travel?(travel.place.entrance.x>=heroPoint.x?'right':'left'):target.x>=heroPoint.x?'right':'left'}))};
  }else heroScene=null;
  heroLastTime=elapsed;
  const occupied=[];squadScenes=visibleSquads().map((squad,index)=>{
   const exact=projectSlots.find(project=>project.conversationId===squad.targetConversationId),related=exact||[...projectSlots].sort((a,b)=>topicScore(squad.targetKeywords,b)-topicScore(squad.targetKeywords,a)||a.seed-b.seed).find(project=>topicScore(squad.targetKeywords,project)>0);
   const camps=Array.from({length:12},(_,camp)=>({x:175+(camp%4)*200,y:235+Math.floor(camp/4)*170})),start=squad.seed%12,ordered=[...camps.slice(start),...camps.slice(0,start)];
   const base=squad.motion==='working'&&related?{x:related.x+49,y:related.y+47}:ordered.find(point=>occupied.every(other=>Math.hypot(point.x-other.x,point.y-other.y)>105))||ordered[index%12];occupied.push(base);
   const working=squad.motion==='working',isProtagonist=hero?.activityId===squad.id;
   return {...squad,...base,isProtagonist,members:squad.members.map((member,memberIndex)=>({...member,x:base.x-15+(memberIndex%4)*10+(working?Math.sin(elapsed/900+memberIndex)*4:0),y:base.y+14+Math.floor(memberIndex/4)*12+(working?Math.cos(elapsed/1100+memberIndex)*3:0),walking:working&&motionEnabled(),direction:'down'}))};
  });
  const shownHero=heroScene||squadScenes.find(squad=>squad.isProtagonist);if(shownHero){root.dataset.heroX=shownHero.x.toFixed(1);root.dataset.heroY=shownHero.y.toFixed(1);const leader=shownHero.members.find(member=>member.isLeader)||shownHero.members[0]||shownHero;if(leaderPrevious){const dx=leader.x-leaderPrevious.x,dy=leader.y-leaderPrevious.y;if(Math.hypot(dx,dy)>.01)leaderHeading=Math.atan2(dx,-dy);}leaderPrevious={x:leader.x,y:leader.y};leader.heading=leaderHeading;leader.direction=['up','right','down','left'][((Math.round(leaderHeading/(Math.PI/2))%4)+4)%4];}else{delete root.dataset.heroX;delete root.dataset.heroY;}
 }
 function resize(){
  const width=frame.clientWidth,height=frame.clientHeight;if(!width||!height)return;
  dimensions={width,height};const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context?.setTransform(dpr,0,0,dpr,0,0);
  resizeInset();if(automaticZoom)fitIsland();draw();
 }
 function fitIsland(){const fitted=villageOverviewCamera(dimensions.width,dimensions.height);camera={x:fitted.x,y:fitted.y};zoom=fitted.zoom;}
 function draw(){
  if(!context||!visible||!dimensions.width||!dimensions.height)return;
  const {width,height}=dimensions,scale=Math.min(width/WORLD.width,height/WORLD.height)*zoom;
  updateTravel();
  const island=villageIsland(),halfWidth=width/(2*scale),halfHeight=height/(2*scale),bounds=island.seaBounds;
  camera.x=halfWidth*2>=bounds.right-bounds.left?(bounds.left+bounds.right)/2:clamp(camera.x,bounds.left+halfWidth,bounds.right-halfWidth);
  camera.y=halfHeight*2>=bounds.bottom-bounds.top?(bounds.top+bounds.bottom)/2:clamp(camera.y,bounds.top+halfHeight,bounds.bottom-halfHeight);
  empty.hidden=projection.residents.length>0||camera.x<0||camera.x>1000||camera.y<0||camera.y>640;
  root.dataset.cameraX=camera.x.toFixed(1);root.dataset.cameraY=camera.y.toFixed(1);root.dataset.zoom=zoom.toFixed(2);
  transform={scale,x:width/2-camera.x*scale,y:height/2-camera.y*scale};
  context.imageSmoothingEnabled=false;context.fillStyle=island.seaColor;context.fillRect(0,0,width,height);context.save();context.translate(transform.x,transform.y);context.scale(scale,scale);
  const viewport={left:-transform.x/scale,right:(width-transform.x)/scale,top:-transform.y/scale,bottom:(height-transform.y)/scale,zoom:scale};
  drawIslandWater(context,island,viewport);context.save();clipIslandLand(context,island);
  const distant=zoom<.35;
  drawVillageIslandBackground(context,island,{population:projection.residents.length,biomes:villageBiomes(),viewport});
  if(projection.residents.length>RESIDENT_LIMIT&&residentCameraCell!==Math.floor(camera.x/320)+':'+Math.floor(camera.y/320))refreshNearbyResidents();
  positions=shownResidents.map(residentPosition);updateSquadScenes();
  const actors=villageEncounterActors({residents:positions,hero:heroScene,squads:squadScenes,heading:leaderHeading,encounter});positions=actors.residents.map(person=>({...person,kind:'agent',identityFocused:person.conversationId===(speechId||selected)}));heroScene=actors.hero;squadScenes=actors.squads;leaderHeading=actors.heading;
  const delegateOwners=new Map(projection.residents.map(resident=>[resident.conversationId,resident]));
  const delegateParents=[...positions.map(person=>({...person,delegation:delegateOwners.get(person.conversationId)?.delegation,color:worldPersonColor(person)})),
   ...[...squadScenes,...(heroScene?[heroScene]:[])].flatMap(group=>group.members.map((person,index)=>({...person,
    delegation:delegateOwners.get(person.conversationId)?.delegation,color:worldPersonColor(person,{hero:group.isProtagonist,party:true,index,squadSeed:group.seed})})))];
  const delegates=villageDelegateActors(delegateParents);
  root.dataset.nativeSubagents=String(delegates.badges.reduce((count,badge)=>count+badge.count,0));root.dataset.renderedSubagents=String(delegates.helpers.length);
  latestScene=village3DScene({projects:projectSlots,residents:positions,population:projection.residents.length,hero:heroScene,squads:squadScenes,heading:leaderHeading,delegates,roads:semanticLayout?.roads||[],clearings:semanticLayout?.clearings||[]});
  if(encounter?.status==='talking')latestScene=villageEncounterSightline(latestScene,encounter.conversationId);
  if(encounter&&actors.person){root.dataset.encounterPersonHeading=String(actors.person.heading);root.dataset.encounterLeaderHeading=String(latestScene.leader.heading);root.dataset.encounterPose=JSON.stringify({person:{id:'resident:'+encounter.conversationId,x:actors.person.x,y:actors.person.y,heading:actors.person.heading},leader:latestScene.leader});root.dataset.encounterCamera=JSON.stringify(world3D?.getCameraState()||null);}
  if(insetVisible&&world3D)world3D.update(latestScene);drawVillageWorld(context,{time:elapsed,residents:positions,projects:projectSlots,population:projection.residents.length,selectedId:speechId||selected,squads:squadScenes,protagonist:heroScene,selectedSquadId,motion:canAnimate(),terrainVisible:!distant,delegates,roads:latestScene.roads,clearings:semanticLayout?.clearings||[]});
  if(heroGoal&&Math.hypot(heroGoal.x-heroPoint.x,heroGoal.y-heroPoint.y)>3){context.strokeStyle='#ffe8a0';context.lineWidth=2;context.beginPath();context.ellipse(heroGoal.x,heroGoal.y,10,5,0,0,Math.PI*2);context.stroke();}context.restore();drawIslandCoast(context,island);context.restore();
  const nextOverlay=[scale,transform.x,transform.y].join(':');if(overlaySignature!==nextOverlay){overlaySignature=nextOverlay;for(const [index,control]of Array.from(sites.children).entries()){const project=projectSlots[index],w=Math.max(48,104*scale),h=Math.max(52,112*scale);control.style.left=transform.x+project.x*scale-w/2+'px';control.style.top=transform.y+project.y*scale-h+12*scale+'px';control.style.width=w+'px';control.style.height=h+'px';}}
  const guides=[];
  for(const [index,entry]of Array.from(places.children).entries()){
   const place=VILLAGE_PLACES[index],x=transform.x+place.entrance.x*scale,y=transform.y+place.entrance.y*scale;
   entry.hidden=scale<.3||x<76||x>width-76||y<110||y>height-entranceBottomSpace()-56;entry.style.left=x+'px';entry.style.top=y+12+'px';
   const guide=wayfinding.children[index],vertical=(y<110||y>height-entranceBottomSpace()-56)&&Math.abs((y-height/2)/height)>Math.abs((x-width/2)/width),direction=vertical?(y<height/2?'up':'down'):(x<width/2?'left':'right');
   guide.hidden=scale<.3||!entry.hidden;guide.dataset.direction=direction;guide.textContent=({left:'← ',right:'',up:'↑ ',down:'↓ '}[direction])+place.shortName+(direction==='right'?' →':'');
   if(!guide.hidden)guides.push({guide,direction});
  }
  const compact=height<500;root.dataset.compactMap=String(compact);
  for(const {guide,direction}of guides){
   const peers=guides.filter(item=>item.direction===direction),index=peers.findIndex(item=>item.guide===guide);
   guide.style.right='auto';guide.style.left='auto';guide.style.transform='';guide.style.maxWidth='';
   if(compact){const index=guides.findIndex(item=>item.guide===guide);guide.style.left=(index+.5)*width/guides.length+'px';guide.style.top=(width<327?162:width<600?128:Math.max(145,height*.43))+'px';guide.style.transform='translateX(-50%)';guide.style.maxWidth=(width-24)/guides.length+'px';}
   else if(direction==='left'||direction==='right'){const spread=(peers.length-1)*56,top=clamp(height*.46-24,170+spread/2,height-190-spread/2);guide.style[direction]='8px';guide.style.top=top+(index-(peers.length-1)/2)*56+'px';}
   else{guide.style.left=width/2+(index-(peers.length-1)/2)*112+'px';guide.style.transform='translateX(-50%)';guide.style.top=(direction==='up'?(width<600?175:88):height-192)+'px';}
  }
  if(arrivalFocus){const entry=document.querySelector('#village-enter-'+arrivalFocus);if(entry&&!entry.hidden){entry.focus({preventScroll:true});arrivalFocus=null;}}
  zoomOut.disabled=zoom<=villageOverviewCamera(width,height).zoom+1e-8;zoomIn.disabled=zoom>=2.5;canvas.dataset.zoom=zoom.toFixed(2);
  for(const control of questSites.children){const scene=squadScenes.find(item=>item.id===control.dataset.villageQuest)||(control.dataset.villageQuest==='protagonist'?heroScene:null);control.hidden=!scene;control.dataset.selected=String(control.dataset.villageQuest===selectedSquadId);if(scene){control.style.left=transform.x+scene.x*scale-22+'px';control.style.top=transform.y+(scene.y-18)*scale-22+'px';}}
  if(encounter?.status==='talking'){
  const avoid=[],parent=frame.getBoundingClientRect();
  if(insetVisible){const box=inset.getBoundingClientRect();avoid.push({left:box.left-parent.left,right:box.right-parent.left,top:box.top-parent.top,bottom:box.bottom-parent.top});}
  const labelAreas=[...questSites.querySelectorAll('span')].map(node=>node.getBoundingClientRect()).filter(box=>box.width&&box.height)
   .map(box=>({left:box.left-parent.left,right:box.right-parent.left,top:box.top-parent.top,bottom:box.bottom-parent.top}));
  const focus=drawVillageConversationFocus(context,{person:actors.person,leader:latestScene.leader,
   name:encounter.name,transform,width,height,avoid:[...avoid,...labelAreas]});
  if(focus.length)root.dataset.encounterMarkers=JSON.stringify(focus.map(({actor,role,name,x,y,body,label})=>({id:actor.id||actor.conversationId,role,name,x,y,body,label})));
  else delete root.dataset.encounterMarkers;
  if(speechId&&!speech.hidden&&speechAnchor){const people=focus.length?focus:[speechAnchor,latestScene.leader].map(point=>({x:transform.x+point.x*scale,y:transform.y+point.y*scale}));
   const place=villageSpeechPlacement({width,height,bubbleWidth:speech.offsetWidth,bubbleHeight:Math.max(speech.offsetHeight,speech.scrollHeight+2),people,avoid,
    protectedAreas:focus.flatMap(marker=>[marker.body,marker.label])});speech.style.left=place.left+'px';speech.style.top=place.top+'px';speech.style.maxHeight=place.maxHeight+'px';}
  }else delete root.dataset.encounterMarkers;
 }
 function changeZoom(value){
  if(travel)travel.follow=false;automaticZoom=false;
  const overview=villageOverviewCamera(dimensions.width,dimensions.height),next=clamp(value,overview.zoom,2.5);
  if(next<zoom&&next<=overview.zoom)camera={x:overview.x,y:overview.y};
  zoom=next;draw();queueViewSave();
 }
 function tick(now){frameId=0;if(!canAnimate()){syncAnimation();return;}const delta=lastFrame?Math.min(80,now-lastFrame):0;lastFrame=now;elapsed+=delta;if(now-lastPaint>=32){lastPaint=now;draw();}frameId=requestAnimationFrame(tick);}
 function syncAnimation(){
  const reduced=media.matches||document.body.dataset.motion==='reduced';pause.disabled=reduced;pause.textContent=reduced?'静かな表示':locallyPaused?'動きを再開':'動きを止める';pause.setAttribute('aria-pressed',String(locallyPaused||reduced));
  const active=canAnimate();root.dataset.animated=String(active);if(active&&!frameId){lastFrame=0;frameId=requestAnimationFrame(tick);}else if(!active&&frameId){cancelAnimationFrame(frameId);frameId=0;lastFrame=0;}if(!active)draw();
 }
 const mapTarget=target=>target===canvas||Boolean(target.closest?.('.village-building,.village-quest-flag,.village-place'));
 frame.addEventListener('pointerdown',event=>{if(event.button!==0||!mapTarget(event.target))return;world3D?.setMode('leader');suppressMapClick=false;drag={id:event.pointerId,x:event.clientX,y:event.clientY,camera:{...camera},moved:false,ground:event.target===canvas};});
 frame.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>6&&!drag.moved){drag.moved=true;if(travel)travel.follow=false;frame.setPointerCapture(event.pointerId);}if(drag.moved){event.preventDefault();automaticZoom=false;camera={x:drag.camera.x-dx/transform.scale,y:drag.camera.y-dy/transform.scale};draw();}});
 frame.addEventListener('pointerup',event=>{if(!drag||drag.id!==event.pointerId)return;const {moved,ground}=drag;drag=null;if(frame.hasPointerCapture(event.pointerId))frame.releasePointerCapture(event.pointerId);if(moved){suppressMapClick=true;return;}if(!ground)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left-transform.x)/transform.scale,y=(event.clientY-rect.top-transform.y)/transform.scale;const groups=[...squadScenes,...(heroScene?[heroScene]:[])],partyHit=groups.flatMap(group=>group.members.map(member=>({id:group.id,member,distance:Math.hypot(member.x-x,member.y-9-y)}))).sort((a,b)=>a.distance-b.distance)[0];const nearest=positions.map(item=>({item,distance:Math.hypot(item.x-x,item.y-6-y)})).sort((a,b)=>a.distance-b.distance)[0];if(partyHit?.distance<Math.max(12,14/transform.scale)&&partyHit.distance<(nearest?.distance??Infinity)){if(partyHit.member.conversationId&&!isControlledLeader(partyHit.member))openSpeech(partyHit.member.conversationId);else selectSquad(partyHit.id);return;}if(nearest?.distance<Math.max(15,20/transform.scale))openSpeech(nearest.item.conversationId);else moveHero(x,y);});
 frame.addEventListener('click',event=>{if(suppressMapClick){event.preventDefault();event.stopImmediatePropagation();suppressMapClick=false;}},true);
 frame.addEventListener('pointercancel',()=>{drag=null;});
 frame.addEventListener('wheel',event=>{
  if(!mapTarget(event.target))return;event.preventDefault();if(travel)travel.follow=false;automaticZoom=false;
  if(event.ctrlKey){changeZoom(zoom*Math.exp(-event.deltaY*.003));return;}
  const unit=event.deltaMode===1?16:event.deltaMode===2?dimensions.height:1;
  camera.x+=(event.deltaX+(event.shiftKey?event.deltaY:0))*unit/transform.scale;camera.y+=(event.shiftKey?0:event.deltaY)*unit/transform.scale;draw();
 },{passive:false});
 canvas.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();find.click();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();if(travel)travel.follow=false;camera.x+=event.key==='ArrowLeft'?-60:event.key==='ArrowRight'?60:0;camera.y+=event.key==='ArrowUp'?-60:event.key==='ArrowDown'?60:0;draw();}else if(['w','a','s','d'].includes(event.key.toLowerCase())){event.preventDefault();const key=event.key.toLowerCase();world3D?.setMode('leader');moveHero(heroPoint.x+(key==='a'?-60:key==='d'?60:0),heroPoint.y+(key==='w'?-60:key==='s'?60:0));}});
 questPeek.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeQuestPeek();}});
 speech.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSpeech();}});
 const observer=new ResizeObserver(resize);observer.observe(frame);const insetObserver=new ResizeObserver(resizeInset);insetObserver.observe(canvas3D);
 const modalObserver=new MutationObserver(syncAnimation);modalObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
 const motionChanged=()=>{world3D?.setVisible(visible&&insetVisible&&!document.hidden);syncAnimation();};media.addEventListener('change',motionChanged);addEventListener('chat-ui-motion',motionChanged);document.addEventListener('visibilitychange',motionChanged);
 function render(){
  if(!visible||disposed)return;
  if(performance.now()-lastProjection>220){clearTimeout(projectionTimer);projectionTimer=0;updateProjection();}
  else if(!projectionTimer)projectionTimer=setTimeout(()=>{projectionTimer=0;if(visible)updateProjection();},230);
 }
 function setVisible(value,{preserveEncounter=false}={}){const next=Boolean(value);root.hidden=!next;if(next===visible){if(next)render();else if(!preserveEncounter)endEncounter({redraw:false});return;}visible=next;world3D?.setVisible(visible&&insetVisible&&!document.hidden);if(!visible){saveView();cancelTravel();clearTimeout(projectionTimer);projectionTimer=0;if(detail.open)detail.close();closeSpeech(false,{preserveEncounter});syncAnimation();return;}updateProjection();if(!insetInitialized)setInsetVisible(insetVisible);resize();syncAnimation();}
 function focus(){title.focus({preventScroll:true});root.scrollIntoView({block:'start'});}
 function dispose(){saveView();disposed=true;visible=false;endEncounter({redraw:false});clearTimeout(projectionTimer);if(frameId)cancelAnimationFrame(frameId);world3D?.destroy();observer.disconnect();insetObserver.disconnect();modalObserver.disconnect();media.removeEventListener('change',motionChanged);removeEventListener('chat-ui-motion',motionChanged);document.removeEventListener('visibilitychange',motionChanged);detail.remove();}
 addEventListener('pagehide',dispose,{once:true});
 return {render,setVisible,focus,dispose,getEncounter,endEncounter,saveView};
}
