import {questText} from './i18n-quests.js';
import {getLocale, onLocaleChange} from './i18n.js';
import {adventureRegionsFor,adventureProgress} from './adventure-world.js';
import {characterIcon} from './character-appearance.js';

const node=(tag,value,className)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
const activeStatuses=['starting','running','stopping','paused'];
const titles=()=>[questText('旅のはじまり'),questText('仲間と歩く冒険者'),questText('知識をつなぐ探求者'),questText('海を渡る開拓者')];
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
 let adventureRegions=adventureRegionsFor(getLocale());
 const drafts=new Map(adventureRegions.map(region=>{const draft=saved[region.id];return [region.id,{defaultPrompt:draft?.defaultPrompt===true||typeof draft?.text!=='string',text:draft?.defaultPrompt!==true&&typeof draft?.text==='string'?draft.text:region.prompt,sourceA:typeof draft?.sourceA==='string'?draft.sourceA:'',sourceB:typeof draft?.sourceB==='string'?draft.sourceB:''}];}));
 let selected=null,formRegion=null,busy=false,error='',notice='',candidateKey='',journalKey='',rosterKey='';
 const regionButtons=new Map();
 const heading=node('div',undefined,'adventure-heading'),headingCopy=node('div');
 const title=node('h3',questText('冒険をはじめよう'));title.id='adventure-title';title.tabIndex=-1;
 const lead=node('p',questText('依頼を書いて、仲間に任せましょう。'));lead.id='adventure-lead';headingCopy.append(title,lead);
 const badge=node('div',undefined,'adventure-level-badge'),level=node('strong');level.id='adventure-level';
 const rank=node('span');rank.id='adventure-rank';badge.append(level,rank);heading.append(headingCopy,badge);
 const journey=node('ol',undefined,'adventure-journey');journey.id='adventure-journey';journey.setAttribute('aria-label',questText('冒険の流れ'));
 for(const [index,label] of [questText('依頼を書く'),questText('仲間に任せる'),questText('成果を受け取る')].entries()){const step=node('li');step.dataset.journeyStep=String(index+1);step.append(node('span',String(index+1)),node('strong',label));journey.append(step);}
 const growth=node('div',undefined,'adventure-growth'),growthText=node('p');growthText.id='adventure-growth-text';
 const milestones=node('div',undefined,'adventure-milestones');milestones.setAttribute('aria-hidden','true');for(const region of adventureRegions){const marker=node('span');marker.dataset.milestone=region.id;milestones.append(marker);}growth.append(growthText,milestones);
 const route=node('nav',undefined,'adventure-route');route.setAttribute('aria-label',questText('冒険で訪れる地域'));
 for(const region of adventureRegions){
  const button=node('button',undefined,'adventure-region');button.type='button';button.dataset.adventureRegion=region.id;button.setAttribute('aria-controls','adventure-detail');
  const scene=node('span',undefined,'adventure-region-scene');scene.append(landmark(region.id));
  const state=node('span',undefined,'adventure-region-state');state.dataset.regionState=region.id;
  const name=node('strong',region.name),ability=node('small',region.ability);button.append(scene,state,name,ability);
  button.onclick=()=>{selected=region.id;error='';render();focusTask();};route.append(button);regionButtons.set(region.id,{button,state,name,ability});
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
 const next=node('button',questText('今できる冒険を見る →'),'outline');next.id='adventure-next';next.type='button';next.onclick=()=>{selected=progress().nextRegionId||adventureRegions[0].id;error='';render();focusTask();};lock.append(lockText,next);
 const form=node('form');form.id='adventure-form';
 const taskLabel=node('label',questText('何を手伝ってほしい？'));taskLabel.htmlFor='adventure-task';
 const task=node('textarea');task.id='adventure-task';task.rows=3;task.maxLength=2400;task.required=true;task.setAttribute('aria-describedby','adventure-readiness');
 const sources=node('div',undefined,'adventure-sources');sources.id='adventure-sources';
 const sourceInputs=[];
 for(const [key,label] of [['a',questText('資料 A')],['b',questText('資料 B')]]){const group=node('div'),caption=node('label',label);caption.htmlFor='adventure-source-'+key;const field=node('textarea');field.id=caption.htmlFor;field.rows=3;field.maxLength=1800;field.placeholder=questText('比較したい資料の本文を貼り付ける（1800文字以内）');group.append(caption,field);sources.append(group);sourceInputs.push(field);}
 const roster=node('div',undefined,'adventure-roster');roster.id='adventure-roster';roster.setAttribute('aria-label',questText('この冒険の仲間と役割'));
 const actions=node('div',undefined,'adventure-actions'),start=node('button',questText('この依頼で冒険をはじめる →'),'primary');start.id='adventure-start';start.type='submit';
 const demoConnect=node('a',questText('接続して冒険をはじめる →'),'adventure-connect primary');demoConnect.id='adventure-demo-connect';demoConnect.href='/';demoConnect.hidden=!demo;actions.append(start,demoConnect);
 const readiness=node('p',undefined,'adventure-readiness');readiness.id='adventure-readiness';
 const preparation=node('details',undefined,'adventure-preparation');preparation.id='adventure-preparation';
 const preparationLabel=node('summary',questText('仲間と進め方を見る'));preparationLabel.id='adventure-preparation-label';preparation.append(preparationLabel,description,capability,roster);
 form.append(taskLabel,task,sources,actions,readiness);detail.append(intro,lock,form,reward,preparation);
 const underway=node('section',undefined,'adventure-underway');underway.id='adventure-underway';
 const underwayTitle=node('h4',questText('仲間が依頼に取り組んでいます'));underwayTitle.id='adventure-underway-title';underwayTitle.tabIndex=-1;
 const underwayText=node('p');underwayText.id='adventure-underway-text';
 const liveSteps=node('ol',undefined,'adventure-live-steps');liveSteps.id='adventure-live-steps';
 const runHint=node('p',questText('終わると、この場所に成果が表示されます。'),'adventure-run-hint');
 const progressButton=node('button',questText('進み具合・停止・再開を見る'),'outline');progressButton.id='adventure-progress';progressButton.type='button';progressButton.onclick=()=>onProgress?.();underway.append(underwayTitle,underwayText,liveSteps,runHint,progressButton);
 const candidate=node('section',undefined,'adventure-candidate');candidate.id='adventure-candidate';candidate.hidden=true;candidate.setAttribute('aria-labelledby','adventure-candidate-title');
 const candidateTitle=node('h4',questText('成果が届きました'));candidateTitle.id='adventure-candidate-title';candidateTitle.tabIndex=-1;
 const candidateCaption=node('p');candidateCaption.id='adventure-candidate-caption';
 const output=node('pre');output.id='adventure-output';output.tabIndex=0;output.setAttribute('aria-label',questText('持ち帰った成果'));
 const truncation=node('p',undefined,'adventure-truncation');truncation.id='adventure-output-truncation';truncation.hidden=true;
 const candidateActions=node('div',undefined,'adventure-actions'),accept=node('button',questText('この成果で次へ進む →'),'primary'),discard=node('button',questText('依頼を見直す'),'outline');
 accept.id='adventure-accept';discard.id='adventure-discard';accept.type=discard.type='button';candidateActions.append(accept,discard);
 candidate.append(candidateTitle,candidateCaption,output,candidateActions,truncation,node('p',questText('依頼に応えられていたら、成果を受け取って次へ進みましょう。'),'adventure-adoption-help'));
 const journal=node('details',undefined,'adventure-journal');journal.id='adventure-journal';const journalHeading=node('summary');journalHeading.id='adventure-journal-heading';const journalItems=node('div');journalItems.id='adventure-journal-items';journal.append(journalHeading,journalItems);
 const directAccess=node('div',undefined,'adventure-direct-access');directAccess.append(node('p',questText('装備を変えたり、仲間を選びたいときは。')));
 const townAccess=node('button',questText('街のお店・お城へ ↓'),'outline');townAccess.id='adventure-town-access';townAccess.type='button';
 townAccess.onclick=()=>{if(onTown)return onTown();const map=document.querySelector('.town-map');map?.scrollIntoView({block:'start'});map?.querySelector('[data-town-destination]')?.focus({preventScroll:true});};directAccess.append(townAccess);
 const stage=node('div',undefined,'adventure-stage');stage.id='adventure-stage';stage.append(feedback,failure,detail,underway,candidate);
 const world=node('section',undefined,'adventure-map-section');world.setAttribute('aria-labelledby','adventure-map-title');
 const mapTitle=node('h4',questText('世界を広げよう'));mapTitle.id='adventure-map-title';world.append(mapTitle,growth,route);
 root.replaceChildren(heading,journey,stage,world,journal,directAccess);

 function current(){return demo?{completed:[],journal:[],active:null,candidate:null}:getState()?.adventure||{completed:[],journal:[],active:null,candidate:null};}
 function progress(){return adventureProgress(current());}
 function focusTask(){
  const target=!candidate.hidden?candidateTitle:!underway.hidden?underwayTitle:detailTitle;
  target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});
 }
 function persistDraft(){try{localStorage.setItem(storeKey,JSON.stringify(Object.fromEntries(drafts)));}catch{}}
 function changedDraft(event){if(!formRegion)return;drafts.set(formRegion,{defaultPrompt:event.target!==task&&drafts.get(formRegion).defaultPrompt,text:task.value,sourceA:sourceInputs[0].value,sourceB:sourceInputs[1].value});persistDraft();error='';render();}
 task.oninput=changedDraft;sourceInputs.forEach(field=>field.oninput=changedDraft);
 function reason(region,value,state){
  if(demo)return questText('画面のお試し中です。実際の依頼にはCodexへの接続が必要です。');
  if(busy)return questText('出発の準備、または成果の記録中です…');
  if(region.level>progress().level)return questText('Lv.{level}で、この地域への道がひらきます。',{level:region.level});
  if(value.candidate)return questText('届いた成果を読んで、受け取るか依頼を見直してください。');
  if(activeStatuses.includes(value.active?.status)||['running','stopping','paused'].includes(state.party?.quest?.status))return questText('進行中の冒険があります。仲間の行動を確認してから次の依頼へ進みましょう。');
  if(state.active)return questText('ほかの処理が進行中です。完了後に出発できます。');
  if(!state.connected||state.account?.type!=='chatgpt'||state.login)return questText('Codexに接続してから出発できます。');
  if(state.policy?.ok===false)return state.policy.reason||questText('利用枠を確認してください。');
  if(!getModel()?.model)return questText('出発に使うモデルを選んでください。');
  if(getChats().length<region.roles.length)return questText('この冒険には{count}人の仲間が必要です。チャットを追加してください。',{count:region.roles.length});
  if(!task.value.trim())return questText('今回かなえたいことを入力してください。');
  if(region.requiresSources&&sourceInputs.some(field=>!field.value.trim()))return questText('比較する資料 A と資料 B の本文を入力してください。');
  return '';
 }
 function renderRoster(region){
  const chats=getChats().slice(0,region.roles.length),key=JSON.stringify([region.id,chats.map(chat=>[chat.id,chat.characterName,chat.title])]);if(key===rosterKey)return;rosterKey=key;
  roster.replaceChildren();preparationLabel.textContent=questText('仲間{count}人と進め方を見る',{count:region.roles.length});
  guideAvatar.replaceChildren(characterIcon(region.roles[0],'adventure-guide-character'));guideName.textContent=chats.length?(region.roles.length===1?(chats[0].characterName||chats[0].title):region.roles.length+questText('人の仲間')):questText('仲間を追加');worldScene.dataset.region=region.id;
  const members=node('ol');
  region.roles.forEach((role,index)=>{const chat=chats[index],row=node('li');row.append(characterIcon(role,'adventure-companion'));const copy=node('span');copy.append(node('strong',chat?.characterName||chat?.title||questText('仲間を追加')),node('small',role));row.append(copy);members.append(row);});roster.append(members);
 }
 function renderJournal(value){
  const entries=value.journal||[],key=JSON.stringify(entries);journalHeading.textContent=questText('冒険の書 · {count}件の成果',{count:entries.length});
  if(key===journalKey)return;journalKey=key;journalItems.replaceChildren();
  if(!entries.length){journalItems.append(node('p',questText('採用した成果と、一緒に冒険した仲間がここに残ります。')));return;}
  for(const entry of [...entries].reverse()){
   const region=adventureRegions.find(item=>item.id===entry.regionId),row=node('details');row.dataset.adventureJournal=entry.questId;
   row.append(node('summary',(region?.name||questText('冒険'))+' · '+entry.title));
   const date=Number.isFinite(entry.acceptedAt)?new Date(entry.acceptedAt).toLocaleString(getLocale()):'';
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
  root.dataset.level=String(status.level);root.dataset.complete=String(allComplete);level.textContent='Lv.'+status.level;rank.textContent=allComplete?questText('全地方踏破'):titles()[status.level-1]||titles().at(-1);
  growthText.textContent=allComplete?questText('すべての土地へ行けます。好きな進め方で次の依頼へ。'):nextRegion?questText('「{name}」の成果を受け取ると、冒険が進みます。',{name:nextRegion.name}):questText('好きな土地から、新しい依頼へ。');
  for(const marker of milestones.children)marker.dataset.complete=String(completed.includes(marker.dataset.milestone));
  for(const item of adventureRegions){const ui=regionButtons.get(item.id);ui.name.textContent=item.name;ui.ability.textContent=item.ability;const done=completed.includes(item.id),locked=item.level>status.level,active=value.active?.regionId===item.id&&activeStatuses.includes(value.active.status);ui.button.dataset.status=locked?'locked':done?'completed':active?'active':'available';ui.button.setAttribute('aria-pressed',String(item.id===region.id));ui.button.disabled=busy;ui.state.textContent=locked?'Lv.'+item.level+questText(' · 未踏'):active?questText('冒険中'):done?questText('踏破済み'):'Lv.'+item.level+questText(' · 出発できる');ui.button.setAttribute('aria-label',item.name+'、'+ui.state.textContent+'、'+item.ability);}
  chapter.textContent=region.name;detailTitle.textContent=region.title;description.textContent=region.description;capability.textContent=questText('できること：')+region.ability;
  const following=adventureRegions[region.level];reward.textContent=completed.includes(region.id)?questText('何度でも、この仲間たちに新しい依頼を任せられます。'):following?questText('成果を受け取ると → ')+following.name+questText('で')+following.ability: questText('成果を受け取ると、全地方踏破！');
  lock.hidden=unlocked;form.hidden=!unlocked;preparation.hidden=!unlocked;reward.hidden=!unlocked;lockText.textContent=questText('ここでは{ability}ができます。',{ability:region.ability})+(adventureRegions[region.level-2]?.name?questText('「{name}」の成果を受け取ると、Lv.{level}で道が開きます。',{name:adventureRegions[region.level-2].name,level:region.level}):'');
  if(formRegion!==region.id){formRegion=region.id;const draft=drafts.get(region.id);task.value=draft.text;sourceInputs[0].value=draft.sourceA;sourceInputs[1].value=draft.sourceB;}
  sources.hidden=!region.requiresSources;for(const field of sourceInputs){field.required=region.requiresSources;field.readOnly=busy;field.disabled=!region.requiresSources;}
  task.readOnly=busy;renderRoster(region);
  const blocked=reason(region,value,state);start.disabled=Boolean(blocked);start.hidden=demo;start.textContent=busy?questText('準備中…'):questText('この依頼で冒険をはじめる →');readiness.textContent=blocked||questText('出発するとChatGPTの利用枠を使います。');
  const active=value.active,quest=state.party?.quest,matching=active?.questId&&quest?.id===active.questId;
  const running=active&&activeStatuses.includes(active.status);
  underway.hidden=!running||Boolean(value.candidate);progressButton.disabled=!onProgress||!matching;
  detail.hidden=Boolean(value.candidate)||Boolean(running);
  root.dataset.phase=value.candidate?'result':running?'running':'ready';
  const journeyStep=value.candidate?3:running?2:1;for(const step of journey.children){const current=Number(step.dataset.journeyStep)===journeyStep;step.dataset.current=String(current);if(current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');}
  title.textContent=value.candidate?questText('成果を受け取ろう'):running?questText('仲間におまかせ中'):questText('冒険をはじめよう');
  lead.textContent=value.candidate?questText('内容を確かめて、次の土地へ。'):running?questText('終わると、ここに成果が届きます。'):questText('依頼を書いて、仲間に任せましょう。');
  if(active){const place=adventureRegions.find(item=>item.id===active.regionId),step=matching?quest.steps?.find(item=>item.status==='running'):null;const labels={starting:questText('出発の準備中'),running:questText('冒険中'),stopping:questText('停止を待っています'),paused:questText('冒険を中断中'),cancelled:questText('冒険を終了しました'),completed:questText('成果を確認できます')};underwayText.textContent=(place?.name||questText('冒険'))+' · '+(step?questText('{role}が行動中',{role:step.role}):labels[active.status]||questText('進行を確認してください'));underwayTitle.textContent=active.status==='paused'?questText('冒険が途中で止まっています'):active.status==='stopping'?questText('停止を待っています'):questText('仲間が依頼に取り組んでいます');runHint.textContent=active.status==='paused'?questText('進み具合を開いて、再開するか依頼を終了できます。'):questText('終わると、この場所に成果が表示されます。');
   const rows=matching?quest.steps||[]:[],key=JSON.stringify(rows.map(item=>[item.id,item.title,item.role,item.status]));
   if(liveSteps.dataset.key!==key){liveSteps.dataset.key=key;liveSteps.replaceChildren(...rows.map(item=>{const row=node('li');row.dataset.status=item.status;row.append(node('strong',item.title),node('span',item.role),node('span',({pending:questText('順番待ち'),running:questText('取り組み中'),completed:questText('完了'),blocked:questText('確認が必要'),failed:questText('中断'),interrupted:questText('中断')})[item.status]||item.status,'adventure-step-state'));return row;}));}
  }
  const result=value.candidate;candidate.hidden=!result;
  if(result){const place=adventureRegions.find(item=>item.id===result.regionId);candidateCaption.textContent=(result.truncated||result.sourcesTruncated?questText('一部表示 · '):'')+(place?.name||questText('冒険'))+' · '+result.title;candidateCaption.title=candidateCaption.textContent;const key=result.questId+'\n'+result.output;if(candidateKey!==key){candidateKey=key;output.textContent=result.output||'';output.scrollTop=0;}truncation.hidden=!result.truncated&&!result.sourcesTruncated;truncation.textContent=truncationNote(result);const first=!completed.includes(result.regionId);accept.textContent=first&&status.level<adventureRegions.length?questText('成果を受け取って次の土地へ →'):first?questText('成果を受け取って全地方踏破！'):questText('この成果を受け取る');accept.disabled=busy||demo;discard.disabled=busy||demo;}
  feedback.hidden=!notice;feedback.textContent=notice;failure.hidden=!error;failure.textContent=error;renderJournal(value);
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(start.disabled||busy||demo)return;
  const region=adventureRegions.find(item=>item.id===selected),draft={...drafts.get(region.id)};
  busy=true;error='';notice='';render();
  try{const result=await api('adventure/start',{regionId:region.id,locale:getLocale(),text:draft.text,sourceA:draft.sourceA,sourceB:draft.sourceB,...getModel()});onState(result);notice='';}
  catch(reason){error=reason.message||questText('出発できませんでした。');}
  finally{busy=false;render();if(!error&&root.getClientRects().length)focusTask();}
 };
 function truncationNote(result){return [result.truncated?questText('最終成果の表示は一部が省略されています。'):'',result.sourcesTruncated?questText('仲間から引き継いだ成果に省略が含まれます。'):'',result.truncated||result.sourcesTruncated?questText('元の会話で全文を確認できます。'):''].join('');}
 async function finish(action){
  const candidate=current().candidate;if(!candidate||busy||demo)return;
  const before=progress(),region=adventureRegions.find(item=>item.id===candidate.regionId);let focusRegion=false;busy=true;error='';notice='';render();
  try{
   const result=await api('adventure/'+action,{questId:candidate.questId});onState(result);
   if(action==='accept'){
    focusRegion=true;
    const after=adventureProgress(result),newRegion=adventureRegions.find(item=>item.level===after.level);
    if(after.level>before.level){selected=newRegion.id;focusRegion=true;notice='LEVEL UP! Lv.'+after.level+' · '+questText('{place}への道がひらきました。{ability}を使って、次の冒険へ。',{place:newRegion.name,ability:newRegion.ability});}
    else if((after.completed||[]).length===adventureRegions.length&&!(before.completed||[]).includes(candidate.regionId)){notice=questText('全地方踏破！ すべての戦法がそろいました。好きな地域で、新しい依頼に挑めます。');}
    else notice=questText('{place}の成果を、冒険の書に記しました。',{place:region?.name||questText('冒険')});
    notify(notice);
   }else{selected=candidate.regionId;notice=questText('依頼を調整して、もう一度出発できます。');}
  }catch(reason){error=reason.message||questText('成果を記録できませんでした。');}
  finally{busy=false;render();if(focusRegion&&root.getClientRects().length){const button=regionButtons.get(selected)?.button;button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest',inline:'nearest'});}}
 }
 accept.onclick=()=>finish('accept');discard.onclick=()=>finish('discard');
 function focusCurrent(){
  const value=current();selected=value.candidate?.regionId||(activeStatuses.includes(value.active?.status)?value.active.regionId:null)||progress().nextRegionId||selected||adventureRegions[0].id;
  render();root.scrollIntoView({block:'start'});const target=!candidate.hidden?candidateTitle:!underway.hidden?underwayTitle:detailTitle;target.focus({preventScroll:true});
 }
 onLocaleChange(locale=>{
  adventureRegions=adventureRegionsFor(locale);
  for(const region of adventureRegions){
    const draft=drafts.get(region.id);
    if(!draft?.defaultPrompt)continue;
    draft.text=region.prompt;
    if(formRegion===region.id)task.value=draft.text;
  }
  const fixedLabels=[
    [next,'今できる冒険を見る →'],[taskLabel,'何を手伝ってほしい？'],
    [demoConnect,'接続して冒険をはじめる →'],[progressButton,'進み具合・停止・再開を見る'],
    [candidateTitle,'成果が届きました'],[discard,'依頼を見直す'],[townAccess,'街のお店・お城へ ↓'],
    [mapTitle,'世界を広げよう'],[directAccess.querySelector('p'),'装備を変えたり、仲間を選びたいときは。'],
    [candidate.querySelector('.adventure-adoption-help'),'依頼に応えられていたら、成果を受け取って次へ進みましょう。']
  ];
  for(const [element,label] of fixedLabels)element.textContent=questText(label);
  for(const [index,item] of [...journey.children].entries())item.querySelector('strong').textContent=questText(['依頼を書く','仲間に任せる','成果を受け取る'][index]);
  [journey,route,roster,output].forEach((element,index)=>element.setAttribute('aria-label',questText(['冒険の流れ','冒険で訪れる地域','この冒険の仲間と役割','持ち帰った成果'][index])));
  sourceInputs.forEach((field,index)=>{
    field.previousElementSibling.textContent=questText(index?'資料 B':'資料 A');
    field.placeholder=questText('比較したい資料の本文を貼り付ける（1800文字以内）');
  });
  rosterKey='';journalKey='';delete liveSteps.dataset.key;
  render();
 });
 return {render,focusCurrent};
}
