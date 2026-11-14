import path from 'node:path';
import {LocalStore} from './local-store.mjs';
const teamsDefaults=()=>({enabled:false,clientId:'',tenant:'organizations',targetKind:'chat',teamId:'',channelId:''});
export class PluginStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'plugins.json'),{version:1,revision:0,backlog:{enabled:false,url:''},teams:teamsDefaults()},onChange);}
 async load(){await super.load(value=>{if(value.version!==1||typeof value.backlog?.enabled!=='boolean'||typeof value.backlog.url!=='string')throw Error('プラグイン設定を確認できません。');this.validateURL(value.backlog.url);if(value.teams)this.validateTeams(value.teams);});this.value.teams||=teamsDefaults();return this;}
 validateURL(value){if(value==='')return '';if(typeof value!=='string'||value.length>2048)throw Error('接続先URLを確認してください。');let url;try{url=new URL(value);}catch{throw Error('接続先はHTTPSのURLで入力してください。');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('接続先は認証情報・クエリを含まないHTTPSのURLにしてください。');return url.href;}
 async configure({enabled,url}){if(typeof enabled!=='boolean')throw Error('プラグインのON/OFFを指定してください。');url=this.validateURL(url);await this.mutate(value=>{value.backlog={enabled,url};});return this.public();}
 validateTeams(input){
  if(!input||typeof input.enabled!=='boolean'||!['chat','channel'].includes(input.targetKind))throw Error('TeamsのON/OFFと受信先を確認してください。');
  const fields={};for(const key of ['clientId','tenant','teamId','channelId']){if(typeof input[key]!=='string')throw Error('Teamsの接続設定を確認してください。');fields[key]=input[key].trim();}
  const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(fields.clientId&&!guid.test(fields.clientId))throw Error('アプリのクライアントIDを確認してください。');
  if(!fields.tenant||fields.tenant.length>253||!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(fields.tenant)||fields.tenant.toLowerCase()==='consumers')throw Error('職場・学校アカウントのテナントを指定してください。');
  if(fields.teamId&&!guid.test(fields.teamId))throw Error('チームIDを確認してください。');
  if(fields.channelId&&(fields.channelId.length>512||/[\s\x00-\x1f\x7f/\\?#%]/.test(fields.channelId)))throw Error('チャンネルIDを確認してください。');
  return {enabled:input.enabled,...fields,clientId:fields.clientId.toLowerCase(),tenant:fields.tenant.toLowerCase(),targetKind:input.targetKind};
 }
 async configureTeams(input){const configuration=this.validateTeams(input);await this.mutate(value=>{value.teams=configuration;});return this.public();}
}
