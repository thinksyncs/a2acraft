// Codex app-server v2 history is read without loading or resuming a thread.
// The portable path accepts rollout JSONL, never a Codex home/config directory.
import {createHash} from 'node:crypto';

export const MAX_CODEX_HISTORY_BYTES=16*1024*1024;
export const MAX_CODEX_HISTORY_MESSAGES=10000;
const MAX_ITEMS=50000,MAX_PAGES=1000,PAGE_SIZE=100;
const attachmentPlaceholder='［添付ファイルは移行されていません］';
const omittedWarning='ツール実行・内部指示・推論の記録は移行していません。';
const injectedUserContext=/^(?:# AGENTS\.md instructions for(?:\s|$)|<environment_context(?:>|\s)|<permissions instructions>|<collaboration_mode>)/u;
const attachmentWarning='添付ファイルの本体は移行していません。必要なファイルは送信前に添付し直してください。';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw Error(message);};
const boundedString=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u0020\u007f]/u.test(value);
const titleText=value=>boundedString(value,4000).replace(/\s+/gu,' ').trim().slice(0,80);
function timestamp(value,{seconds=false}={}){
 if(typeof value==='number'){
  const result=seconds?value*1000:value;
  return Number.isFinite(result)&&result>=0&&result<=8640000000000000?result:null;
 }
 if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/u.test(value))return null;
 const result=Date.parse(value);return Number.isFinite(result)&&result>=0?result:null;
}
function latest(...values){const known=values.filter(value=>value!==null);return known.length?Math.max(...known):null;}
function cursorValue(value){
 if(value==null)return null;
 if(typeof value!=='string'||!value||value.length>8192)fail('Codexの履歴ページ情報が不正です。');
 return value;
}
function safeSummary(thread,archived){
 if(!object(thread)||!identifier(thread.id))fail('Codexの会話情報が不正です。');
 return {id:thread.id,title:titleText(thread.name)||titleText(thread.preview)||'Codexの会話',preview:boundedString(thread.preview,300),createdAt:timestamp(thread.createdAt,{seconds:true}),updatedAt:timestamp(thread.updatedAt,{seconds:true}),cwd:boundedString(thread.cwd,4096),archived};
}
export async function listCodexHistory(rpc,{cursor=null,archived=false,searchTerm=''}={}){
 if(typeof archived!=='boolean'||typeof searchTerm!=='string'||searchTerm.length>200)fail('履歴の検索条件が不正です。');
 const page=await rpc('thread/list',{cursor:cursorValue(cursor),limit:50,sortKey:'updated_at',sortDirection:'desc',modelProviders:[],sourceKinds:[],archived,...(searchTerm.trim()?{searchTerm:searchTerm.trim()}: {})});
 if(!object(page)||!Array.isArray(page.data)||page.data.length>1000)fail('Codexの履歴一覧を読み込めませんでした。');
 const seen=new Set();
 const data=page.data.map(thread=>safeSummary(thread,archived)).filter(row=>!seen.has(row.id)&&seen.add(row.id));
 return {data,nextCursor:cursorValue(page.nextCursor)};
}
function collector(sourceThreadId){
 const messages=[],warnings=new Set();let bytes=0,itemCount=0;
 function add({role,text,createdAt=null,id,source,attachments=false}){
  if(++itemCount>MAX_ITEMS)fail('履歴の項目数が上限を超えています。');
  if(role!=='user'&&role!=='assistant'){warnings.add(omittedWarning);return;}
  if(typeof text!=='string')fail('会話本文の形式が不正です。');
  if(attachments){warnings.add(attachmentWarning);text+=(text?'\n\n':'')+attachmentPlaceholder;}
  if(!text)return;
  bytes+=Buffer.byteLength(text,'utf8');
  if(bytes>MAX_CODEX_HISTORY_BYTES)fail('会話本文が16 MiBの上限を超えています。');
  if(messages.length>=MAX_CODEX_HISTORY_MESSAGES)fail('会話のメッセージ数が10,000件の上限を超えています。');
  const messageId=createHash('sha256').update(`${sourceThreadId}\0${id||''}\0${messages.length}`).digest('hex').slice(0,32);
  messages.push({id:`codex-${messageId}`,role,text,createdAt,...(identifier(id)?{sourceItemId:id}:{}),...(source?{source}: {})});
 }
 return {messages,warnings,add};
}
function userContent(content){
 if(!Array.isArray(content))fail('ユーザーメッセージの形式が不正です。');
 const texts=[];let attachments=false;
 for(const part of content){
  if(!object(part))fail('ユーザーメッセージの内容が不正です。');
  if(['text','input_text','output_text'].includes(part.type)){
   if(typeof part.text!=='string')fail('会話本文の形式が不正です。');
   texts.push(part.text);
  }else attachments=true;
 }
 return {text:texts.join('\n'),attachments};
}
function addItem(result,item,createdAt){
 if(!object(item))fail('Codexの会話項目が不正です。');
 if(item.type==='userMessage')result.add({role:'user',...userContent(item.content),id:item.id,createdAt});
 else if(item.type==='agentMessage')result.add({role:'assistant',text:item.text,id:item.id,createdAt});
 else result.warnings.add(omittedWarning);
}
async function pages(rpc,method,params,onRow){
 let cursor=null,count=0;const seen=new Set();
 do{
  if(seen.has(cursor)||seen.size>=MAX_PAGES)fail('Codexの履歴ページが重複しているか、上限を超えています。');
  seen.add(cursor);
  const page=await rpc(method,{...params,cursor,limit:PAGE_SIZE,sortDirection:'asc'});
  if(!object(page)||!Array.isArray(page.data))fail('Codexの履歴ページを読み込めませんでした。');
  for(const row of page.data){if(++count>MAX_ITEMS)fail('履歴の項目数が上限を超えています。');await onRow(row);}
  cursor=cursorValue(page.nextCursor);
 }while(cursor!==null);
}
export async function readCodexHistory(rpc,threadId,{archived=false}={}){
 if(!identifier(threadId))fail('Codexの会話IDが不正です。');
 const response=await rpc('thread/read',{threadId,includeTurns:false});
 const thread=response?.thread,summary=safeSummary(thread,archived);
 if(thread.id!==threadId)fail('要求した会話とCodexの応答が一致しません。');
 const result=collector(threadId),seenTurns=new Set(),seenItems=new Set();let inspectedItems=0;
 async function addTurn(turn){
  if(!object(turn)||!identifier(turn.id)||!Array.isArray(turn.items))fail('Codexのターン情報が不正です。');
  if(seenTurns.has(turn.id))fail('Codexのターン情報が重複しています。');
  seenTurns.add(turn.id);
  const turnTime=timestamp(turn.startedAt,{seconds:true});
  function addUnique(item,time){
   if(++inspectedItems>MAX_ITEMS)fail('履歴の項目数が上限を超えています。');
   const key=identifier(item?.id)?`${turn.id}\0${item.id}`:null;
   if(key&&seenItems.has(key))return;
   if(key)seenItems.add(key);
   if(seenItems.size>MAX_ITEMS)fail('履歴の項目数が上限を超えています。');
   addItem(result,item,time);
  }
  if(turn.itemsView&&turn.itemsView!=='full'){
   await pages(rpc,'thread/items/list',{threadId,turnId:turn.id},entry=>{
    if(!object(entry)||entry.turnId!==turn.id)fail('Codexの会話項目のターンが一致しません。');
    addUnique(entry.item,timestamp(entry.startedAtMs)??timestamp(entry.completedAtMs)??turnTime);
   });
  }else{
   for(const item of turn.items)addUnique(item,turnTime);
  }
 }
 if(thread.historyMode==='paginated')await pages(rpc,'thread/turns/list',{threadId,itemsView:'full'},addTurn);
 else{
  const hydrated=(await rpc('thread/read',{threadId,includeTurns:true}))?.thread;
  if(hydrated?.id!==threadId||!Array.isArray(hydrated.turns))fail('Codexの会話本文を読み込めませんでした。');
  if(hydrated.turns.length>MAX_ITEMS)fail('履歴のターン数が上限を超えています。');
  for(const turn of hydrated.turns)await addTurn(turn);
 }
 if(!result.messages.length)fail('移行できるユーザーまたはアシスタントのメッセージがありません。');
 return {sourceThreadId:threadId,title:summary.title,createdAt:summary.createdAt,updatedAt:latest(summary.updatedAt,...result.messages.map(item=>item.createdAt)),cwd:summary.cwd,messages:result.messages,warnings:[...result.warnings]};
}

