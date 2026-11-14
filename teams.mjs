// Microsoft Graph delegated access. Device codes and bearer tokens stay in memory.
import {createHash,randomUUID} from 'node:crypto';

const graphOrigin='https://graph.microsoft.com';
const loginOrigin='https://login.microsoftonline.com';
const maximumBytes=2*1024*1024;
const bounded=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const configurationFields=['enabled','clientId','tenant','targetKind','teamId','channelId'];
function configuration(value={}){
 return {enabled:value.enabled===true,clientId:bounded(value.clientId,80).trim(),tenant:bounded(value.tenant||'organizations',253).trim(),targetKind:value.targetKind==='channel'?'channel':'chat',teamId:bounded(value.teamId,512).trim(),channelId:bounded(value.channelId,512).trim()};
}
export function teamsConfigurationKey(value){const config=configuration(value);return createHash('sha256').update(JSON.stringify(configurationFields.map(key=>config[key]))).digest('hex');}
export class TeamsError extends Error{
 constructor(code,message,{needsReview=false}={}){super(message);this.name='TeamsError';this.code=code;if(needsReview)this.needsReview=true;}
}
const problem=(code,message,options)=>new TeamsError(code,message,options);
function identifier(value,label='対象'){
 if(typeof value!=='string'||!value||value.length>512||!(/^[A-Za-z0-9_.:@+=-]+$/).test(value)||value==='.'||value==='..')throw problem('invalid_target',label+'を一覧から選択してください。');
 return value;
}
function validatedConfiguration(value){
 const config=configuration(value);
 if(!config.enabled)throw problem('disabled','TeamsプラグインをONにしてください。');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.clientId))throw problem('invalid_configuration','Teamsのアプリケーション（クライアント）IDを設定してください。');
 if(!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(config.tenant)||config.tenant.includes('..'))throw problem('invalid_configuration','TeamsのテナントIDまたはドメインを確認してください。');
 if(config.targetKind==='channel'){identifier(config.teamId,'チームID');identifier(config.channelId,'チャネルID');}
 return config;
}
function verificationURL(value){
 if(value!=='https://microsoft.com/devicelogin')throw problem('invalid_response','Microsoftのログイン案内を読み込めません。');
 return value;
}
function messageURL(value){
 if(typeof value!=='string'||value.length>6000)return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&url.hostname==='teams.microsoft.com'&&url.pathname.startsWith('/l/')?url.href:'';}catch{return '';}
}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',bull:'•'};
export function teamsPlainText(value,contentType='html'){
 let text=bounded(value,200000);
 if(typeof contentType==='string'&&contentType.toLowerCase()==='html')text=text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<\s*br\b[^>]*>/gi,'\n').replace(/<\s*\/(?:p|div|li|blockquote|h[1-6]|tr)\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi,(whole,entity)=>{
  if(entity[0]!=='#')return Object.hasOwn(entities,entity.toLowerCase())?entities[entity.toLowerCase()]:whole;
  const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';
 });
 return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
}
function messageRow(value,expectedId){
 if(!value||typeof value!=='object')throw problem('invalid_response','Teamsのメッセージ形式を確認できません。');
 const id=identifier(value.id,'メッセージ');if(expectedId!==undefined&&id!==expectedId)throw problem('invalid_response','TeamsのメッセージIDが一致しません。');
 if(value.body!==undefined&&(!value.body||typeof value.body.content!=='string'||typeof value.body.contentType!=='string'||!['html','text'].includes(value.body.contentType.toLowerCase())))throw problem('invalid_response','Teamsのメッセージ形式を確認できません。');
 const content=value.body?.content||'',text=teamsPlainText(content,value.body?.contentType||'text');
 return {id,text:text.slice(0,20000),author:bounded(value.from?.user?.displayName||value.from?.application?.displayName,200),createdAt:bounded(value.createdDateTime,80),webUrl:messageURL(value.webUrl),truncated:content.length>200000||text.length>20000};
}
function chatRow(value){
 if(!value||typeof value!=='object')throw problem('invalid_response','Teamsのチャット一覧の形式を確認できません。');
 const id=identifier(value.id,'チャット'),labels={oneOnOne:'個別チャット',group:'グループチャット',meeting:'会議チャット'};return {id,title:bounded(value.topic,300).trim()||(Object.hasOwn(labels,value.chatType)?labels[value.chatType]:'チャット'),chatType:bounded(value.chatType,40),webUrl:messageURL(value.webUrl)};
}
function retryTime(value,now){
 let duration;if(value&&/^\d+$/.test(value.trim()))duration=Number(value)*1000;else if(value){const date=Date.parse(value);if(Number.isFinite(date))duration=date-now;}
 return now+Math.min(3600000,Math.max(1000,Number.isFinite(duration)?duration:60000));
}

