import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import {LocalStore} from './local-store.mjs';
import {validateParty} from './public/party-runner.js';

const phases=['gathering','starting','running'],problems=['blocked','uncertain','cancelled'],terminal=['completed',...problems];
const efforts=['none','minimal','low','medium','high','xhigh','max','ultra'];
const locations={library:{role:'research',label:'図書室'},workshop:{role:'write',label:'工房'},tavern:{role:'support',label:'酒場'},castle:{role:'review',label:'お城'}};
const roles=[
 {id:'research',label:'調査',pattern:/調査|研究|分析|探索|収集|スカウト|\b(?:research(?:er)?|investigat(?:ion|or|e)|analy(?:sis|st)|scout|survey)\b/,tasks:/調査|研究|資料|根拠|情報|収集|探索|検索|分析|比較|\b(?:research|investigat(?:e|ion)|analy(?:ze|sis)|sources?|survey|find|collect)\b/},
 {id:'write',label:'作成・執筆',pattern:/執筆|文章|文書|草案|作成|制作|設計|\b(?:writ(?:e|er|ing)|draft|author|design(?:er)?|creat(?:e|or))\b/,tasks:/執筆|文章|文書|草案|作成|制作|設計|レポート|報告|まとめ|原稿|\b(?:writ(?:e|ing)|draft|report|document|author|design|create)\b/},
 {id:'review',label:'検証',pattern:/レビュー|検証|確認|監査|試験|テスト|\b(?:review(?:er)?|test(?:er|ing)?|verify|verification|validation|audit(?:or)?)\b/,tasks:/レビュー|検証|確認|監査|試験|テスト|品質|整合|\b(?:review|test(?:ing)?|verify|verification|validation|audit|check|quality)\b/},
 {id:'support',label:'支援・相談',pattern:/支援|補助|相談|調整|協議|対話|\b(?:support|helper|assist(?:ant)?|coordinat(?:or|ion)|discuss(?:ion)?)\b/,tasks:/支援|補助|相談|調整|協議|対話|連携|\b(?:support|help|assist|coordinat(?:e|ion)|discuss(?:ion)?|collaborat(?:e|ion))\b/}
];
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8_640_000_000_000_000;
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase();
function modelValue(value){if(typeof value!=='string'||!value.trim()||value.length>120||/[\x00-\x1f\x7f]/.test(value))throw Error('掲示板の自動実行に使うモデルを確認してください。');return value.trim();}
function requireError(value){if(typeof value!=='string'||!value.trim()||value.length>2000)throw Error('停止理由は1〜2000文字で指定してください。');return value;}
function todoSnapshot(todo){
 if(!todo||!validId(todo.id)||typeof todo.title!=='string'||!todo.title.trim()||todo.title.length>120||!validTime(todo.updatedAt)||!['castle','teams'].includes(todo.source?.provider)||todo.assignee?.type!=='party'||todo.status!=='todo'||!Array.isArray(todo.runs)||todo.runs.length||!Array.isArray(todo.source.dependsOn)||todo.source.dependsOn.some(id=>!validId(id)))throw Error('未着手の掲示板クエストを確認してください。');
 return {todoId:todo.id,title:todo.title,todoUpdatedAt:todo.updatedAt};
}

export function eligibleBoardTodos(items,{teamsEnabled=false}={}){
 if(!Array.isArray(items))throw Error('掲示板のTODO一覧を確認してください。');
 const byId=new Map(items.map(item=>[item.id,item]));
 return items.filter(item=>(item.source?.provider==='castle'||teamsEnabled&&item.source?.provider==='teams')&&item.assignee?.type==='party'&&item.status==='todo'&&Array.isArray(item.runs)&&item.runs.length===0&&Array.isArray(item.source.dependsOn)&&item.source.dependsOn.every(id=>byId.get(id)?.status==='done'))
  .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||(a.source.order||0)-(b.source.order||0)||String(a.id).localeCompare(String(b.id))).map(item=>structuredClone(item));
}

