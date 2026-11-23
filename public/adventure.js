import {ui as localize} from './interface-language.js';
import {adventureRegions,adventureProgress} from './adventure-world.js';
import {characterIcon} from './character-appearance.js';

const node=(tag,value,className)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
const activeStatuses=['starting','running','stopping','paused'];
const titles=[localize('旅のはじまり', "The journey begins"),localize('仲間と歩く冒険者', "Adventurer traveling with companions"),localize('知識をつなぐ探求者', "Seeker connecting knowledge"),localize('海を渡る開拓者', "Explorer crossing the sea")];
const scenes={
 village:['M7 32L22 18L37 32V52H7Z','M17 52V38H27V52','M35 23L48 12L61 23V46H37','M46 46V32H53V46'],
 forest:['M9 41L23 16L37 41Z','M23 41V54','M34 36L48 9L62 36Z','M48 36V51','M1 54Q30 43 66 55'],
 library:['M5 15Q20 10 33 20Q46 10 61 15V49Q46 44 33 54Q20 44 5 49Z','M33 20V54','M12 23L25 26M12 31L25 34M41 26L54 23M41 34L54 31'],
 harbor:['M8 40H60L50 52H19Z','M34 8V40','M30 12L12 35H30Z','M39 17L54 35H39Z','M3 58Q12 52 21 58Q30 64 39 58Q48 52 63 58']
};
function landmark(id){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 68 68');svg.setAttribute('aria-hidden','true');svg.classList.add('adventure-landmark');
 for(const [index,path] of (scenes[id]||[]).entries()){const item=document.createElementNS(ns,'path');item.setAttribute('d',path);if(index===0)item.classList.add('adventure-landmark-fill');svg.append(item);}
 return svg;
}

