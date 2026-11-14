import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {LocalStore} from './local-store.mjs';

const statuses=['draft','generating','reviewed','sending','sent','uncertain','failed'];
const editable=['draft','generating','reviewed','failed'];
const string=(value,max,label,{empty=false}={})=>{
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(label+'を確認してください。');
 return value;
};
const identifier=(value,label)=>string(value,512,label);
const configuration=value=>string(value??'',1024,'接続情報',{empty:true});
const draftText=value=>string(value,8000,'返信本文',{empty:true});
const sourceMessage=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('元のメッセージを確認してください。');
 const result={id:identifier(value.id,'元のメッセージ'),text:string(value.text,20000,'元のメッセージ本文',{empty:true})};
 for(const [key,max] of [['author',512],['createdAt',128],['webUrl',2048]])if(value[key]!==undefined&&value[key]!==null)result[key]=string(value[key],max,'元のメッセージ情報',{empty:true});
 return result;
};
const destination=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('返信先を確認してください。');
 if(value.kind==='chat')return {kind:'chat',chatId:identifier(value.chatId,'チャット')};
 if(value.kind==='channel')return {kind:'channel',teamId:identifier(value.teamId,'チーム'),channelId:identifier(value.channelId,'チャネル'),messageId:identifier(value.messageId,'返信スレッド')};
 throw Error('返信先を確認してください。');
};
const find=(value,id)=>{const item=value.items.find(item=>item.id===id);if(!item)throw Error('返信案が見つかりません。');return item;};
const expected=(item,revision)=>{if(!Number.isSafeInteger(revision)||revision!==item.revision)throw Error('返信案が更新されています。表示を更新して確認してください。');};
const touch=item=>{item.revision++;item.updatedAt=Date.now();};
const clearReview=item=>{delete item.review;};
const digest=item=>createHash('sha256').update(JSON.stringify({source:item.source,target:item.target,text:item.text,configurationKey:item.configurationKey,revision:item.revision})).digest('hex');
const matchingToken=(given,stored)=>typeof given==='string'&&/^[A-Za-z0-9_-]{43}$/.test(given)&&given.length===stored.length&&timingSafeEqual(Buffer.from(given),Buffer.from(stored));