// Matching is deliberately deterministic: only named roles with a task/location
// match are recruited. A missing role is shown to the user, never guessed.
export function selectBoardParty(todo,savedParty,chats){
 const place=locations[todo?.source?.location];if(!place)throw Error('クエストの行き先を確認してください。');
 const party=validateParty(savedParty,chats),leader=party.members.find(member=>member.conversationId===party.leaderId);
 const task=normalize([todo.title,todo.description,todo.criteria,todo.source.artifact].join('\n'));
 const weights=roles.map(role=>({role,score:(role.tasks.test(task)?3:0)+(place.role===role.id?4:0)}));
 const candidates=party.members.filter(member=>member!==leader).map((member,index)=>{
  const registered=roles.filter(role=>role.pattern.test(normalize(member.role))),fromTitle=registered.length===0;
  const recognized=fromTitle?roles.filter(role=>role.pattern.test(normalize(member.title))):registered;
  const matches=weights.map((entry,order)=>({...entry,order})).filter(entry=>entry.score>0&&recognized.some(role=>role.id===entry.role.id)).sort((a,b)=>b.score-a.score||a.order-b.order);
  if(!matches.length)return null;
  const best=matches[0],reason=(fromTitle?'会話名から判断した':'登録した')+best.role.label+'役として'+(place.role===best.role.id?place.label+'のクエストに適しています。':'このクエストの作業内容に対応します。');
  return {member,index,order:best.order,score:best.score,reason};
 }).filter(Boolean).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3).sort((a,b)=>a.order-b.order||a.index-b.index);
 if(!candidates.length)throw Error('このクエストに合う役割の仲間がいません。酒場で調査・執筆・検証・支援の役割を設定してください。');
 return {party:{...party,members:[...candidates.map(candidate=>candidate.member),leader]},reasons:[...candidates.map(candidate=>({conversationId:candidate.member.conversationId,reason:candidate.reason})),{conversationId:leader.conversationId,reason:'酒場で選んだリーダーが、最後に仲間の成果をまとめます。'}],location:todo.source.location};
}

function selectionSnapshot(value){
 if(!value||!locations[value.location]||!Array.isArray(value.reasons))throw Error('募集する仲間と選定理由を確認してください。');
 const input=value.party;
 if(!input||!Array.isArray(input.members)||input.members.length>4)throw Error('募集するパーティはリーダーを含む2〜4人にしてください。');
 const party=validateParty(input,input.members.map(member=>({id:member.conversationId,title:member.title})));
 if(party.members.some(member=>!validId(member.conversationId)||typeof member.title!=='string'||member.title.length>500)||party.members.at(-1).conversationId!==party.leaderId)throw Error('募集する仲間とリーダーの順序を確認してください。');
 if(value.reasons.length!==party.members.length||value.reasons.some((entry,index)=>entry?.conversationId!==party.members[index].conversationId||typeof entry.reason!=='string'||!entry.reason.trim()||entry.reason.length>600))throw Error('募集する仲間の選定理由を確認してください。');
 return {party,reasons:value.reasons.map(({conversationId,reason})=>({conversationId,reason})),location:value.location};
}
function attemptValid(item){
 if(!item||!validId(item.id)||!validId(item.todoId)||typeof item.title!=='string'||!item.title.trim()||item.title.length>120||!validTime(item.todoUpdatedAt)||![...phases,...terminal].includes(item.status)||!validTime(item.gatherStartedAt)||!validTime(item.gatherUntil)||item.gatherUntil<item.gatherStartedAt||item.gatherUntil-item.gatherStartedAt>60000||!validTime(item.updatedAt)||!efforts.includes(item.effort))throw Error('掲示板の実行記録を確認できません。');
 if(item.selection===null){if(!problems.includes(item.status)||item.partyKey!==null||item.runId!==null||item.questId!==null)throw Error('掲示板の選定記録を確認できません。');if(item.model!==null)modelValue(item.model);}
 else{selectionSnapshot(item.selection);modelValue(item.model);if(typeof item.partyKey!=='string'||! /^[a-f0-9]{64}$/.test(item.partyKey))throw Error('募集したパーティの識別情報を確認できません。');}
 for(const key of ['runId','questId'])if(item[key]!==null&&!validId(item[key]))throw Error('掲示板クエストの実行先を確認できません。');
 if(['running','completed'].includes(item.status)&&(!item.runId||!item.questId))throw Error('掲示板クエストの開始記録を確認できません。');
 if(phases.includes(item.status)){if(item.error!==null||item.finishedAt!==undefined)throw Error('掲示板の実行状態を確認できません。');}
 else if(!validTime(item.finishedAt)||problems.includes(item.status)&&(typeof item.error!=='string'||!item.error.trim()||item.error.length>2000)||item.status==='completed'&&item.error!==null)throw Error('掲示板の終了記録を確認できません。');
}
function identity(input){if(!validId(input?.id))throw Error('掲示板の実行IDを確認してください。');}
function bindIds(item,input){
 for(const key of ['runId','questId'])if(input[key]!==undefined){if(item.selection===null||!validId(input[key])||item[key]&&item[key]!==input[key])throw Error('掲示板クエストの実行先が一致しません。');item[key]=input[key];}
}
function archive(value,item){value.history.push(structuredClone(item));value.history=value.history.slice(-100);}

