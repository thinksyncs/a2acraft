import path from 'node:path';
import {createHash} from 'node:crypto';
import {LocalStore} from './local-store.mjs';

const maximumItems=500,maximumSeen=10000;
const kinds=new Set(['chat.completed','chat.failed','todo.completed','todo.failed','todo.paused','party.completed','party.failed','party.paused','reminder','followup']);
const timestamp=value=>Number.isFinite(value)&&value>=0?value:null;
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,120):fallback;
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validSource(source){
 if(!source||!['chat','todo','party','schedule'].includes(source.type))return false;
 const primary={chat:'conversationId',todo:'todoId',party:'questId',schedule:'scheduleId'}[source.type];
 if(!identifier(source[primary]))return false;
 return Object.entries(source).every(([key,value])=>{
  if(key==='target')return source.type==='schedule'&&value&&['none','chat','todo','party'].includes(value.type)&&Object.keys(value).every(field=>['type','id'].includes(field))&&(value.type==='none'?value.id===undefined:value.type==='party'&&value.id===undefined||Boolean(identifier(value.id)));
  return ['type','conversationId','todoId','questId','runId','scheduleId'].includes(key)&&Boolean(identifier(value));
 });
}
const eventStatus=type=>['reminder','followup'].includes(type)?'attention':type.split('.')[1];
const attempts=steps=>Array.isArray(steps)?steps.map(step=>[step?.id||step?.conversationId||'',Number.isSafeInteger(step?.attempts)?step.attempts:0,step?.status||'']):[];
const failed=steps=>Array.isArray(steps)&&steps.some(step=>['failed','blocked'].includes(step?.status));
const latestTime=(steps,field)=>Array.isArray(steps)?steps.reduce((last,step)=>{const current=timestamp(step?.[field]);return current===null?last:last===null?current:Math.max(last,current);},null):null;

function events(snapshot){
 const result=[];
 const add=(type,key,source,name,occurredAt)=>{
  const status=type.split('.')[1],category=source.type==='chat'?'チャット':source.type==='todo'?'TODO':'クエスト';
  const body=category+(status==='completed'?'が完了しました':status==='failed'?'でエラーが発生しました':'を中断しています');
  result.push({id:digest([type,key]),type,status,title:label(name,category),body:body+'。開いて内容を確認できます。',occurredAt:timestamp(occurredAt),source});
 };
 for(const chat of Array.isArray(snapshot?.conversations)?snapshot.conversations:[]){
  const conversationId=identifier(chat?.id);if(!conversationId||!['completed','failed'].includes(chat.status))continue;
  const messages=Array.isArray(chat.messages)?chat.messages:[],user=messages.findLast(message=>message?.role==='user'),assistant=messages.findLast(message=>message?.role==='assistant');
  const activityId=identifier(chat.activity?.id),runId=activityId||identifier(user?.id)||identifier(assistant?.id)||'undated';
  const occurredAt=timestamp(chat.activity?.completedAt)??timestamp(chat.completedAt);
  add('chat.'+chat.status,[conversationId,runId],{type:'chat',conversationId,...(activityId?{runId:activityId}:{})},chat.title,occurredAt);
 }
 const todos=Array.isArray(snapshot?.todos)?snapshot.todos:Array.isArray(snapshot?.todos?.items)?snapshot.todos.items:[];
 for(const todo of todos){
  const todoId=identifier(todo?.id);if(!todoId)continue;
  const runs=Array.isArray(todo.runs)?todo.runs:[];
  for(const run of runs){
   const runId=identifier(run?.id);if(!runId||!['completed','failed','paused'].includes(run.status))continue;
   const status=run.status==='completed'?'completed':run.status==='failed'||failed(run.steps)?'failed':'paused';
   const occurredAt=status==='completed'?timestamp(run.completedAt)??latestTime(run.steps,'completedAt'):timestamp(run.failedAt)??timestamp(run.finishedAt)??latestTime(run.steps,'failedAt');
   add('todo.'+status,[todoId,runId,status==='completed'?null:attempts(run.steps)],{type:'todo',todoId,runId,...(identifier(run.questId)?{questId:run.questId}:{})},todo.title,occurredAt);
  }
  if(todo.status==='done'&&(todo.assignee?.type==='manual'||!runs.some(run=>run.status==='completed'))){
   const occurredAt=timestamp(todo.completedAt);
   add('todo.completed',[todoId,'manual',occurredAt],{type:'todo',todoId},todo.title,occurredAt);
  }
 }
 const quest=snapshot?.party?.quest,questId=identifier(quest?.id);
 if(questId&&['completed','failed','paused'].includes(quest.status)){
  const status=quest.status==='completed'?'completed':quest.status==='failed'||failed(quest.steps)?'failed':'paused';
  const occurredAt=status==='completed'?timestamp(quest.completedAt)??latestTime(quest.steps,'completedAt'):timestamp(quest.failedAt)??timestamp(quest.finishedAt)??latestTime(quest.steps,'failedAt');
  add('party.'+status,[questId,status==='completed'?null:attempts(quest.steps)],{type:'party',questId,...(identifier(quest.link?.todoId)?{todoId:quest.link.todoId}:{})},quest.party?.name||snapshot.party.party?.name,occurredAt);
 }
 return result;
}

