import {questText} from './i18n-quests.js';
import {getLocale, onLocaleChange} from './i18n.js';
import {assertVillageInvitation} from './village-initiative.js';
import {partyStepLabels} from './party-runner.js';
const labels={todo:'未着手',doing:'進行中',done:'完了'},runLabels={running:'実行中',paused:'中断中',completed:'完了',cancelled:'終了'};
const node=(tag,value,className)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
export function initTodos({api,demo,storeKey,getState,getChats,getParty,getMedia,getModel,canRun,onState,onSelect,onTavern,onMedia,onDemoStart,onDemoAction,onTeams}){
 const $=selector=>document.querySelector(selector);let selected=null,detail=null,busy=false,dirty=false,listKey='',fieldsKey='',historyKey='',generation=0;
 let demoValue={version:1,revision:0,items:[]};if(demo)try{demoValue=JSON.parse(localStorage.getItem(storeKey+'-todos'))||demoValue;}catch{}
 const sourceLabel=node('div',undefined,'module-note');sourceLabel.id='todo-source';$('#todo-form').prepend(sourceLabel);
 const dependencies=node('div');dependencies.id='todo-dependencies';dependencies.hidden=true;$('#todo-execution').prepend(dependencies);
 const current=()=>demo?demoValue:getState()||{items:[]};
 const item=()=>current().items.find(item=>item.id===selected);
 const persistDemo=()=>{demoValue.revision++;localStorage.setItem(storeKey+'-todos',JSON.stringify(demoValue));onState(structuredClone(demoValue));};
 const empty=()=>({title:'',description:'',criteria:'',priority:'normal',due:'',assignee:{type:'manual'},mediaIds:[],status:'todo',runs:[]});
 function error(message){$('#todo-error').hidden=!message;$('#todo-error').textContent=message||'';}
 function values(){const target=$('#todo-assignee').value;return {id:selected||undefined,title:$('#todo-title').value.trim(),description:$('#todo-description').value,criteria:$('#todo-criteria').value,priority:$('#todo-priority').value,due:$('#todo-due').value,assignee:target.startsWith('chat:')?{type:'chat',conversationId:target.slice(5)}:{type:target},mediaIds:[...document.querySelectorAll('#todo-media-list input:checked')].map(input=>input.value)};}
 function readFields(value){
  sourceLabel.replaceChildren();sourceLabel.hidden=!value.source;if(value.source?.provider==='backlog'){sourceLabel.append(node('p','Backlog: '+value.source.issueKey+questText(' · 元の状態: ')+value.source.status+questText(' · TODOの完了はBacklogへ書き戻しません。')));if(value.source.truncated)sourceLabel.append(node('p',questText('取り込み時に省略があります。原文を確認してください。')));const copy=node('button',questText('課題URLをコピー'),'text-btn');copy.type='button';copy.onclick=()=>navigator.clipboard.writeText(value.source.url).catch(()=>error(questText('URLをコピーできませんでした。')));sourceLabel.append(copy);}
  if(value.source?.provider==='teams'){
   const source=value.source;sourceLabel.append(node('p',questText('Teamsからの依頼 · ')+(source.author||questText('送信者不明'))+questText(' · TODOの完了後に返信内容を確認します。')));
   const original=node('details'),summary=node('summary',questText('元の依頼')),body=node('pre',source.request);body.style.whiteSpace='pre-wrap';body.style.overflowWrap='anywhere';original.append(summary,body);sourceLabel.append(original);
   if(onTeams){const open=node('button',questText('Teamsで進行・返信案を確認'),'text-btn');open.type='button';open.onclick=()=>onTeams(source.draftId);sourceLabel.append(open);}
  }
  if(value.source?.provider==='castle'){
   const source=value.source,location={library:questText('図書館 · 調査'),workshop:questText('工房 · 作成'),tavern:questText('酒場 · 連携'),castle:questText('お城 · 整理')}[source.location]||questText('お城');
   sourceLabel.append(node('p',questText('王城で受けた仕事 · クエスト {order} / {total} · {location}',{order:source.order,total:source.total,location})));
   const provenance=node('dl',undefined,'todo-castle-source');for(const [label,text] of [[questText('依頼原文'),source.request],[questText('最後に欲しい成果'),source.expectedArtifact],[questText('このクエストで残す成果'),source.artifact]])provenance.append(node('dt',label),node('dd',text));sourceLabel.append(provenance);
  }
  $('#todo-title').value=value.title;$('#todo-description').value=value.description;$('#todo-criteria').value=value.criteria;$('#todo-priority').value=value.priority;$('#todo-due').value=value.due;
  const choices=$('#todo-assignee');choices.replaceChildren(new Option(questText('自分で進める'),'manual'),new Option(questText('酒場のパーティ'),'party'));for(const chat of getChats())choices.add(new Option(chat.title,'chat:'+chat.id));choices.value=value.assignee.type==='chat'?'chat:'+value.assignee.conversationId:value.assignee.type;
  const mediaList=$('#todo-media-list');mediaList.replaceChildren();for(const media of getMedia()?.items||[]){const row=node('div',undefined,'todo-media-item'),label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=media.id;input.checked=value.mediaIds?.includes(media.id)||false;input.onchange=()=>{dirty=true;};label.append(input,document.createTextNode(' '+media.name));const open=node('button',questText('表示'),'text-btn');open.type='button';open.onclick=()=>onMedia(media.id);row.append(label,open);mediaList.append(row);}if(!mediaList.children.length)mediaList.append(node('span',questText('Imageで保存した画像を関連付けられます。'),'module-note'));
 }
 async function load(id){const request=++generation;try{const value=demo?structuredClone(current().items.find(item=>item.id===id)):await fetch('/api/todos/item?id='+encodeURIComponent(id)).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error);return result;});if(request!==generation||id!==selected)return;detail=value;fieldsKey='';render();}catch(e){if(request===generation)error(e.message);}}
 function choose(id){selected=id;detail=null;dirty=false;fieldsKey='';error('');if(id)load(id);else{generation++;readFields(empty());}render();}
 function history(value){
  const container=$('#todo-history');container.replaceChildren();for(const run of [...(value?.runs||[])].reverse()){
   const entry=node('details',undefined,'todo-history-entry');entry.open=run.id===value.runs.at(-1)?.id;const time=new Date(run.createdAt).toLocaleString(getLocale());entry.append(node('summary',time+' · '+(questText(runLabels[run.status]||run.status))));if(run.error)entry.append(node('p',run.error,'module-error'));if(run.snapshot)entry.append(node('p',questText('実行時: ')+run.snapshot.title,'module-note'));
   for(const step of run.steps||[]){const stepDetail=node('details',undefined,'todo-step');stepDetail.append(node('summary',step.role+' / '+step.title+' · '+(partyStepLabels[step.status]||step.status)));if(step.output)stepDetail.append(node('pre',step.output));if(step.error)stepDetail.append(node('p',step.error));const open=node('button',questText('会話を開く'),'text-btn');open.type='button';open.onclick=()=>onSelect(step.conversationId);stepDetail.append(open);entry.append(stepDetail);}
   if(run.output){const output=node('pre',run.output);if(value?.source?.provider==='castle'){output.dataset.artifactOutput=run.id;entry.append(node('h4',questText('生成された成果')),node('p',questText('AIが生成した出力です。外部送信やファイル更新など、実務を実施した記録とは区別して確認してください。'),'todo-artifact-note'),output);}else entry.append(node('h4',run.party?.members.length===1?questText('担当チャットの成果'):questText('リーダーのまとめ')),output);}container.append(entry);
  }
 }
 function render(){
  const value=item(),key=JSON.stringify([getLocale(),current().items,selected]);if(key!==listKey){listKey=key;const list=$('#todo-list');list.replaceChildren();for(const task of current().items){const button=node('button',undefined,'todo-list-item'+(task.status==='done'?' is-done':''));button.type='button';button.dataset.todoId=task.id;button.setAttribute('aria-pressed',String(task.id===selected));button.append(node('strong',task.title),node('span',questText(labels[task.status])+' · '+(task.assignee.type==='party'?questText('パーティ'):task.assignee.type==='chat'?questText('チャット'):questText('自分'))+(task.due?' · '+task.due:'')));button.onclick=()=>choose(task.id);list.append(button);}if(!list.children.length)list.append(node('p',questText('タイトルだけでTODOを登録できます。'),'module-note'));}
  const run=(detail||value)?.runs.at(-1),quest=getParty()?.quest,linked=quest?.link?.todoId===selected,currentRun=linked&&['running','stopping','paused'].includes(quest.status),locked=busy||Boolean(run&&['running','paused'].includes(run.status)),data=detail||value||empty();
  const nextKey=JSON.stringify([getLocale(),selected,detail?.updatedAt,getChats().map(chat=>[chat.id,chat.title]),getMedia()?.revision]);if(nextKey!==fieldsKey&&!dirty){fieldsKey=nextKey;readFields(data);}
  $('#todo-status').textContent=value?questText(labels[value.status]):questText('新しいTODO');$('#todo-fields').disabled=locked;$('#todo-save').disabled=locked;$('#todo-new').disabled=busy;
  const prerequisites=value?.source?.provider==='castle'?(value.source.dependsOn||[]).map(id=>({id,task:current().items.find(item=>item.id===id)})):[],waiting=prerequisites.filter(({task})=>task?.status!=='done');
  dependencies.replaceChildren();dependencies.hidden=!prerequisites.length;
  if(prerequisites.length){dependencies.append(node('p',waiting.length?questText('先に前のクエストを完了してください。'):questText('前のクエストは完了しています。その成果を引き継いで進めます。')));for(const {id,task} of prerequisites){const open=node('button',(task?`${questText(labels[task.status])} · ${task.title}`:questText('前のTODOが見つかりません')),'text-btn');open.type='button';open.disabled=!task;open.dataset.dependencyId=id;open.onclick=()=>choose(id);dependencies.append(open);}}
  const assignment=$('#todo-assignee').value,manual=assignment==='manual';$('#todo-start').textContent=manual?questText('作業を開始'):assignment==='party'?questText('パーティに渡して開始'):questText('チャットに渡して開始');$('#todo-start').hidden=value?.status==='done'||Boolean(currentRun);$('#todo-start').disabled=busy||Boolean(waiting.length)||(!manual&&(!canRun()||['running','stopping','paused'].includes(quest?.status)));
  $('#todo-done').hidden=!value||!manual||value.status!=='doing';$('#todo-done').disabled=busy;$('#todo-reopen').hidden=!value||value.status!=='done';$('#todo-reopen').disabled=busy;
  $('#todo-pause').hidden=!linked||!['running','stopping'].includes(quest.status);$('#todo-pause').disabled=busy||quest?.status==='stopping';$('#todo-resume').hidden=!linked||quest.status!=='paused';$('#todo-resume').disabled=busy||!canRun();const next=quest?.steps.find(step=>step.status!=='completed');$('#todo-resume').textContent=next?.needsRetry?questText('この役割を再実行して続ける'):questText('続きから再開');$('#todo-cancel').hidden=!currentRun;$('#todo-cancel').disabled=busy||quest?.status==='stopping';
  $('#todo-run-error').hidden=!run?.error;$('#todo-run-error').textContent=[run?.error,next?.needsRetry&&linked?questText('一部を実行済みの可能性があります。会話を確認してから再実行できます。'):''].filter(Boolean).join('\n');
  $('#todo-policy').textContent=manual?questText('自分で進め、完了にできます。'):questText('正常終了した成果を保存したら自動で完了します。')+(assignment==='party'?questText(' 現在の編成: ')+(getParty()?.party.members.length?getParty().party.name:questText('酒場で編成して保存してください。')):'');
  const nextHistory=JSON.stringify([getLocale(),selected,(detail||value)?.runs]);if(!dirty&&nextHistory!==historyKey){historyKey=nextHistory;history(detail||value);}
 }
 async function request(route,body){
  if(!demo)return api(route,body);
  if(route==='todos/save'){if(!body.title)throw Error(questText('タイトルを入力してください。'));let task=demoValue.items.find(task=>task.id===body.id);if(!task){task={id:crypto.randomUUID(),status:'todo',runs:[],createdAt:Date.now()};demoValue.items.push(task);}Object.assign(task,body,{id:task.id,updatedAt:Date.now()});persistDemo();return structuredClone(task);}
  const task=demoValue.items.find(task=>task.id===body.id);if(!task)throw Error(questText('TODOが見つかりません。'));
  if(route==='todos/manual'){task.status=body.status;task.updatedAt=Date.now();persistDemo();return structuredClone(task);}
  if(route==='todos/reopen'){task.status='todo';task.updatedAt=Date.now();persistDemo();return structuredClone(task);}
  if(route==='todos/start'){
   if(task.assignee.type==='manual'){task.status='doing';task.updatedAt=Date.now();persistDemo();return structuredClone(task);}
   if(['running','stopping','paused'].includes(getParty()?.quest?.status))throw Error(questText('現在のクエストを完了または終了してください。'));const runId=crypto.randomUUID(),{runs,...snapshot}=task;task.runs.push({id:runId,createdAt:Date.now(),status:'running',snapshot,steps:[],output:'',error:null});task.status='doing';task.updatedAt=Date.now();persistDemo();try{await onDemoStart({text:['TODO: '+task.title,task.description,questText('達成条件:\n')+task.criteria].join('\n\n'),model:body.model,effort:body.effort,partyOverride:body.partyOverride,soloId:task.assignee.type==='chat'?task.assignee.conversationId:null,link:{todoId:task.id,runId}});}catch(error){task.runs.at(-1).status='cancelled';task.runs.at(-1).error=error.message;persistDemo();throw error;}return structuredClone(task);
  }
  if(route==='todos/action'){await onDemoAction(body.action,body.retry);return structuredClone(task);}
 }
 async function startInvitation(invite,{sampleItem,party}={}){
  if(busy)throw Error(questText('別の依頼を処理しています。'));
  if(dirty&&selected===invite.id)throw Error(questText('依頼ノートの編集中の内容を先に保存してください。'));
  const existing=current().items.find(task=>task.id===invite.id);
  const task=existing||(demo&&sampleItem?.id===invite.id?sampleItem:null);
  assertVillageInvitation(task,party,invite.version);
  if(!canRun())throw Error(questText('現在は依頼を開始できません。'));
  if(task.source?.provider==='castle'&&task.source.dependsOn?.some(id=>current().items.find(item=>item.id===id)?.status!=='done'))throw Error(questText('先に元の依頼を終えてください。'));
  const body={id:invite.id,invitation:invite.version,...getModel()};
  if(demo){
   if(['running','stopping','paused'].includes(getParty()?.quest?.status))throw Error(questText('現在のクエストを完了または終了してください。'));
   if(!existing)demoValue.items.push(structuredClone(sampleItem));
   if(task.assignee.type==='party')body.partyOverride=party;
  }
  busy=true;
  try{return await request('todos/start',body);}finally{busy=false;render();}
 }
 async function save(){const result=await request('todos/save',values());selected=result.id;detail=result;dirty=false;fieldsKey='';$('#todo-notice').textContent=questText('TODOを保存しました。');render();return result;}
 async function act(action){if(busy)return;busy=true;error('');render();try{if(action==='save')await save();else if(action==='start'){if(!selected||dirty)await save();detail=await request('todos/start',{id:selected,...getModel()});dirty=false;fieldsKey='';}else if(action==='done'){detail=await request('todos/manual',{id:selected,status:'done'});fieldsKey='';}else if(action==='reopen'){detail=await request('todos/reopen',{id:selected});dirty=false;fieldsKey='';}else{detail=await request('todos/action',{id:selected,action,retry:Boolean(getParty()?.quest?.steps.find(step=>step.status!=='completed')?.needsRetry)});fieldsKey='';}}catch(e){error(e.message);}finally{busy=false;render();}}
 $('#todo-new').onclick=()=>choose(null);$('#todo-form').onsubmit=event=>{event.preventDefault();act('save');};$('#todo-form').addEventListener('input',()=>{dirty=true;});$('#todo-assignee').onchange=()=>{dirty=true;render();};for(const action of ['start','done','reopen','pause','resume','cancel'])$('#todo-'+action).onclick=()=>act(action);$('#todo-tavern').onclick=onTavern;
 onLocaleChange(render);
 return {render,open:id=>{if(id)choose(id);else if(!selected&&current().items.length)choose(current().items[0].id);else render();},hydrate:()=>{render();if(selected&&item()?.updatedAt!==detail?.updatedAt)load(selected);},startInvitation,demoSnapshot:()=>demo?structuredClone(demoValue):null,syncDemoQuest:async quest=>{if(!demo||!quest?.link)return;const task=demoValue.items.find(task=>task.id===quest.link.todoId),run=task?.runs.find(run=>run.id===quest.link.runId);if(!run)return;Object.assign(run,{questId:quest.id,status:quest.status==='stopping'?'running':quest.status,steps:structuredClone(quest.steps),party:structuredClone(quest.party),error:quest.error});if(quest.status==='completed'&&quest.steps.every(step=>step.status==='completed')){run.output=quest.steps.at(-1).output;task.status='done';}task.updatedAt=Date.now();persistDemo();if(selected===task.id){detail=structuredClone(task);fieldsKey='';}render();}};
}