export function parseCodexRollout(text){
 if(typeof text!=='string'||!text.trim())fail('CodexのJSONL履歴ファイルを選択してください。');
 if(Buffer.byteLength(text,'utf8')>MAX_CODEX_HISTORY_BYTES)fail('履歴ファイルは16 MiB以下にしてください。');
 const records=[];let meta=null,lineNumber=0;
 for(const line of text.replace(/^\uFEFF/u,'').split(/\r?\n/u)){
  lineNumber++;if(!line.trim())continue;
  let record;try{record=JSON.parse(line);}catch{fail(`JSONL履歴の${lineNumber}行目が不正です。`);}
  if(!object(record)||typeof record.type!=='string'||!object(record.payload))fail(`JSONL履歴の${lineNumber}行目の形式が不正です。`);
  if(records.length>=MAX_ITEMS)fail('履歴ファイルの行数が上限を超えています。');
  records.push(record);
  if(record.type==='session_meta'){
   if(!identifier(record.payload.id))fail('CodexのセッションIDが不正です。');
   if(meta&&meta.id!==record.payload.id)fail('1つのファイルに複数のセッションが含まれています。');
   meta=record.payload;
  }
 }
 if(!meta)fail('Codexのsession_metaがありません。rollout形式のJSONLファイルを選択してください。');
 const result=collector(meta.id),candidates=[],hasUserEvents=records.some(row=>row.type==='event_msg'&&row.payload.type==='user_message');
 let updatedAt=timestamp(meta.timestamp),name=titleText(meta.name)||titleText(meta.title);
 for(const record of records){
  const payload=record.payload,createdAt=timestamp(record.timestamp);
  updatedAt=latest(updatedAt,createdAt);
  if(record.type==='response_item'){
   if(payload.type!=='message'||!['user','assistant'].includes(payload.role)){result.warnings.add(omittedWarning);continue;}
   const content=userContent(payload.content);
   // Rollouts can mix old response-only turns with newer mirrored events. Keep
   // both formats, excluding recognizable runtime scaffolding when canonical
   // user events exist, then pair mirrored messages below.
   if(payload.role==='user'&&hasUserEvents&&injectedUserContext.test(content.text.trimStart())){result.warnings.add(omittedWarning);continue;}
   candidates.push({role:payload.role,...content,id:payload.id,createdAt,source:'response'});
  }else if(record.type==='event_msg'){
   if(payload.type==='user_message'||payload.type==='agent_message'){
    if(typeof payload.message!=='string')fail('Codexのイベント本文が不正です。');
    candidates.push({role:payload.type==='user_message'?'user':'assistant',text:payload.message,createdAt,source:'event',attachments:payload.type==='user_message'&&[payload.images,payload.local_images,payload.attachments].some(value=>Array.isArray(value)&&value.length>0)});
   }else if(payload.type==='thread_name_updated')name=titleText(payload.thread_name)||titleText(payload.name)||name;
  }
 }
 // Codex writes visible assistant messages as both response_item and event_msg.
 // Pair adjacent mirrored records, preserving repeated messages in later turns.
 const merged=[];let previous=null;
 for(const candidate of candidates){
  if(previous&&previous.role===candidate.role&&previous.text===candidate.text&&!previous.sources.has(candidate.source)){
   previous.sources.add(candidate.source);previous.attachments||=candidate.attachments;previous.id||=candidate.id;previous.createdAt??=candidate.createdAt;continue;
  }
  previous={...candidate,sources:new Set([candidate.source])};merged.push(previous);
 }
 for(const {source,sources,...message} of merged)result.add(message);
 if(!result.messages.length)fail('移行できるユーザーまたはアシスタントのメッセージがありません。');
 return {sourceThreadId:meta.id,title:name||titleText(result.messages.find(row=>row.role==='user')?.text)||'Codexの会話',createdAt:timestamp(meta.timestamp)??timestamp(records.find(row=>row.type==='session_meta')?.timestamp),updatedAt,cwd:boundedString(meta.cwd,4096),messages:result.messages,warnings:[...result.warnings]};
}