function validate(value){
 if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items)||value.items.length>maximumItems||!Array.isArray(value.seen)||value.seen.length>maximumSeen||value.seen.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(value.seen).size!==value.seen.length||value.items.some(item=>!item||!/^[a-f0-9]{64}$/.test(item.id)||!kinds.has(item.type)||item.status!==eventStatus(item.type)||typeof item.title!=='string'||item.title.length>120||typeof item.body!=='string'||item.body.length>200||(item.occurredAt!==null&&timestamp(item.occurredAt)===null)||timestamp(item.createdAt)===null||(item.readAt!==null&&timestamp(item.readAt)===null)||!validSource(item.source))||new Set(value.items.map(item=>item.id)).size!==value.items.length)throw Error('受信箱の保存内容を確認できません。');
}

// Only local execution metadata is retained. Prompts, results and provider errors
// stay in their original stores and are reached through the source reference.
export class InboxStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'inbox.json'),{version:1,revision:0,items:[],seen:[]},onChange);this.operations=Promise.resolve();}
 async load(){await super.load(validate);return this;}
 public(){const {seen,...value}=super.public();return {...value,unreadCount:value.items.filter(item=>item.readAt===null).length};}
 enqueue(operation){const pending=this.operations.catch(()=>{}).then(operation);this.operations=pending;return pending;}
 observe(snapshot){
  const candidates=events(structuredClone(snapshot));
  return this.enqueue(async()=>{
   const seen=new Set(this.value.seen),added=candidates.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;});
   if(!added.length)return this.public();
   await this.mutate(value=>{
    const createdAt=Date.now();
    value.items.push(...added.map(item=>({...item,createdAt,readAt:null})));
    value.items.sort((a,b)=>(b.occurredAt??b.createdAt)-(a.occurredAt??a.createdAt)||b.createdAt-a.createdAt);
    value.items=value.items.slice(0,maximumItems);
    value.seen=[...seen].slice(-maximumSeen);
   });
   return this.public();
  });
 }
 sync(snapshot){return this.observe(snapshot);}
 notify(event){
  if(!event||typeof event.key!=='string'||!event.key.length||event.key.length>512||!['reminder','followup'].includes(event.type)||event.status!=='attention'||typeof event.title!=='string'||!event.title.trim()||typeof event.body!=='string'||timestamp(event.occurredAt)===null||!validSource(event.source))return Promise.reject(Error('受信箱への通知内容を確認してください。'));
  const item={id:digest([event.type,event.key]),type:event.type,status:'attention',title:event.title.trim().slice(0,120),body:event.body.trim().slice(0,200),occurredAt:event.occurredAt,source:structuredClone(event.source)};
  return this.enqueue(async()=>{
   if(this.value.seen.includes(item.id))return this.public();
   await this.mutate(value=>{value.items.unshift({...item,createdAt:Date.now(),readAt:null});value.items=value.items.slice(0,maximumItems);value.seen.push(item.id);value.seen=value.seen.slice(-maximumSeen);});return this.public();
  });
 }
 markRead(id,read=true){
  return this.enqueue(async()=>{
   if(!identifier(id)||typeof read!=='boolean')throw Error('受信箱の項目と既読状態を確認してください。');
   const item=this.value.items.find(item=>item.id===id);if(!item)throw Error('受信箱の項目が見つかりません。');
   if((item.readAt!==null)===read)return this.public();
   await this.mutate(value=>{value.items.find(item=>item.id===id).readAt=read?Date.now():null;});return this.public();
  });
 }
 markAllRead(){return this.enqueue(async()=>{if(this.value.items.some(item=>item.readAt===null))await this.mutate(value=>{const now=Date.now();for(const item of value.items)if(item.readAt===null)item.readAt=now;});return this.public();});}
}