export class BoardDispatchStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'board-dispatch.json'),{version:1,revision:0,enabled:false,model:null,effort:'medium',active:null,history:[]},onChange);}
 async load(){
  await super.load(value=>{
   if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.enabled!=='boolean'||!efforts.includes(value.effort)||!Array.isArray(value.history)||value.history.length>100)throw Error('掲示板の自動募集設定を確認できません。');
   if(value.model!==null)modelValue(value.model);if(value.enabled&&value.model===null)throw Error('掲示板の自動実行モデルを確認できません。');
   const rows=[...value.history,...(value.active?[value.active]:[])];if(value.active!==null&&!value.active||new Set(rows.map(item=>item.id)).size!==rows.length)throw Error('掲示板の実行記録を確認できません。');
   rows.forEach(attemptValid);if(value.history.some(item=>!terminal.includes(item.status))||value.active&&problems.includes(value.active.status)&&value.enabled)throw Error('掲示板の実行状態を確認できません。');
  });
  if(this.value.active&&phases.includes(this.value.active.status))await this.change(value=>{const now=Date.now();Object.assign(value.active,{status:'uncertain',error:'アプリが再起動しました。前の募集・実行結果が未確認のため、自動では再開しません。',updatedAt:now,finishedAt:now});value.enabled=false;});
  return this;
 }
 // Idempotent retries and timer checks do not rewrite an unchanged checkpoint.
 change(update){this.writing=this.writing.catch(()=>{}).then(async()=>{
  const value=structuredClone(this.value),result=update(value);
  if(JSON.stringify(value)!==JSON.stringify(this.value)){value.revision=this.value.revision+1;await writeFile(this.file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(this.file+'.tmp',this.file);this.value=value;this.onChange(this.public());}
  return structuredClone(result);
 });return this.writing;}
 async configure(input={}){
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('掲示板の自動募集のON/OFFを確認してください。');
  if(input.model!==undefined&&input.model!==null)modelValue(input.model);if(input.effort!==undefined&&!efforts.includes(input.effort))throw Error('掲示板の思考の深さを確認してください。');
  await this.change(value=>{
   const enabled=input.enabled??value.enabled,model=input.model===undefined?value.model:input.model===null?null:modelValue(input.model),effort=input.effort??value.effort;
   if(enabled&&value.active&&problems.includes(value.active.status))throw Error('前の募集・実行結果を確認し、確認済みにしてからONにしてください。');
   if(enabled&&!value.enabled&&value.active&&phases.includes(value.active.status))throw Error('停止処理が終わり、結果を確認してからONにしてください。');
   if(value.active&&value.active.status!=='completed'&&(model!==value.model||effort!==value.effort))throw Error('現在の募集・実行を終了して結果を確認してからモデルを変更してください。');
   if(enabled)modelValue(model);Object.assign(value,{enabled,model,effort});
  });return this.public();
 }
 async claim({todo,selection,partyKey,now=Date.now(),gatherMs=3200}){
  const fields=todoSnapshot(todo),chosen=selectionSnapshot(selection);
  if(chosen.location!==todo.source.location||typeof partyKey!=='string'||! /^[a-f0-9]{64}$/.test(partyKey)||!validTime(now)||!Number.isSafeInteger(gatherMs)||gatherMs<0||gatherMs>60000||!validTime(now+gatherMs))throw Error('掲示板の募集開始情報を確認してください。');
  return this.change(value=>{
   const active=value.active;
   if(active&&active.status!=='completed'){
    if(phases.includes(active.status)&&active.todoId===fields.todoId&&active.todoUpdatedAt===fields.todoUpdatedAt&&active.partyKey===partyKey&&JSON.stringify(active.selection)===JSON.stringify(chosen))return active;
    throw Error('現在の募集・実行結果を確認してから次のクエストを募集してください。');
   }
   if(!value.enabled)throw Error('掲示板の自動募集はOFFです。');modelValue(value.model);
   if(active?.todoId===fields.todoId||value.history.some(item=>item.todoId===fields.todoId&&item.status==='completed'))throw Error('この掲示板クエストはすでに処理しています。');
   if(active)archive(value,active);
   value.active={id:randomUUID(),...fields,partyKey,selection:chosen,status:'gathering',gatherStartedAt:now,gatherUntil:now+gatherMs,model:value.model,effort:value.effort,runId:null,questId:null,error:null,updatedAt:now};return value.active;
  });
 }
 async block({todo,error,now=Date.now()}){
  const fields=todoSnapshot(todo),reason=requireError(error);if(!validTime(now))throw Error('掲示板の確認日時を確認してください。');
  return this.change(value=>{
   if(value.active&&value.active.status!=='completed'){
    if(value.active.status==='blocked'&&value.active.todoId===fields.todoId)return value.active;
    throw Error('現在の募集・実行結果を確認してください。');
   }
   if(!value.enabled)throw Error('掲示板の自動募集はOFFです。');if(value.active)archive(value,value.active);
   value.active={id:randomUUID(),...fields,partyKey:null,selection:null,status:'blocked',gatherStartedAt:now,gatherUntil:now,model:value.model,effort:value.effort,runId:null,questId:null,error:reason,updatedAt:now,finishedAt:now};value.enabled=false;return value.active;
  });
 }
 async transition(input){
  identity(input);const now=input.now??Date.now();if(!validTime(now)||!phases.includes(input.status))throw Error('掲示板の進行状態を確認してください。');
  return this.change(value=>{
   const item=value.active;if(!item||item.id!==input.id)throw Error('掲示板の実行IDが変わりました。表示を更新してください。');
   const from=phases.indexOf(item.status),to=phases.indexOf(input.status);if(from<0||to<from||to>from+1)throw Error('掲示板クエストの開始順序を確認してください。');
   if(!value.enabled&&from===0&&to>from)throw Error('掲示板の自動募集がOFFのため、次の処理を開始しません。');
   if(input.status==='starting'&&item.status==='gathering'&&now<item.gatherUntil)throw Error('仲間が集まるまでお待ちください。');
   if(input.status==='gathering'&&(input.runId!==undefined||input.questId!==undefined))throw Error('募集完了前に実行先を登録できません。');
   const old=JSON.stringify(item);bindIds(item,input);item.status=input.status;if(input.status==='running'&&(!item.runId||!item.questId))throw Error('クエストとTODOの開始記録を指定してください。');
   if(JSON.stringify(item)!==old)item.updatedAt=now;return item;
  });
 }
 async finish(input){
  identity(input);const now=input.now??Date.now();if(!validTime(now)||!terminal.includes(input.status))throw Error('掲示板の終了状態を確認してください。');
  const error=input.status==='completed'?null:requireError(input.error);
  return this.change(value=>{
   const item=value.active;if(!item||item.id!==input.id)throw Error('掲示板の実行IDが変わりました。表示を更新してください。');
   if(terminal.includes(item.status)){if(item.status===input.status){const before=JSON.stringify(item);bindIds(item,input);if(JSON.stringify(item)!==before)item.updatedAt=now;return item;}throw Error('掲示板の実行結果はすでに保存されています。');}
   if(input.status==='completed'&&item.status!=='running')throw Error('実行中のクエストだけを完了にできます。');
   bindIds(item,input);if(input.status==='completed'&&(!item.runId||!item.questId))throw Error('クエストとTODOの開始記録を確認してください。');
   Object.assign(item,{status:input.status,error,finishedAt:now,updatedAt:now});if(problems.includes(input.status))value.enabled=false;return item;
  });
 }
 async acknowledge({id}){
  identity({id});await this.change(value=>{if(!value.active||value.active.id!==id||!problems.includes(value.active.status))throw Error('確認する募集・実行結果を選択してください。');archive(value,value.active);value.active=null;value.enabled=false;});return this.public();
 }
}