/** Local drafts never send messages. prepareSend must finish before the caller dispatches once. */
export class TeamsDraftStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'teams-drafts.json'),{version:1,revision:0,items:[]},onChange);this.confirmations=new Map();}
 async load(){
  await super.load(value=>{
   if(value.version!==1||!Number.isSafeInteger(value.revision)||!Array.isArray(value.items)||value.items.length>200)throw Error('Teams返信案の保存内容を確認できません。');
   const ids=new Set();
   for(const item of value.items){
    if(!item||!item.id||ids.has(item.id)||!statuses.includes(item.status)||!Number.isSafeInteger(item.revision)||item.revision<1)throw Error('Teams返信案の保存内容を確認できません。');
    ids.add(item.id);sourceMessage(item.source);destination(item.target);draftText(item.text);configuration(item.configurationKey);
    if(item.questResult){for(const key of ['todoId','runId','questId'])identifier(item.questResult[key],'クエスト成果');if(!Number.isFinite(item.questResult.appliedAt)||!Number.isFinite(item.questResult.completedAt))throw Error('返信案に反映した成果の保存記録を確認できません。');}
    if(item.status==='sending'&&(!item.attempt?.id||!Number.isFinite(item.attempt.startedAt)))throw Error('Teams返信案の送信記録を確認できません。');
   }
  });
  this.confirmations.clear();
  if(this.value.items.some(item=>['sending','generating','reviewed'].includes(item.status)))await this.mutate(value=>{
   for(const item of value.items){
    if(item.status==='sending'){item.status='uncertain';item.error='再起動前の送信結果は未確認です。Teamsで送信済みか確認してください。自動では再送しません。';item.attempt.result='uncertain';}
    else if(item.status==='generating'){item.status='draft';item.error='返信案の作成が中断されました。必要ならもう一度作成してください。';if(item.generation)item.generation.state='interrupted';}
    else if(item.status==='reviewed'){item.status='draft';item.error='送信するには返信先と本文をもう一度確認してください。';}
    else continue;
    clearReview(item);touch(item);
   }
  });
  return this;
 }
 get(id){return structuredClone(find(this.value,id));}
 item(id){return this.get(id);}
 async create({source,target,configurationKey='',text=''}){
  const fields={source:sourceMessage(source),target:destination(target),configurationKey:configuration(configurationKey),text:draftText(text)};
  const id=randomUUID();
  await this.mutate(value=>{if(value.items.length>=200)throw Error('Teams返信案は200件まで保存できます。');const now=Date.now();value.items.push({id,...fields,revision:1,status:'draft',createdAt:now,updatedAt:now});});
  return this.get(id);
 }
 async update({id,text,expectedRevision,revision}){
  text=draftText(text);
  await this.mutate(value=>{const item=find(value,id);expected(item,expectedRevision??revision);if(!editable.includes(item.status))throw Error('この返信案は編集できません。送信結果を先に確認してください。');this.confirmations.delete(id);item.text=text;item.status='draft';delete item.error;clearReview(item);if(item.generation?.state==='generating')item.generation.state='superseded';touch(item);});
  return this.get(id);
 }
 async applyQuestResult({id,revision},resolveResult){
  await this.mutate(value=>{const item=find(value,id);expected(item,revision);if(!['draft','reviewed','failed'].includes(item.status))throw Error('この返信案へは反映できません。作成中・送信中の処理と送信結果を確認してください。');const result=resolveResult(item),text=draftText(result.text);if(!text.trim())throw Error('返信本文を確認してください。');this.confirmations.delete(id);item.text=text;item.questResult={...result.questResult,appliedAt:Date.now()};item.status='draft';delete item.error;delete item.generation;clearReview(item);touch(item);});
  return this.get(id);
 }
 /** Caller must first fetch this same source/target with the current authenticated account. */
 async rebind({id,expectedRevision,revision,configurationKey,source,target}){
  const nextSource=sourceMessage(source),nextTarget=destination(target),nextKey=configuration(configurationKey);
  await this.mutate(value=>{const item=find(value,id);expected(item,expectedRevision??revision);if(!['draft','reviewed','failed'].includes(item.status))throw Error('この返信案の接続先は更新できません。送信結果を先に確認してください。');if(item.source.id!==nextSource.id||JSON.stringify(item.target)!==JSON.stringify(nextTarget))throw Error('元のメッセージと返信先が一致しません。');if(item.configurationKey===nextKey&&JSON.stringify(item.source)===JSON.stringify(nextSource))return;this.confirmations.delete(id);item.configurationKey=nextKey;item.source=nextSource;item.status='draft';delete item.generation;delete item.error;clearReview(item);touch(item);});
  return this.get(id);
 }
 async startGeneration(input){
  const {id,expectedRevision,revision,configurationKey}=typeof input==='string'?{id:input}:input;
  const generationId=randomUUID();
  const result=await this.mutate(value=>{const item=find(value,id);if(expectedRevision!==undefined||revision!==undefined)expected(item,expectedRevision??revision);if(configurationKey!==undefined&&configuration(configurationKey)!==item.configurationKey)throw Error('接続先が変わっています。元のメッセージを選び直してください。');if(!editable.includes(item.status))throw Error('この返信案では作成を開始できません。');this.confirmations.delete(id);clearReview(item);delete item.error;delete item.questResult;item.status='generating';item.generation={id:generationId,state:'generating',startedAt:Date.now()};touch(item);return {item,generationId,revision:item.revision};});
  return result;
 }
 async finishGeneration({id,expectedRevision,revision,generationId,text,conversationId,activityId}){
  text=draftText(text);
  for(const [label,value] of [['チャット',conversationId],['作成履歴',activityId]])if(value!==undefined)identifier(value,label);
  return this.mutate(value=>{const item=find(value,id);if(item.status!=='generating'||item.revision!==(expectedRevision??revision)||(generationId!==undefined&&item.generation?.id!==generationId))return {item,applied:false};item.text=text;item.status='draft';delete item.error;clearReview(item);Object.assign(item.generation,{state:'completed',completedAt:Date.now()},conversationId===undefined?{}:{conversationId},activityId===undefined?{}:{activityId});touch(item);return {item,applied:true};});
 }
 async failGeneration({id,expectedRevision,revision,generationId,error}){
  const message=string(String(error||'返信案の作成に失敗しました。').slice(0,1000),1000,'作成エラー');
  return this.mutate(value=>{const item=find(value,id);if(item.status!=='generating'||item.revision!==(expectedRevision??revision)||(generationId!==undefined&&item.generation?.id!==generationId))return {item,applied:false};item.status='draft';item.error=message;item.generation.state='failed';item.generation.completedAt=Date.now();touch(item);return {item,applied:true};});
 }
 async review({id,revision,configurationKey}){
  const confirmationToken=randomBytes(32).toString('base64url');
  const result=await this.mutate(value=>{const item=find(value,id);expected(item,revision);if(!['draft','reviewed','failed'].includes(item.status))throw Error('この返信案は送信前の確認ができません。');if(!item.text.trim())throw Error('返信本文を入力してください。');if(configurationKey!==undefined&&configuration(configurationKey)!==item.configurationKey)throw Error('接続先が変わっています。元のメッセージを選び直してください。');this.confirmations.delete(id);item.status='reviewed';delete item.error;touch(item);item.review={revision:item.revision,digest:digest(item),reviewedAt:Date.now()};return {item,revision:item.revision,preview:{source:item.source,target:item.target,text:item.text}};});
  if(this.get(id).revision===result.revision)this.confirmations.set(id,{token:confirmationToken,revision:result.revision,digest:result.item.review.digest});
  return {...result,confirmationToken};
 }
 async prepareSend({id,revision,confirmationToken,configurationKey}){
  const attemptId=randomUUID();
  const work=await this.mutate(value=>{
   const item=find(value,id);expected(item,revision);
   if(item.status!=='reviewed')throw Error('送信するには返信先と本文を確認してください。');
   if(configuration(configurationKey)!==item.configurationKey)throw Error('接続先が変わっています。元のメッセージを選び直してください。');
   const receipt=this.confirmations.get(id),currentDigest=digest(item);
   if(!receipt||receipt.revision!==item.revision||receipt.digest!==currentDigest||item.review?.digest!==currentDigest||!matchingToken(confirmationToken,receipt.token))throw Error('送信前の確認が無効です。返信先と本文をもう一度確認してください。');
   item.status='sending';item.attempt={id:attemptId,startedAt:Date.now(),result:'sending'};clearReview(item);touch(item);
   return {id:item.id,attemptId,revision:item.revision,text:item.text,target:item.target,source:item.source,configurationKey:item.configurationKey};
  });
  this.confirmations.delete(id);
  return work;
 }
 async complete({id,attemptId,messageId,sentAt}){
  if(messageId!==undefined)identifier(messageId,'送信したメッセージ');
  if(sentAt!==undefined&&!Number.isFinite(sentAt))throw Error('送信日時を確認してください。');
  await this.mutate(value=>{const item=find(value,id);if(item.attempt?.id!==attemptId||!['sending','sent'].includes(item.status))throw Error('送信記録が一致しません。');if(item.status==='sent')return;item.status='sent';delete item.error;Object.assign(item.attempt,{result:'sent',completedAt:sentAt??Date.now()},messageId===undefined?{}:{messageId});item.sentAt=item.attempt.completedAt;touch(item);});
  return this.get(id);
 }
 async fail({id,attemptId,error,uncertain=true}){
  const message=string(String(error||'送信結果を確認できません。').slice(0,1000),1000,'送信エラー');
  await this.mutate(value=>{const item=find(value,id);if(item.status!=='sending'||item.attempt?.id!==attemptId)throw Error('送信記録が一致しません。');item.status=uncertain?'uncertain':'failed';item.error=message;item.attempt.result=uncertain?'uncertain':'failed';item.attempt.completedAt=Date.now();clearReview(item);this.confirmations.delete(id);touch(item);});
  return this.get(id);
 }
 async resolveUncertain({id,revision,outcome}){
  if(!['sent','not_sent'].includes(outcome))throw Error('Teamsで確認した送信結果を選択してください。');
  await this.mutate(value=>{const item=find(value,id);expected(item,revision);if(item.status!=='uncertain')throw Error('送信結果が未確認の返信案を選択してください。');item.status=outcome==='sent'?'sent':'draft';item.reconciliation={outcome,confirmedAt:Date.now(),method:'manual'};item.attempt.result=outcome==='sent'?'manually_confirmed_sent':'manually_confirmed_not_sent';if(outcome==='sent')item.sentAt=Date.now();delete item.error;clearReview(item);this.confirmations.delete(id);touch(item);});
  return this.get(id);
 }
 async invalidateConfiguration(configurationKey){
  const key=configuration(configurationKey);
  return this.mutate(value=>{let count=0;for(const item of value.items){if(item.configurationKey===key||!['reviewed','generating'].includes(item.status))continue;this.confirmations.delete(item.id);item.status='draft';clearReview(item);if(item.generation?.state==='generating')item.generation.state='superseded';item.error='接続先が変わっています。元のメッセージを選び直してください。';touch(item);count++;}return count;});
 }
}
