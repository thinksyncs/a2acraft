import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import {LocalStore} from './local-store.mjs';

const maxItems=200,maxOutbox=2000;
const automaticActions=['chat','party'],activeStatuses=['starting','running'],finalStatuses=['completed','blocked','failed','uncertain'];
const efforts=['none','minimal','low','medium','high','xhigh','max','ultra'];
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8_640_000_000_000_000;
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function timeZone(value){
 if(typeof value!=='string'||!value||value.length>100)throw Error('タイムゾーンを確認してください。');
 try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);}catch{throw Error('タイムゾーンを確認してください。');}
 return value;
}
function target(value){
 if(!value||typeof value!=='object'||!['none','chat','todo','party'].includes(value.type))throw Error('通知から開く対象を確認してください。');
 if(['chat','todo'].includes(value.type)&&!validId(value.id)||value.id!==undefined&&!validId(value.id))throw Error('通知から開く対象のIDを確認してください。');
 return value.type==='none'?{type:'none'}:{type:value.type,...(value.id===undefined?{}:{id:value.id})};
}
function fields(input){
 if(typeof input?.title!=='string'||!input.title.trim()||input.title.length>120)throw Error('通知のタイトルは120文字以内で入力してください。');
 if(!validTime(input.dueAt))throw Error('通知する日時を確認してください。');
 const action=input.action===undefined?'notify':input.action,destination=target(input.target||{type:'none'});
 if(!['notify',...automaticActions].includes(action))throw Error('予約する動作を確認してください。');
 const result={title:input.title.trim(),dueAt:input.dueAt,target:destination,action};
 if(action==='notify')return result;
 if(destination.type!==action||action==='party'&&destination.id!==undefined)throw Error('自動開始する対象を確認してください。');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>8000)throw Error('開始する内容を1〜8,000文字で入力してください。');
 if(typeof input.model!=='string'||!input.model.trim()||input.model.length>120||/[\x00-\x1f\x7f]/.test(input.model))throw Error('予約に使うモデルを確認してください。');
 const effort=input.effort===undefined?'medium':input.effort;if(!efforts.includes(effort))throw Error('予約に使う思考の深さを確認してください。');
 Object.assign(result,{text:input.text.trim(),model:input.model.trim(),effort});
 if(action==='party'){
  if(typeof input.partyKey!=='string'||! /^[a-f0-9]{64}$/.test(input.partyKey))throw Error('予約するパーティを確認してください。');
  result.partyKey=input.partyKey;result.party=partySnapshot(input.party);
 }
 return result;
}
function partySnapshot(input){
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>80||!validId(input.leaderId)||!Array.isArray(input.members)||input.members.length<2||input.members.length>8)throw Error('予約するパーティを確認してください。');
 const members=input.members.map(member=>{
  if(!validId(member?.conversationId)||typeof member.role!=='string'||!member.role.trim()||member.role.length>120||member.title!==undefined&&(typeof member.title!=='string'||member.title.length>500))throw Error('予約する仲間を確認してください。');
  return {conversationId:member.conversationId,...(member.title===undefined?{}:{title:member.title}),role:member.role.trim()};
 });
 if(new Set(members.map(member=>member.conversationId)).size!==members.length||!members.some(member=>member.conversationId===input.leaderId))throw Error('予約するリーダーと仲間を確認してください。');
 return {name:input.name.trim(),leaderId:input.leaderId,members};
}
function attemptIdentity(input){
 if(!validId(input?.id)||!Number.isSafeInteger(input.generation)||input.generation<1||!validId(input.attemptId))throw Error('予約の実行記録を確認してください。');
}
function clearAttempt(item){for(const key of ['attempt','error','errorCode','notifiedAt'])delete item[key];}
function localDay(now,zone){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}

