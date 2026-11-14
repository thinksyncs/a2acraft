// Backlog API v2, GET only. Credentials stay in this process, never in LocalStore.
const maxBytes=2*1024*1024;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const bounded=(value,max)=>typeof value==='string'?value.slice(0,max):'';
export function backlogSpace(value){
 let url;try{url=new URL(value);}catch{throw Error('BacklogのスペースURLを設定してください。');}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(backlog\.com|backlog\.jp|backlogtool\.com)$/.test(url.hostname))throw Error('スペースURLは https://スペース名.backlog.com/（backlog.jp・backlogtool.comも可）で指定してください。');
 return url.origin;
}
function projectRows(value){
 if(!Array.isArray(value)||value.length>2000||value.some(row=>!positive(row.id)||typeof row.projectKey!=='string'||!row.projectKey||typeof row.name!=='string'))throw Error('Backlogのプロジェクト一覧の形式を確認できません。');
 return value.map(row=>({id:row.id,key:bounded(row.projectKey,80),name:bounded(row.name,200),archived:row.archived===true}));
}
export function backlogIssue(value,projectId){
 if(!value||!positive(value.id)||value.projectId!==projectId||typeof value.summary!=='string'||!value.summary.trim()||typeof value.issueKey!=='string'||!/^[A-Za-z0-9_]+-\d+$/.test(value.issueKey)||value.issueKey.length>100||!(value.description===null||typeof value.description==='string'))throw Error('Backlogの課題の形式またはプロジェクトが一致しません。');
 return {id:value.id,projectId,issueKey:value.issueKey,summary:bounded(value.summary,1000),description:bounded(value.description,200000),status:bounded(value.status?.name,100),priorityId:positive(value.priority?.id)?value.priority.id:3,dueDate:bounded(value.dueDate,40),updated:bounded(value.updated,40)};
}
export class BacklogService{
 constructor({getConfiguration,request=globalThis.fetch,onChange=()=>{},timeout=20000,now=()=>Date.now()}){
  Object.assign(this,{getConfiguration,request,onChange,timeout,now});this.configuration=structuredClone(getConfiguration());this.credential=null;this.projects=[];this.generation=0;this.queue=Promise.resolve();this.controllers=new Set();this.blockedUntil=0;this.lastError=null;
 }
 public(){return {hasApiKey:Boolean(this.credential),connected:Boolean(this.credential&&this.getConfiguration().enabled),projectCount:this.projects.length,error:this.lastError,retryAt:this.blockedUntil>this.now()?this.blockedUntil:null};}
 changed(){this.onChange(this.public());}
 configurationChanged(){
  const next=this.getConfiguration(),previous=this.configuration;if(next.enabled===previous.enabled&&next.url===previous.url)return;
  this.configuration=structuredClone(next);this.invalidate();if(next.url!==previous.url){this.credential=null;this.projects=[];}this.lastError=null;this.changed();
 }
 invalidate(){this.generation++;for(const controller of this.controllers)controller.abort();}
 forget(){this.invalidate();this.credential=null;this.projects=[];this.lastError=null;this.changed();return this.public();}
 context(key=this.credential?.key){
  const config=this.getConfiguration();if(!config.enabled)throw Error('BacklogプラグインをONにしてください。');const space=backlogSpace(config.url);
  if(!key)throw Error('BacklogのAPIキーを入力して接続してください。');if(typeof key!=='string'||!/^[\x21-\x7e]{1,512}$/.test(key))throw Error('APIキーを確認してください。');
  if(key===this.credential?.key&&space!==this.credential.space)throw Error('このスペースのAPIキーで接続し直してください。');return {space,key,generation:this.generation};
 }
 assertCurrent(context){if(context.generation!==this.generation||!this.getConfiguration().enabled||context.space!==backlogSpace(this.getConfiguration().url))throw Error('接続設定が変わりました。操作をやり直してください。');}
 operation(context,run){
  const result=this.queue.catch(()=>{}).then(async()=>{this.assertCurrent(context);try{const value=await run();this.assertCurrent(context);this.lastError=null;this.changed();return value;}catch(error){if(context.generation===this.generation){this.lastError=error.message;this.changed();}throw error;}});this.queue=result.catch(()=>{});return result;
 }
 async get(context,pathname,query={}){
  this.assertCurrent(context);if(this.blockedUntil>this.now())throw Error('Backlogの利用制限中です。'+new Date(this.blockedUntil).toLocaleTimeString('ja-JP')+'以降に再取得してください。');
  const url=new URL('/api/v2/'+pathname,context.space);for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
  const controller=new AbortController();this.controllers.add(controller);let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeout);
  try{
   const response=await this.request(url,{method:'GET',headers:{Accept:'application/json','Backlog-API-Key':context.key},redirect:'error',signal:controller.signal});this.assertCurrent(context);
   if(response.status===429||response.headers.get('X-RateLimit-Remaining')==='0'){
    const reset=Number(response.headers.get('X-RateLimit-Reset'))*1000;this.blockedUntil=Number.isFinite(reset)&&reset>this.now()?Math.min(reset,this.now()+3600000):this.now()+60000;
   }
   if(!response.ok){await response.body?.cancel().catch(()=>{});const messages={401:'Backlogの認証に失敗しました。スペースURLとAPIキーを確認してください。',403:'Backlogへのアクセス権限がありません。APIキーとプロジェクトへの参加を確認してください。',404:'Backlogのプロジェクトまたは課題が見つかりません。',429:'Backlogの利用制限に達しました。時間をおいて再取得してください。'};throw Error(messages[response.status]||'Backlogが応答エラーを返しました（HTTP '+response.status+'）。');}
   if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('Backlogの応答形式を確認できません。');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw Error('Backlogの応答が大きすぎます。取得条件を絞ってください。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   this.assertCurrent(context);let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Backlogの応答データを読み込めません。');}return value;
  }catch(error){
   this.assertCurrent(context);if(timedOut)throw Error('Backlogから20秒以内に応答がありませんでした。再取得できます。');
   if(error instanceof TypeError||controller.signal.aborted)throw Error('Backlogに接続できませんでした。スペースURLと通信状態を確認して再取得してください。');throw error;
  }finally{clearTimeout(timer);controller.abort();this.controllers.delete(controller);}
 }
 connect(apiKey){if(typeof apiKey!=='string')throw Error('BacklogのAPIキーを入力してください。');const context=this.context(apiKey);return this.operation(context,async()=>{const projects=projectRows(await this.get(context,'projects'));this.assertCurrent(context);this.invalidate();context.generation=this.generation;this.credential={key:apiKey,space:context.space};this.projects=projects;this.lastError=null;return {status:this.public(),projects};});}
 listProjects(){const context=this.context();return this.operation(context,async()=>{this.projects=projectRows(await this.get(context,'projects'));return {status:this.public(),projects:this.projects};});}
 project(id){if(!positive(id)||!this.projects.some(project=>project.id===id))throw Error('取得済みのプロジェクトから選択してください。');return id;}
 listIssues({projectId,offset=0,keyword=''}){
  const context=this.context();projectId=this.project(projectId);if(!Number.isSafeInteger(offset)||offset<0||offset>10000||typeof keyword!=='string'||keyword.length>200)throw Error('課題の取得条件を確認してください。');
  return this.operation(context,async()=>{const rows=await this.get(context,'issues',{'projectId[]':projectId,count:20,offset,sort:'updated',order:'desc',...(keyword.trim()?{keyword:keyword.trim()}:{})});if(!Array.isArray(rows)||rows.length>20)throw Error('Backlogの課題一覧の形式を確認できません。');return {space:context.space,projectId,offset,hasMore:rows.length===20,issues:rows.map(row=>backlogIssue(row,projectId))};});
 }
 issue({projectId,issueId}){
  const context=this.context();projectId=this.project(projectId);if(!positive(issueId))throw Error('取り込む課題を選択してください。');
  return this.operation(context,async()=>{const issue=backlogIssue(await this.get(context,'issues/'+issueId),projectId);if(issue.id!==issueId)throw Error('Backlogの課題IDが一致しません。');return {issue,space:context.space,context:{space:context.space,generation:context.generation}};});
 }
 close(){this.invalidate();this.credential=null;}
}