export class TeamsService{
 constructor({getConfiguration,onChange=()=>{},fetcher=globalThis.fetch,clock=Date.now,timeout=20000}){
  Object.assign(this,{getConfiguration,onChange,fetcher,clock,timeout});this.configurationKey=teamsConfigurationKey(getConfiguration());this.generation=0;this.credential=null;this.login=null;this.controllers=new Set();this.pages=new Map();this.messages=new Map();this.blockedUntil=0;this.lastError=null;this.closed=false;
 }
 public(){
  const now=this.clock(),config=configuration(this.getConfiguration());return {enabled:config.enabled,mode:config.targetKind,connected:Boolean(config.enabled&&this.credential&&this.credential.expiresAt>now&&this.configurationKey===teamsConfigurationKey(config)),login:this.login?{userCode:this.login.userCode,verificationUri:this.login.verificationUri,expiresAt:this.login.expiresAt,nextPollAt:this.login.nextPollAt}:null,error:this.lastError?{...this.lastError}:null,retryAt:this.blockedUntil>now?this.blockedUntil:null};
 }
 changed(){this.onChange(this.public());}
 invalidate(){this.generation++;for(const controller of this.controllers)controller.abort();this.pages.clear();this.messages.clear();}
 configurationChanged(){
  const key=teamsConfigurationKey(this.getConfiguration());if(key===this.configurationKey)return this.public();
  this.configurationKey=key;this.invalidate();this.credential=null;this.login=null;this.blockedUntil=0;this.lastError=null;this.changed();return this.public();
 }
 forget(){this.invalidate();this.credential=null;this.login=null;this.blockedUntil=0;this.lastError=null;this.changed();return this.public();}
 cancelLogin(){if(this.login){this.invalidate();this.login=null;this.lastError=null;this.changed();}return this.public();}
 close(){this.closed=true;this.invalidate();this.credential=null;this.login=null;}
 configurationContext(){
  if(this.closed)throw problem('closed','Teamsの接続を終了しました。');
  const config=validatedConfiguration(this.getConfiguration());if(teamsConfigurationKey(config)!==this.configurationKey)throw problem('configuration_changed','Teamsの接続設定が変わりました。操作をやり直してください。');
  return {generation:this.generation,configurationKey:this.configurationKey,config};
 }
 context(){
  const context=this.configurationContext();if(!this.credential)throw problem('not_connected','Teamsにログインしてください。');
  if(this.credential.expiresAt<=this.clock())throw problem('login_expired','Teamsのログイン期限が切れました。ログインし直してください。');
  return {generation:context.generation,configurationKey:context.configurationKey,accountId:this.credential.accountId};
 }
 assertCurrent(context){
  if(this.closed||!context||context.generation!==this.generation||context.configurationKey!==this.configurationKey||teamsConfigurationKey(this.getConfiguration())!==this.configurationKey||!this.getConfiguration().enabled||(context.accountId!==undefined&&context.accountId!==this.credential?.accountId))throw problem('configuration_changed','Teamsの接続設定またはログインが変わりました。操作をやり直してください。');
 }
 record(error,context){const safe=error instanceof TeamsError?error:problem('request_failed','Teamsの応答を確認できません。操作をやり直してください。');if(context?.generation===this.generation){this.lastError={code:safe.code,message:safe.message,...(safe.needsReview?{needsReview:true}:{})};this.changed();}return safe;}
 checkRate(){if(this.blockedUntil>this.clock())throw problem('rate_limited','Teamsの利用制限中です。表示された再取得時刻以降に操作してください。');}
 async readJSON(response){
  if(!response.headers.get('content-type')?.toLowerCase().match(/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:;|$)/))throw problem('invalid_response','Microsoftの応答形式を確認できません。');
  if(Number(response.headers.get('content-length'))>maximumBytes){await response.body?.cancel().catch(()=>{});throw problem('response_too_large','Teamsの応答が大きすぎます。取得条件を絞ってください。');}
  if(!response.body)throw problem('invalid_response','Microsoftの応答データを読み込めません。');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maximumBytes)throw problem('response_too_large','Teamsの応答が大きすぎます。取得条件を絞ってください。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem('invalid_response','Microsoftの応答データを読み込めません。');}
 }
 async request(context,url,{method='GET',body,oauth=false,post=false}={}){
  this.assertCurrent(context);this.checkRate();
  const controller=new AbortController();this.controllers.add(controller);let timedOut=false,dispatched=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeout);
  try{
   const headers={Accept:'application/json'};if(oauth)headers['Content-Type']='application/x-www-form-urlencoded';else{headers.Authorization='Bearer '+this.credential.token;if(body!==undefined)headers['Content-Type']='application/json';}
   dispatched=true;const response=await this.fetcher(url,{method,headers,redirect:'error',signal:controller.signal,...(body!==undefined?{body:oauth?new URLSearchParams(body).toString():JSON.stringify(body)}:{})});this.assertCurrent(context);
   if(response.status===429)this.blockedUntil=retryTime(response.headers.get('Retry-After'),this.clock());
   if(!response.ok&&!oauth){
    await response.body?.cancel().catch(()=>{});const messages={401:'Teamsの認証が失効しました。ログインし直してください。',403:'Teamsへのアクセス権限がありません。アプリの権限と対象への参加を確認してください。',404:'Teamsのチャットまたはメッセージが見つかりません。',408:'Teamsへの送信結果を確認できません。元の画面で送信済みか確認してください。',429:'Teamsの利用制限に達しました。時間をおいて再取得してください。'};
    const error=problem(response.status===429?'rate_limited':response.status===401?'unauthorized':response.status===403?'forbidden':response.status===404?'not_found':'http_error',messages[response.status]||'Teamsが応答エラーを返しました（HTTP '+response.status+'）。',{needsReview:post&&(response.status>=500||response.status===408)});
    if(response.status===401){this.invalidate();this.credential=null;this.lastError={code:error.code,message:error.message};this.changed();}throw error;
   }
   const value=await this.readJSON(response);this.assertCurrent(context);return {status:response.status,ok:response.ok,value};
  }catch(error){
   let safe=error instanceof TeamsError?error:problem(timedOut?'timeout':'network_error',timedOut?'Microsoftから制限時間内に応答がありませんでした。':'Microsoftに接続できませんでした。通信状態を確認してください。');
   if(post&&dispatched&&(!['forbidden','not_found','unauthorized','rate_limited','http_error'].includes(safe.code)||safe.needsReview))safe=problem(safe.code,safe.message,{needsReview:true});
   throw safe;
  }finally{clearTimeout(timer);controller.abort();this.controllers.delete(controller);}
 }
 async beginLogin(){
  const initial=this.configurationContext();this.checkRate();this.invalidate();this.credential=null;this.login=null;this.lastError=null;const context={...initial,generation:this.generation};this.changed();
  const scope=context.config.targetKind==='channel'?'ChannelMessage.Read.All ChannelMessage.Send':'Chat.Read ChatMessage.Send';
  try{
   const result=await this.request(context,new URL('/'+encodeURIComponent(context.config.tenant)+'/oauth2/v2.0/devicecode',loginOrigin),{method:'POST',oauth:true,body:{client_id:context.config.clientId,scope}});
   if(!result.ok)throw result.status===429?problem('rate_limited','Microsoftのログインが利用制限中です。時間をおいて接続してください。'):this.oauthError(result.value?.error);
   const value=result.value;if(typeof value?.device_code!=='string'||value.device_code.length<1||value.device_code.length>8192||typeof value.user_code!=='string'||!value.user_code||value.user_code.length>64||!Number.isSafeInteger(value.expires_in)||value.expires_in<1||value.expires_in>3600||value.interval!==undefined&&(!Number.isSafeInteger(value.interval)||value.interval<1||value.interval>300))throw problem('invalid_response','Microsoftのログイン案内を読み込めません。');
   const interval=(value.interval??5)*1000,now=this.clock();this.login={deviceCode:value.device_code,userCode:value.user_code,verificationUri:verificationURL(value.verification_uri),expiresAt:now+value.expires_in*1000,interval,nextPollAt:now+interval,inFlight:false};this.changed();return this.public();
  }catch(error){throw this.record(error,context);}
 }
 oauthError(code){
  const errors={authorization_declined:['login_denied','Teamsへのログインが承認されませんでした。'],access_denied:['login_denied','Teamsへのログインが承認されませんでした。'],expired_token:['login_expired','Teamsのログイン操作の期限が切れました。もう一度ログインしてください。'],bad_verification_code:['login_expired','Teamsのログイン操作をやり直してください。'],invalid_client:['invalid_configuration','TeamsのクライアントIDと、パブリッククライアントの設定を確認してください。'],unauthorized_client:['invalid_configuration','このアプリではデバイスログインを使用できません。アプリ登録の設定を確認してください。'],invalid_scope:['invalid_configuration','Teamsのアプリに必要なアクセス権限を設定してください。']};
  const [safeCode,message]=Object.hasOwn(errors,code)?errors[code]:['login_failed','Teamsへのログインを完了できませんでした。もう一度ログインしてください。'];return problem(safeCode,message);
 }
 async pollLogin(){
  const context=this.configurationContext(),login=this.login;if(!login)return this.public();
  if(login.expiresAt<=this.clock()){this.login=null;throw this.record(this.oauthError('expired_token'),context);}
  if(login.inFlight||login.nextPollAt>this.clock())return this.public();
  this.checkRate();login.inFlight=true;login.nextPollAt=this.clock()+login.interval;
  try{
   const result=await this.request(context,new URL('/'+encodeURIComponent(context.config.tenant)+'/oauth2/v2.0/token',loginOrigin),{method:'POST',oauth:true,body:{client_id:context.config.clientId,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:login.deviceCode}});
   if(!result.ok){
    if(result.status===429){login.nextPollAt=Math.max(login.nextPollAt,this.blockedUntil);throw problem('rate_limited','Microsoftのログイン確認が利用制限中です。時間をおいて確認してください。');}
    if(result.value?.error==='authorization_pending'){this.lastError=null;this.changed();return this.public();}
    if(result.value?.error==='slow_down'){login.interval+=5000;login.nextPollAt=this.clock()+login.interval;this.lastError=null;this.changed();return this.public();}
    this.login=null;throw this.oauthError(result.value?.error);
   }
   const value=result.value;if(typeof value?.access_token!=='string'||!value.access_token||value.access_token.length>32768||/[\u0000-\u0020\u007f]/.test(value.access_token)||typeof value.token_type!=='string'||value.token_type.toLowerCase()!=='bearer'||!Number.isSafeInteger(value.expires_in)||value.expires_in<1||value.expires_in>86400)throw problem('invalid_response','Microsoftのログイン結果を確認できません。');
   this.invalidate();this.credential={token:value.access_token,expiresAt:this.clock()+value.expires_in*1000,accountId:randomUUID()};this.login=null;this.lastError=null;this.changed();return this.public();
  }catch(error){throw this.record(error,context);}finally{login.inFlight=false;}
 }
 target({chatId}={}){
  const config=validatedConfiguration(this.getConfiguration());return config.targetKind==='channel'?{kind:'channel',teamId:config.teamId,channelId:config.channelId}:{kind:'chat',chatId:identifier(chatId,'チャット')};
 }
 collection(target){return target.kind==='channel'?'/teams/'+encodeURIComponent(target.teamId)+'/channels/'+encodeURIComponent(target.channelId)+'/messages':'/chats/'+encodeURIComponent(target.chatId)+'/messages';}
 pageURL(context,pathname,page){
  if(page!==undefined&&page!==null&&page!==''){
   if(typeof page!=='string'||page.length>100)throw problem('invalid_page','Teamsの一覧を最初から取得してください。');const cursor=this.pages.get(page);
   if(!cursor||cursor.configurationKey!==context.configurationKey||cursor.generation!==context.generation||cursor.pathname!==pathname)throw problem('invalid_page','Teamsの一覧を最初から取得してください。');return new URL(cursor.url);
  }
  const url=new URL('/v1.0'+pathname,graphOrigin);url.searchParams.set('$top','25');return url;
 }
 nextPage(context,pathname,value){
  if(value===undefined||value===null)return null;
  let url;try{url=new URL(value);}catch{throw problem('invalid_response','Teamsの次ページの形式を確認できません。');}
  if(typeof value!=='string'||value.length>12000||url.origin!==graphOrigin||url.pathname!=='/v1.0'+pathname||url.username||url.password||url.hash||[...url.searchParams.keys()].some(key=>!['$top','$skiptoken','$skip','$orderby','$filter'].includes(key)))throw problem('invalid_response','Teamsの次ページの形式を確認できません。');
  const page=randomUUID();this.pages.set(page,{url:url.href,pathname,generation:context.generation,configurationKey:context.configurationKey});while(this.pages.size>100)this.pages.delete(this.pages.keys().next().value);return page;
 }
 async listChats({page}={}){
  const context=this.context();if(configuration(this.getConfiguration()).targetKind!=='chat')throw problem('invalid_target','チャネルのメッセージ取得を選択してください。');
  const pathname='/me/chats';try{const {value}=await this.request(context,this.pageURL(context,pathname,page));if(!Array.isArray(value?.value)||value.value.length>100)throw problem('invalid_response','Teamsのチャット一覧の形式を確認できません。');const chats=value.value.map(chatRow),nextPage=this.nextPage(context,pathname,value['@odata.nextLink']);this.lastError=null;this.changed();return {chats,nextPage};}catch(error){throw this.record(error,context);}
 }
 async listMessages({chatId,page}={}){
  const context=this.context(),target=this.target({chatId}),pathname=this.collection(target);
  try{const {value}=await this.request(context,this.pageURL(context,pathname,page));if(!Array.isArray(value?.value)||value.value.length>100)throw problem('invalid_response','Teamsのメッセージ一覧の形式を確認できません。');const messages=value.value.map(row=>messageRow(row)),nextPage=this.nextPage(context,pathname,value['@odata.nextLink']);for(const message of messages)this.remember(target,message);this.lastError=null;this.changed();return {messages,nextPage,target};}catch(error){throw this.record(error,context);}
 }
 remember(target,message){this.messages.set(JSON.stringify([target,message.id]),message);while(this.messages.size>200)this.messages.delete(this.messages.keys().next().value);}
 async getMessage({chatId,messageId}={}){
  const context=this.context(),target=this.target({chatId}),id=identifier(messageId,'メッセージ');
  try{const {value}=await this.request(context,new URL('/v1.0'+this.collection(target)+'/'+encodeURIComponent(id),graphOrigin));const message=messageRow(value,id);this.remember(target,message);this.lastError=null;this.changed();return {message,target,context};}catch(error){throw this.record(error,context);}
 }
 async postReply({chatId,messageId,text,context:providedContext}={}){
  const context=providedContext||this.context();this.assertCurrent(context);this.context();const target=this.target({chatId}),id=identifier(messageId,'メッセージ');
  if(typeof text!=='string'||!text.trim()||text.length>12000||/[\u0000\u0008\u000b\u000c]/.test(text))throw problem('invalid_reply','送信する返信文を確認してください。');
  const path=this.collection(target)+(target.kind==='channel'?'/'+encodeURIComponent(id)+'/replies':'');
  try{const {value}=await this.request(context,new URL('/v1.0'+path,graphOrigin),{method:'POST',post:true,body:{body:{contentType:'text',content:text}}});let message;try{message=messageRow(value);}catch{throw problem('invalid_response','送信後の応答を確認できません。Teams側で送信済みか確認してください。',{needsReview:true});}this.lastError=null;this.changed();return {message,target};}catch(error){throw this.record(error,context);}
 }
}