// This store checkpoints execution intent; the server alone dispatches model turns.
export class SchedulerStore extends LocalStore{
 constructor(directory,onChange){
  super(path.join(directory,'schedules.json'),{version:1,revision:0,enabled:false,followup:false,timeZone:'Asia/Tokyo',items:[],outbox:[],followupDays:{}},onChange);
 }
 async load(){
  await super.load(value=>{
   if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.enabled!=='boolean'||typeof value.followup!=='boolean'||!Array.isArray(value.items)||value.items.length>maxItems)throw Error('通知予約の保存内容を確認できません。');
   timeZone(value.timeZone);const ids=new Set();
   for(const item of value.items){
    fields(item);
    const automatic=automaticActions.includes(item.action),statuses=automatic?['pending',...activeStatuses,...finalStatuses]:['pending','notified'];
    if(!validId(item.id)||ids.has(item.id)||typeof item.enabled!=='boolean'||!statuses.includes(item.status)||!Number.isSafeInteger(item.generation)||item.generation<1||!validTime(item.createdAt)||!validTime(item.updatedAt)||item.notifiedAt!==undefined&&!validTime(item.notifiedAt))throw Error('通知予約の保存内容を確認できません。');
    if(item.attempt!==undefined){
     if(!item.attempt||typeof item.attempt!=='object'||Array.isArray(item.attempt)||!validId(item.attempt.id)||!validTime(item.attempt.startedAt))throw Error('予約の実行記録を確認できません。');
     for(const key of ['acceptedAt','finishedAt'])if(item.attempt[key]!==undefined&&!validTime(item.attempt[key]))throw Error('予約の実行日時を確認できません。');
     for(const key of ['conversationId','activityId','questId'])if(item.attempt[key]!==undefined&&!validId(item.attempt[key]))throw Error('予約の開始先を確認できません。');
    }
    if(item.error!==undefined&&(typeof item.error!=='string'||item.error.length>1000)||item.errorCode!==undefined&&(typeof item.errorCode!=='string'||! /^[a-z0-9_-]{1,80}$/.test(item.errorCode))||automatic&&item.status!=='pending'&&!item.attempt||automatic&&item.status==='pending'&&item.attempt!==undefined)throw Error('予約の実行状態を確認できません。');
    ids.add(item.id);
   }
   if(!Array.isArray(value.outbox)||value.outbox.length>maxOutbox||!value.followupDays||typeof value.followupDays!=='object'||Array.isArray(value.followupDays)||Object.keys(value.followupDays).length>maxItems+1)throw Error('通知の送信待ち記録を確認できません。');
   const keys=new Set();
   for(const event of value.outbox){
    if(typeof event.key!=='string'||!event.key||event.key.length>512||keys.has(event.key)||!['reminder','followup'].includes(event.type)||typeof event.title!=='string'||!event.title||event.title.length>120||typeof event.body!=='string'||event.body.length>200||event.status!=='attention'||!validTime(event.occurredAt))throw Error('通知の送信待ち記録を確認できません。');
    const source=event.source;
    if(!source||source.type==='schedule'&&(!validId(source.scheduleId)||!source.target)||source.type==='todo'&&!validId(source.todoId)||source.type==='party'&&!validId(source.questId)||!['schedule','todo','party'].includes(source.type))throw Error('通知の参照先を確認できません。');
    if(source.type==='schedule')target(source.target);keys.add(event.key);
   }
   for(const [key,day] of Object.entries(value.followupDays))if(!/^(todo|party):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)||!validDay(day))throw Error('フォローアップの記録を確認できません。');
  });
  if(this.value.items.some(item=>activeStatuses.includes(item.status)))await this.change(value=>{
   const now=Date.now();for(const item of value.items)if(activeStatuses.includes(item.status)){item.status='uncertain';item.updatedAt=now;item.attempt.finishedAt=now;item.error='アプリが再起動しました。前の実行結果が未確認のため、自動では再実行しません。';item.errorCode='restart';}
  });
  return this;
 }
 public(){
  const {version,revision,enabled,followup,timeZone,items}=this.value;
  return structuredClone({version,revision,enabled,followup,timeZone,items});
 }
 // A timer tick with nothing due should not rewrite the data file.
 change(update){
  this.writing=this.writing.catch(()=>{}).then(async()=>{
   const next=structuredClone(this.value),result=update(next);
   if(JSON.stringify(next)!==JSON.stringify(this.value)){
    next.revision=this.value.revision+1;
    await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(this.file+'.tmp',this.file);
    this.value=next;this.onChange(this.public());
   }
   return structuredClone(result);
  });
  return this.writing;
 }
 async configure(input={}){
  for(const key of ['enabled','followup'])if(input[key]!==undefined&&typeof input[key]!=='boolean')throw Error('通知のON/OFFを確認してください。');
  if(input.timeZone!==undefined)timeZone(input.timeZone);
  await this.change(value=>{for(const key of ['enabled','followup','timeZone'])if(input[key]!==undefined)value[key]=input[key];});
  return this.public();
 }
 async save(input){
  const next=fields(input);if(input.id!==undefined&&!validId(input.id))throw Error('通知予約のIDを確認してください。');
  return this.change(value=>{
   let item=value.items.find(item=>item.id===input.id);
   if(input.id!==undefined&&!item)throw Error('通知予約が見つかりません。');
   if(item&&[...activeStatuses,'uncertain'].includes(item.status))throw Error('開始中または結果未確認の予約は編集できません。実行結果を確認してください。');
   const now=Date.now();
   if(!item){if(value.items.length>=maxItems)throw Error('通知予約は200件まで保存できます。');item={id:randomUUID(),generation:0,createdAt:now};value.items.push(item);}
   clearAttempt(item);for(const key of ['text','model','effort','party','partyKey'])delete item[key];
   Object.assign(item,next,{generation:item.generation+1,enabled:true,status:'pending',updatedAt:now});
   value.outbox=value.outbox.filter(event=>event.source.type!=='schedule'||event.source.scheduleId!==item.id);
   return item;
  });
 }
 async remove(id){
  if(!validId(id))throw Error('通知予約のIDを確認してください。');
  await this.change(value=>{const item=value.items.find(item=>item.id===id);if(!item)throw Error('通知予約が見つかりません。');if(activeStatuses.includes(item.status))throw Error('開始中の予約は削除できません。実行結果を確認してください。');value.items=value.items.filter(item=>item.id!==id);value.outbox=value.outbox.filter(event=>event.source.type!=='schedule'||event.source.scheduleId!==id);});
  return this.public();
 }
 async toggle(id,enabled){
  if(!validId(id)||typeof enabled!=='boolean')throw Error('通知予約のON/OFFを確認してください。');
  await this.change(value=>{const item=value.items.find(item=>item.id===id);if(!item)throw Error('通知予約が見つかりません。');if([...activeStatuses,'uncertain'].includes(item.status))throw Error('開始中または結果未確認の予約は切り替えできません。実行結果を確認してください。');if(item.enabled!==enabled){item.enabled=enabled;item.updatedAt=Date.now();}});
  return this.public();
 }
 due({now=Date.now()}={}){
  if(!validTime(now))throw Error('予約の確認日時を確認してください。');
  if(!this.value.enabled)return [];
  return structuredClone(this.value.items.filter(item=>item.enabled&&automaticActions.includes(item.action)&&item.status==='pending'&&item.dueAt<=now).sort((a,b)=>a.dueAt-b.dueAt||a.createdAt-b.createdAt||a.id.localeCompare(b.id)));
 }
 async claim({now=Date.now(),id}={}){
  if(!validTime(now)||id!==undefined&&!validId(id))throw Error('予約の開始記録を確認してください。');
  return this.change(value=>{
   if(!value.enabled)return null;
   const item=value.items.filter(item=>item.enabled&&automaticActions.includes(item.action)&&item.status==='pending'&&item.dueAt<=now&&(id===undefined||item.id===id)).sort((a,b)=>a.dueAt-b.dueAt||a.createdAt-b.createdAt||a.id.localeCompare(b.id))[0];
   if(!item)return null;
   Object.assign(item,{status:'starting',attempt:{id:randomUUID(),startedAt:now},updatedAt:now});return item;
  });
 }
 async accepted(input){
  attemptIdentity(input);for(const key of ['conversationId','activityId','questId'])if(input[key]!==undefined&&!validId(input[key]))throw Error('予約の開始先を確認してください。');
  return this.change(value=>{
   const item=value.items.find(item=>item.id===input.id&&item.generation===input.generation&&item.attempt?.id===input.attemptId);
   if(!item||item.status!=='starting')return null;
   const now=Date.now();Object.assign(item,{status:'running',updatedAt:now});item.attempt.acceptedAt=now;for(const key of ['conversationId','activityId','questId'])if(input[key]!==undefined)item.attempt[key]=input[key];return item;
  });
 }
 async finish(input){
  attemptIdentity(input);if(!finalStatuses.includes(input.status)||input.error!==undefined&&(typeof input.error!=='string'||input.error.length>1000)||input.errorCode!==undefined&&(typeof input.errorCode!=='string'||! /^[a-z0-9_-]{1,80}$/.test(input.errorCode)))throw Error('予約の終了記録を確認してください。');
  return this.change(value=>{
   const item=value.items.find(item=>item.id===input.id&&item.generation===input.generation&&item.attempt?.id===input.attemptId);
   if(!item||!activeStatuses.includes(item.status))return null;
   const now=Date.now();Object.assign(item,{status:input.status,updatedAt:now});item.attempt.finishedAt=now;if(input.error!==undefined)item.error=input.error;if(input.errorCode!==undefined)item.errorCode=input.errorCode;return item;
  });
 }
 async rearm({id,generation,confirmed}={}){
  if(!validId(id)||!Number.isSafeInteger(generation)||generation<1||confirmed!==true)throw Error('実行結果を確認してから、再実行を選んでください。');
  return this.change(value=>{
   const item=value.items.find(item=>item.id===id);if(!item||item.generation!==generation||!['blocked','failed','uncertain'].includes(item.status))throw Error('再確認する予約が見つかりません。');
   clearAttempt(item);Object.assign(item,{status:'pending',enabled:true,generation:item.generation+1,updatedAt:Date.now()});return item;
  });
 }
 async tick({todos,party,now=Date.now()}={}){
  if(!validTime(now))throw Error('通知の確認日時を確認してください。');
  const items=Array.isArray(todos)?todos:todos?.items||[];
  if(!Array.isArray(items)||items.length>maxItems)throw Error('フォローアップするTODOを確認してください。');
  const quest=party?.quest||(party?.status?party:null);
  return this.change(value=>{
   if(!value.enabled)return value.outbox;
   const enqueue=event=>{if(value.outbox.length>=maxOutbox)return false;if(!value.outbox.some(item=>item.key===event.key))value.outbox.push(event);return true;};
   for(const item of value.items)if(item.enabled&&(item.action??'notify')==='notify'&&item.status==='pending'&&item.dueAt<=now){
    if(enqueue({key:`schedule:${item.id}:${item.generation}`,type:'reminder',title:item.title,body:'予約した通知の時刻になりました。',status:'attention',occurredAt:now,source:{type:'schedule',scheduleId:item.id,target:structuredClone(item.target)}})){item.status='notified';item.notifiedAt=now;item.updatedAt=now;}
   }
   if(value.followup){
    const day=localDay(now,value.timeZone),references=new Set(items.filter(item=>validId(item.id)).map(item=>'todo:'+item.id));
    if(validId(quest?.id))references.add('party:'+quest.id);
    for(const key of Object.keys(value.followupDays))if(!references.has(key))delete value.followupDays[key];
    const follow=(reference,title,body,source)=>{
     if(value.followupDays[reference]===day)return;
     if(enqueue({key:`followup:${reference}:${day}`,type:'followup',title:title.trim().slice(0,120),body,status:'attention',occurredAt:now,source}))value.followupDays[reference]=day;
    };
    for(const item of items)if(validId(item.id)&&['todo','doing'].includes(item.status)&&validDay(item.due)&&item.due<day&&typeof item.title==='string'&&item.title.trim())follow('todo:'+item.id,item.title,'期限: '+item.due+'。TODOの進み具合を確認してください。',{type:'todo',todoId:item.id});
    if(validId(quest?.id)&&quest.status==='paused')follow('party:'+quest.id,'中断中のクエストを確認','中断理由と冒険の記録を確認できます。再開は酒場から選べます。',{type:'party',questId:quest.id});
   }
   return value.outbox;
  });
 }
 async ack(keys){
  if(!Array.isArray(keys)||keys.length>maxOutbox||keys.some(key=>typeof key!=='string'||!key||key.length>512))throw Error('通知の受取記録を確認してください。');
  const received=new Set(keys);await this.change(value=>{value.outbox=value.outbox.filter(event=>!received.has(event.key));});
  return this.public();
 }
}