export function initAdventure({api,demo=false,getState,getChats,getModel,onState,onProgress,onTown,notify=()=>{}}){
 const root=document.querySelector('#adventure-world');
 if(!root)return {render(){}};
 root.classList.add('adventure-world');root.setAttribute('aria-labelledby','adventure-title');
 const storeKey=demo?'chat-ui-demo-adventure-drafts':'chat-ui-adventure-drafts';
 let saved={};try{const value=JSON.parse(localStorage.getItem(storeKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
 const drafts=new Map(adventureRegions.map(region=>{const draft=saved[region.id];return [region.id,{text:typeof draft?.text==='string'?draft.text:region.prompt,sourceA:typeof draft?.sourceA==='string'?draft.sourceA:'',sourceB:typeof draft?.sourceB==='string'?draft.sourceB:''}];}));
 let selected=null,formRegion=null,busy=false,error='',notice='',candidateKey='',journalKey='',rosterKey='';
 const regionButtons=new Map();
 const heading=node('div',undefined,'adventure-heading'),headingCopy=node('div');
 const title=node('h3',localize('冒険をはじめよう', "Start an adventure"));title.id='adventure-title';title.tabIndex=-1;
 const lead=node('p',localize('依頼を書いて、仲間に任せましょう。', "Write a request and give it to your companions."));lead.id='adventure-lead';headingCopy.append(title,lead);
 const badge=node('div',undefined,'adventure-level-badge'),level=node('strong');level.id='adventure-level';
 const rank=node('span');rank.id='adventure-rank';badge.append(level,rank);heading.append(headingCopy,badge);
 const journey=node('ol',undefined,'adventure-journey');journey.id='adventure-journey';journey.setAttribute('aria-label',localize('冒険の流れ', "How adventures work"));
 for(const [index,label] of [localize('依頼を書く', "Write a request"),localize('仲間に任せる', "Assign your party"),localize('成果を受け取る', "Collect the result")].entries()){const step=node('li');step.dataset.journeyStep=String(index+1);step.append(node('span',String(index+1)),node('strong',label));journey.append(step);}
 const growth=node('div',undefined,'adventure-growth'),growthText=node('p');growthText.id='adventure-growth-text';
 const milestones=node('div',undefined,'adventure-milestones');milestones.setAttribute('aria-hidden','true');for(const region of adventureRegions){const marker=node('span');marker.dataset.milestone=region.id;milestones.append(marker);}growth.append(growthText,milestones);
 const route=node('nav',undefined,'adventure-route');route.setAttribute('aria-label',localize('冒険で訪れる地域', "Adventure regions"));
 for(const region of adventureRegions){
  const button=node('button',undefined,'adventure-region');button.type='button';button.dataset.adventureRegion=region.id;button.setAttribute('aria-controls','adventure-detail');
  const scene=node('span',undefined,'adventure-region-scene');scene.append(landmark(region.id));
  const state=node('span',undefined,'adventure-region-state');state.dataset.regionState=region.id;
  const name=node('strong',region.name),ability=node('small',region.ability);button.append(scene,state,name,ability);
  button.onclick=()=>{selected=region.id;error='';render();focusTask();};route.append(button);regionButtons.set(region.id,{button,state});
 }
 const feedback=node('p',undefined,'adventure-notice');feedback.id='adventure-notice';feedback.hidden=true;feedback.setAttribute('role','status');
 const failure=node('p',undefined,'adventure-error');failure.id='adventure-error';failure.hidden=true;failure.setAttribute('role','alert');
 const detail=node('div',undefined,'adventure-detail');detail.id='adventure-detail';
 const intro=node('div',undefined,'adventure-intro'),chapter=node('span',undefined,'adventure-eyebrow');chapter.id='adventure-chapter';
 const detailTitle=node('h4');detailTitle.id='adventure-detail-title';detailTitle.tabIndex=-1;const description=node('p');description.id='adventure-description';
 const capability=node('p',undefined,'adventure-capability');capability.id='adventure-capability';
 const reward=node('p',undefined,'adventure-reward');reward.id='adventure-reward';
 const guide=node('div',undefined,'adventure-guide');guide.id='adventure-companion-summary';const guideAvatar=node('span',undefined,'adventure-guide-avatar'),guideName=node('span');guideName.id='adventure-guide-name';guide.append(guideAvatar,guideName);
 const chapterCopy=node('div',undefined,'adventure-chapter-copy');chapterCopy.append(chapter,detailTitle);
 const worldScene=node('div',undefined,'adventure-world-scene');worldScene.setAttribute('aria-hidden','true');intro.append(guide,chapterCopy,worldScene);
 const lock=node('div',undefined,'adventure-lock');lock.id='adventure-lock';const lockText=node('p');lockText.id='adventure-lock-text';
 const next=node('button',localize('今できる冒険を見る →', "See available adventures →"),'outline');next.id='adventure-next';next.type='button';next.onclick=()=>{selected=progress().nextRegionId||adventureRegions[0].id;error='';render();focusTask();};lock.append(lockText,next);
 const form=node('form');form.id='adventure-form';
 const taskLabel=node('label',localize('何を手伝ってほしい？', "What would you like help with?"));taskLabel.htmlFor='adventure-task';
 const task=node('textarea');task.id='adventure-task';task.rows=3;task.maxLength=2400;task.required=true;task.setAttribute('aria-describedby','adventure-readiness');
 const sources=node('div',undefined,'adventure-sources');sources.id='adventure-sources';
 const sourceInputs=[];
 for(const [key,label] of [['a',localize('資料 A', "Source A")],['b',localize('資料 B', "Source B")]]){const group=node('div'),caption=node('label',label);caption.htmlFor='adventure-source-'+key;const field=node('textarea');field.id=caption.htmlFor;field.rows=3;field.maxLength=1800;field.placeholder=localize('比較したい資料の本文を貼り付ける（1800文字以内）', "Paste the text to compare (up to 1,800 characters)");group.append(caption,field);sources.append(group);sourceInputs.push(field);}
 const roster=node('div',undefined,'adventure-roster');roster.id='adventure-roster';roster.setAttribute('aria-label',localize('この冒険の仲間と役割', "Companions and roles"));
 const actions=node('div',undefined,'adventure-actions'),start=node('button',localize('この依頼で冒険をはじめる →', "Begin this adventure →"),'primary');start.id='adventure-start';start.type='submit';
 const demoConnect=node('a',localize('接続して冒険をはじめる →', "Connect to begin →"),'adventure-connect primary');demoConnect.id='adventure-demo-connect';demoConnect.href='/';demoConnect.hidden=!demo;actions.append(start,demoConnect);
 const readiness=node('p',undefined,'adventure-readiness');readiness.id='adventure-readiness';
 const preparation=node('details',undefined,'adventure-preparation');preparation.id='adventure-preparation';
 const preparationLabel=node('summary',localize('仲間と進め方を見る', "See companions and approach"));preparationLabel.id='adventure-preparation-label';preparation.append(preparationLabel,description,capability,roster);
 form.append(taskLabel,task,sources,actions,readiness);detail.append(intro,lock,form,reward,preparation);
 const underway=node('section',undefined,'adventure-underway');underway.id='adventure-underway';
 const underwayTitle=node('h4',localize('仲間が依頼に取り組んでいます', "Your companions are working on the quest"));underwayTitle.id='adventure-underway-title';underwayTitle.tabIndex=-1;
 const underwayText=node('p');underwayText.id='adventure-underway-text';
 const liveSteps=node('ol',undefined,'adventure-live-steps');liveSteps.id='adventure-live-steps';
 const runHint=node('p',localize('終わると、この場所に成果が表示されます。', "The result will appear here when they finish."),'adventure-run-hint');
 const progressButton=node('button',localize('進み具合・停止・再開を見る', "View progress, stop or resume"),'outline');progressButton.id='adventure-progress';progressButton.type='button';progressButton.onclick=()=>onProgress?.();underway.append(underwayTitle,underwayText,liveSteps,runHint,progressButton);
 const candidate=node('section',undefined,'adventure-candidate');candidate.id='adventure-candidate';candidate.hidden=true;candidate.setAttribute('aria-labelledby','adventure-candidate-title');
 const candidateTitle=node('h4',localize('成果が届きました', "Your result is ready"));candidateTitle.id='adventure-candidate-title';candidateTitle.tabIndex=-1;
 const candidateCaption=node('p');candidateCaption.id='adventure-candidate-caption';
 const output=node('pre');output.id='adventure-output';output.tabIndex=0;output.setAttribute('aria-label',localize('持ち帰った成果', "The party's result"));
 const truncation=node('p',undefined,'adventure-truncation');truncation.id='adventure-output-truncation';truncation.hidden=true;
 const candidateActions=node('div',undefined,'adventure-actions'),accept=node('button',localize('この成果で次へ進む →', "Accept the result and continue →"),'primary'),discard=node('button',localize('依頼を見直す', "Review the request"),'outline');
 accept.id='adventure-accept';discard.id='adventure-discard';accept.type=discard.type='button';candidateActions.append(accept,discard);
 candidate.append(candidateTitle,candidateCaption,output,candidateActions,truncation,node('p',localize('依頼に応えられていたら、成果を受け取って次へ進みましょう。', "Read your result. If it meets your goal, accept it to continue."),'adventure-adoption-help'));
 const journal=node('details',undefined,'adventure-journal');journal.id='adventure-journal';const journalHeading=node('summary');journalHeading.id='adventure-journal-heading';const journalItems=node('div');journalItems.id='adventure-journal-items';journal.append(journalHeading,journalItems);
 const directAccess=node('div',undefined,'adventure-direct-access');directAccess.append(node('p',localize('装備を変えたり、仲間を選びたいときは。', "Change equipment or choose companions in town.")));
 const townAccess=node('button',localize('街のお店・お城へ ↓', "Visit the shops and castle ↓"),'outline');townAccess.id='adventure-town-access';townAccess.type='button';
 townAccess.onclick=()=>{if(onTown)return onTown();const map=document.querySelector('.town-map');map?.scrollIntoView({block:'start'});map?.querySelector('[data-town-destination]')?.focus({preventScroll:true});};directAccess.append(townAccess);
 const stage=node('div',undefined,'adventure-stage');stage.id='adventure-stage';stage.append(feedback,failure,detail,underway,candidate);
 const world=node('section',undefined,'adventure-map-section');world.setAttribute('aria-labelledby','adventure-map-title');
 const mapTitle=node('h4',localize('世界を広げよう', "Explore the world"));mapTitle.id='adventure-map-title';world.append(mapTitle,growth,route);
 root.replaceChildren(heading,journey,stage,world,journal,directAccess);

 function current(){return demo?{completed:[],journal:[],active:null,candidate:null}:getState()?.adventure||{completed:[],journal:[],active:null,candidate:null};}
 function progress(){return adventureProgress(current());}
 function focusTask(){
  const target=!candidate.hidden?candidateTitle:!underway.hidden?underwayTitle:detailTitle;
  target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});
 }
 function persistDraft(){try{localStorage.setItem(storeKey,JSON.stringify(Object.fromEntries(drafts)));}catch{}}
 function changedDraft(){if(!formRegion)return;drafts.set(formRegion,{text:task.value,sourceA:sourceInputs[0].value,sourceB:sourceInputs[1].value});persistDraft();error='';render();}
 task.oninput=changedDraft;sourceInputs.forEach(field=>field.oninput=changedDraft);
 function reason(region,value,state){
  if(demo)return localize('画面のお試し中です。実際の依頼にはCodexへの接続が必要です。', "This is the preview. Connect to Codex to start a real quest.");
  if(busy)return localize('出発の準備、または成果の記録中です…', "Preparing the party or saving results…");
  if(region.level>progress().level)return 'Lv.'+region.level+localize('で、この地域への道がひらきます。', " unlocks this region.");
  if(value.candidate)return localize('届いた成果を読んで、受け取るか依頼を見直してください。', "Read the result and accept it or revise your quest.");
  if(activeStatuses.includes(value.active?.status)||['running','stopping','paused'].includes(state.party?.quest?.status))return localize('進行中の冒険があります。仲間の行動を確認してから次の依頼へ進みましょう。', "An adventure is underway. Check your party's progress before the next quest.");
  if(state.active)return localize('ほかの処理が進行中です。完了後に出発できます。', "Another action is underway. Depart once it is complete.");
  if(!state.connected||state.account?.type!=='chatgpt'||state.login)return localize('Codexに接続してから出発できます。', "Connect to Codex to depart.");
  if(state.policy?.ok===false)return state.policy.reason||localize('利用枠を確認してください。', "Check your remaining quota.");
  if(!getModel()?.model)return localize('出発に使うモデルを選んでください。', "Choose a model to depart.");
  if(getChats().length<region.roles.length)return localize('この冒険には', "This adventure needs ")+region.roles.length+localize('人の仲間が必要です。チャットを追加してください。', " companions. Add more chats.");
  if(!task.value.trim())return localize('今回かなえたいことを入力してください。', "Describe the goal for this adventure.");
  if(region.requiresSources&&sourceInputs.some(field=>!field.value.trim()))return localize('比較する資料 A と資料 B の本文を入力してください。', "Paste the text of both sources to compare them.");
  return '';
 }
 function renderRoster(region){
  const chats=getChats().slice(0,region.roles.length),key=JSON.stringify([region.id,chats.map(chat=>[chat.id,chat.characterName,chat.title])]);if(key===rosterKey)return;rosterKey=key;
  roster.replaceChildren();preparationLabel.textContent=localize('仲間', "Companions")+region.roles.length+localize('人と進め方を見る', " companions and their approach");
  guideAvatar.replaceChildren(characterIcon(region.roles[0],'adventure-guide-character'));guideName.textContent=chats.length?(region.roles.length===1?(chats[0].characterName||chats[0].title):region.roles.length+localize('人の仲間', " companions")):localize('仲間を追加', "Add companions");worldScene.dataset.region=region.id;
  const members=node('ol');
  region.roles.forEach((role,index)=>{const chat=chats[index],row=node('li');row.append(characterIcon(role,'adventure-companion'));const copy=node('span');copy.append(node('strong',chat?.characterName||chat?.title||localize('仲間を追加', "Add companions")),node('small',role));row.append(copy);members.append(row);});roster.append(members);
 }
 function renderJournal(value){
  const entries=value.journal||[],key=JSON.stringify(entries);journalHeading.textContent=localize('冒険の書 · ', "Adventure log · ")+entries.length+localize('件の成果', " results");
  if(key===journalKey)return;journalKey=key;journalItems.replaceChildren();
  if(!entries.length){journalItems.append(node('p',localize('採用した成果と、一緒に冒険した仲間がここに残ります。', "Accepted results and their companions are recorded here.")));return;}
  for(const entry of [...entries].reverse()){
   const region=adventureRegions.find(item=>item.id===entry.regionId),row=node('details');row.dataset.adventureJournal=entry.questId;
   row.append(node('summary',(region?.name||localize('冒険', "Adventure"))+' · '+entry.title));
   const date=Number.isFinite(entry.acceptedAt)?new Date(entry.acceptedAt).toLocaleString('ja-JP'):'';
   row.append(node('p',date+(date?' · ':'')+(entry.roles||[]).map(role=>role.name+'（'+role.role+'）').join(' → ')),node('pre',entry.output||''));
   if(entry.truncated||entry.sourcesTruncated)row.append(node('p',truncationNote(entry),'adventure-truncation'));
   journalItems.append(row);
  }
 }
 function render(){
  const value=current(),state=getState()||{},status=progress();
  if(!selected)selected=value.candidate?.regionId||value.active?.regionId||status.nextRegionId||adventureRegions[0].id;
  const region=adventureRegions.find(item=>item.id===selected)||adventureRegions[0],unlocked=region.level<=status.level;
  const nextRegion=adventureRegions.find(item=>item.id===status.nextRegionId),completed=status.completed||[],allComplete=completed.length===adventureRegions.length;
  root.dataset.level=String(status.level);root.dataset.complete=String(allComplete);level.textContent='Lv.'+status.level;rank.textContent=allComplete?localize('全地方踏破', "All regions explored"):titles[status.level-1]||titles.at(-1);
  growthText.textContent=allComplete?localize('すべての土地へ行けます。好きな進め方で次の依頼へ。', "Every region is open. Choose how to approach the next request."):nextRegion?'「'+nextRegion.name+localize('」の成果を受け取ると、冒険が進みます。', "” to continue your adventure."):localize('好きな土地から、新しい依頼へ。', "Start another adventure in any region.");
  for(const marker of milestones.children)marker.dataset.complete=String(completed.includes(marker.dataset.milestone));
  for(const item of adventureRegions){const ui=regionButtons.get(item.id),done=completed.includes(item.id),locked=item.level>status.level,active=value.active?.regionId===item.id&&activeStatuses.includes(value.active.status);ui.button.dataset.status=locked?'locked':done?'completed':active?'active':'available';ui.button.setAttribute('aria-pressed',String(item.id===region.id));ui.button.disabled=busy;ui.state.textContent=locked?'Lv.'+item.level+localize(' · 未踏', " · Unexplored"):active?localize('冒険中', "On a quest"):done?localize('踏破済み', "Explored"):'Lv.'+item.level+localize(' · 出発できる', " · Ready to depart");ui.button.setAttribute('aria-label',item.name+'、'+ui.state.textContent+'、'+item.ability);}
  chapter.textContent=region.name;detailTitle.textContent=region.title;description.textContent=region.description;capability.textContent=localize('できること：', "Ability: ")+region.ability;
  const following=adventureRegions[region.level];reward.textContent=completed.includes(region.id)?localize('何度でも、この仲間たちに新しい依頼を任せられます。', "These companions can take on more quests at any time."):following?localize('成果を受け取ると → ', "Accept the result to unlock → ")+following.name+localize('で', " at ")+following.ability: localize('成果を受け取ると、全地方踏破！', "Accept the result to complete all regions!");
  lock.hidden=unlocked;form.hidden=!unlocked;preparation.hidden=!unlocked;reward.hidden=!unlocked;lockText.textContent=localize('ここでは', "Here you can ")+region.ability+localize('ができます。', ".")+(adventureRegions[region.level-2]?.name?'「'+adventureRegions[region.level-2].name+localize('」の成果を受け取ると、Lv.', "” to open the way at level ")+region.level+localize('で道が開きます。', "."):'');
  if(formRegion!==region.id){formRegion=region.id;const draft=drafts.get(region.id);task.value=draft.text;sourceInputs[0].value=draft.sourceA;sourceInputs[1].value=draft.sourceB;}
  sources.hidden=!region.requiresSources;for(const field of sourceInputs){field.required=region.requiresSources;field.readOnly=busy;field.disabled=!region.requiresSources;}
  task.readOnly=busy;renderRoster(region);
  const blocked=reason(region,value,state);start.disabled=Boolean(blocked);start.hidden=demo;start.textContent=busy?localize('準備中…', "Preparing…"):localize('この依頼で冒険をはじめる →', "Begin this adventure →");readiness.textContent=blocked||localize('出発するとChatGPTの利用枠を使います。', "Departing uses your ChatGPT quota.");
  const active=value.active,quest=state.party?.quest,matching=active?.questId&&quest?.id===active.questId;
  const running=active&&activeStatuses.includes(active.status);
  underway.hidden=!running||Boolean(value.candidate);progressButton.disabled=!onProgress||!matching;
  detail.hidden=Boolean(value.candidate)||Boolean(running);
  root.dataset.phase=value.candidate?'result':running?'running':'ready';
  const journeyStep=value.candidate?3:running?2:1;for(const step of journey.children){const current=Number(step.dataset.journeyStep)===journeyStep;step.dataset.current=String(current);if(current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');}
  title.textContent=value.candidate?localize('成果を受け取ろう', "Collect your result"):running?localize('仲間におまかせ中', "Your companions are working"):localize('冒険をはじめよう', "Start an adventure");
  lead.textContent=value.candidate?localize('内容を確かめて、次の土地へ。', "Review the result and explore the next region."):running?localize('終わると、ここに成果が届きます。', "The result will appear here when ready."):localize('依頼を書いて、仲間に任せましょう。', "Write a request and give it to your companions.");
  if(active){const place=adventureRegions.find(item=>item.id===active.regionId),step=matching?quest.steps?.find(item=>item.status==='running'):null;const labels={starting:localize('出発の準備中', "Preparing to depart"),running:localize('冒険中', "On a quest"),stopping:localize('停止を待っています', "Waiting for the party to stop"),paused:localize('冒険を中断中', "Adventure paused"),cancelled:localize('冒険を終了しました', "Adventure ended"),completed:localize('成果を確認できます', "Result ready")};underwayText.textContent=(place?.name||localize('冒険', "Adventure"))+' · '+(step?step.role+localize('が行動中', " is working"):labels[active.status]||localize('進行を確認してください', "Check progress"));underwayTitle.textContent=active.status==='paused'?localize('冒険が途中で止まっています', "This adventure is paused"):active.status==='stopping'?localize('停止を待っています', "Waiting for the party to stop"):localize('仲間が依頼に取り組んでいます', "Your companions are working on the quest");runHint.textContent=active.status==='paused'?localize('進み具合を開いて、再開するか依頼を終了できます。', "Open progress to resume or end the quest."):localize('終わると、この場所に成果が表示されます。', "The result will appear here when they finish.");
   const rows=matching?quest.steps||[]:[],key=JSON.stringify(rows.map(item=>[item.id,item.title,item.role,item.status]));
   if(liveSteps.dataset.key!==key){liveSteps.dataset.key=key;liveSteps.replaceChildren(...rows.map(item=>{const row=node('li');row.dataset.status=item.status;row.append(node('strong',item.title),node('span',item.role),node('span',({pending:localize('順番待ち', "Waiting"),running:localize('取り組み中', "Working"),completed:localize('完了', "Complete"),blocked:localize('確認が必要', "Needs attention"),failed:localize('中断', "Paused"),interrupted:localize('中断', "Paused")})[item.status]||item.status,'adventure-step-state'));return row;}));}
  }
  const result=value.candidate;candidate.hidden=!result;
  if(result){const place=adventureRegions.find(item=>item.id===result.regionId);candidateCaption.textContent=(result.truncated||result.sourcesTruncated?localize('一部表示 · ', "Excerpt · "):'')+(place?.name||localize('冒険', "Adventure"))+' · '+result.title;candidateCaption.title=candidateCaption.textContent;const key=result.questId+'\n'+result.output;if(candidateKey!==key){candidateKey=key;output.textContent=result.output||'';output.scrollTop=0;}truncation.hidden=!result.truncated&&!result.sourcesTruncated;truncation.textContent=truncationNote(result);const first=!completed.includes(result.regionId);accept.textContent=first&&status.level<adventureRegions.length?localize('成果を受け取って次の土地へ →', "Collect the result and continue →"):first?localize('成果を受け取って全地方踏破！', "Collect the result and complete all regions!"):localize('この成果を受け取る', "Collect this result");accept.disabled=busy||demo;discard.disabled=busy||demo;}
  feedback.hidden=!notice;feedback.textContent=notice;failure.hidden=!error;failure.textContent=error;renderJournal(value);
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(start.disabled||busy||demo)return;
  const region=adventureRegions.find(item=>item.id===selected),draft={...drafts.get(region.id)};
  busy=true;error='';notice='';render();
  try{const result=await api('adventure/start',{regionId:region.id,...draft,...getModel()});onState(result);notice='';}
  catch(reason){error=reason.message||localize('出発できませんでした。', "Could not depart.");}
  finally{busy=false;render();if(!error&&root.getClientRects().length)focusTask();}
 };
 function truncationNote(result){return [result.truncated?localize('最終成果の表示は一部が省略されています。', "The final result is truncated."):'',result.sourcesTruncated?localize('仲間から引き継いだ成果に省略が含まれます。', "Some results passed between companions were truncated."):'',result.truncated||result.sourcesTruncated?localize('元の会話で全文を確認できます。', "Open the original conversation for the full text."):''].join('');}
 async function finish(action){
  const candidate=current().candidate;if(!candidate||busy||demo)return;
  const before=progress(),region=adventureRegions.find(item=>item.id===candidate.regionId);let focusRegion=false;busy=true;error='';notice='';render();
  try{
   const result=await api('adventure/'+action,{questId:candidate.questId});onState(result);
   if(action==='accept'){
    focusRegion=true;
    const after=adventureProgress(result),newRegion=adventureRegions.find(item=>item.level===after.level);
    if(after.level>before.level){selected=newRegion.id;focusRegion=true;notice='LEVEL UP! Lv.'+after.level+' · '+newRegion.name+localize('への道がひらきました。', " is now open.")+newRegion.ability+localize('を使って、次の冒険へ。', " is ready for your next adventure.");}
    else if((after.completed||[]).length===adventureRegions.length&&!(before.completed||[]).includes(candidate.regionId)){notice=localize('全地方踏破！ すべての戦法がそろいました。好きな地域で、新しい依頼に挑めます。', "All regions explored! Every strategy is available. Start a new quest in any region.");}
    else notice=(region?.name||localize('冒険', "Adventure"))+localize('の成果を、冒険の書に記しました。', " has been added to the adventure log.");
    notify(notice);
   }else{selected=candidate.regionId;notice=localize('依頼を調整して、もう一度出発できます。', "Revise your quest and depart again.");}
  }catch(reason){error=reason.message||localize('成果を記録できませんでした。', "Could not save the result.");}
  finally{busy=false;render();if(focusRegion&&root.getClientRects().length){const button=regionButtons.get(selected)?.button;button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest',inline:'nearest'});}}
 }
 accept.onclick=()=>finish('accept');discard.onclick=()=>finish('discard');
 function focusCurrent(){
  const value=current();selected=value.candidate?.regionId||(activeStatuses.includes(value.active?.status)?value.active.regionId:null)||progress().nextRegionId||selected||adventureRegions[0].id;
  render();root.scrollIntoView({block:'start'});const target=!candidate.hidden?candidateTitle:!underway.hidden?underwayTitle:detailTitle;target.focus({preventScroll:true});
 }
 return {render,focusCurrent};
}
