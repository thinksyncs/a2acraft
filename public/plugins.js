import {toolText} from './i18n-tools.js';
import {backlogPlugin} from './plugins/backlog.js';
import {teamsPlugin} from './plugins/teams.js';
const teamsDefaults=()=>({enabled:false,clientId:'',tenant:'organizations',targetKind:'chat',teamId:'',channelId:''});
export function initPlugins({api,demo,storeKey,onDisabled,onTeamsDisabled,notify,getTodos,onTodo,getChats,getModel,getState,onSelect,onOpenExternal,onBoard}){
 const $=selector=>document.querySelector(selector);let value={version:1,revision:0,backlog:{enabled:false,url:''},teams:teamsDefaults()},mounted,key='',teamsMounted,teamsKey='',teamsStatus,teamsDrafts,teamsSettingsDirty=false,teamsSettingsBusy=false,backlogUrlDirty=false;
 if(demo)try{const saved=JSON.parse(localStorage.getItem(storeKey+'-plugins'));if(saved?.backlog)value={...value,...saved,teams:{...teamsDefaults(),...saved.teams}};}catch{}
 async function configure(config){const next=demo?{...value,revision:value.revision+1,backlog:config}:await api('plugins/backlog',config);if(demo)localStorage.setItem(storeKey+'-plugins',JSON.stringify(next));backlogUrlDirty=false;hydrate(next);}
 async function configureTeams(config){if(teamsSettingsBusy)return;teamsSettingsBusy=true;render();try{const next=demo?{...value,revision:value.revision+1,teams:config}:await api('plugins/teams',config);if(demo)localStorage.setItem(storeKey+'-plugins',JSON.stringify(next));teamsSettingsDirty=false;hydrate(next);notify(toolText('Teamsプラグインの設定を保存しました。'));}finally{teamsSettingsBusy=false;render();}}
 function hydrate(next){if(!next||(!demo&&(next.revision||0)<(value.revision||0)))return;if(!demo||next.backlog)value={...next,teams:{...teamsDefaults(),...next.teams}};render();}
 function teamsConfiguration(){return {enabled:$('#teams-enabled').checked,clientId:$('#teams-client-id').value.trim(),tenant:$('#teams-tenant').value.trim()||'organizations',targetKind:$('#teams-target-kind').value,teamId:$('#teams-team-id').value.trim(),channelId:$('#teams-channel-id').value.trim()};}
 function renderTeams(){
  const config=value.teams;$('#teams-plugin-state').textContent=config.enabled?'ON':'OFF';$('#teams-launch-state').textContent=config.enabled?(teamsStatus?.connected?toolText('接続済み · 確認して送信'):toolText('ON · Microsoftに接続')):toolText('OFF · 接続設定から有効にする');$('#teams-launch-switch').dataset.enabled=String(config.enabled);
  if(!teamsSettingsDirty){$('#teams-enabled').checked=config.enabled;for(const [id,field] of [['teams-client-id','clientId'],['teams-tenant','tenant'],['teams-target-kind','targetKind'],['teams-team-id','teamId'],['teams-channel-id','channelId']])if(document.activeElement!==$('#'+id))$('#'+id).value=config[field];}
  $('#teams-channel-settings').hidden=$('#teams-target-kind').value!=='channel';for(const field of $('#teams-settings-form').querySelectorAll('input,select,button'))field.disabled=teamsSettingsBusy;
  const next=JSON.stringify(config);if(next===teamsKey){teamsMounted?.render();return;}teamsKey=next;teamsMounted?.dispose();teamsMounted=null;
  if(config.enabled){teamsMounted=teamsPlugin.mount({api,demo,getChats,getModel,getState,onSelect,onOpenExternal,onTodo,onBoard,container:$('#teams-content'),configuration:config,notify});if(teamsStatus)teamsMounted.statusChanged(teamsStatus);if(teamsDrafts)teamsMounted.statusChanged(teamsDrafts);}
  else onTeamsDisabled?.();
 }
 function render(){
  $('#backlog-enabled').checked=value.backlog.enabled;$('#backlog-plugin-state').textContent=value.backlog.enabled?'ON':'OFF';$('#backlog-launch').hidden=!value.backlog.enabled;$('#backlog-quick').hidden=!value.backlog.enabled;if(!backlogUrlDirty&&document.activeElement!==$('#backlog-settings-url'))$('#backlog-settings-url').value=value.backlog.url;
  const next=JSON.stringify(value.backlog);if(next===key)mounted?.render();else{key=next;mounted?.dispose();mounted=null;
   if(value.backlog.enabled)mounted=backlogPlugin.mount({api,demo,getTodos,onTodo,container:$('#backlog-content'),configuration:value.backlog,onConfigure:configure,notify});else onDisabled();}
  renderTeams();
 }
 $('#backlog-settings-url').addEventListener('input',()=>{backlogUrlDirty=true;});
 $('#backlog-settings-form').onsubmit=async event=>{event.preventDefault();try{await configure({enabled:$('#backlog-enabled').checked,url:$('#backlog-settings-url').value.trim()});notify(toolText('Backlogプラグインの設定を保存しました。'));}catch(error){notify(error.message);render();}};
 $('#backlog-enabled').onchange=async()=>{try{await configure({enabled:$('#backlog-enabled').checked,url:$('#backlog-settings-url').value.trim()});}catch(error){notify(error.message);render();}};
 $('#teams-settings-form').oninput=()=>{teamsSettingsDirty=true;$('#teams-channel-settings').hidden=$('#teams-target-kind').value!=='channel';};
 $('#teams-settings-form').onsubmit=async event=>{event.preventDefault();try{await configureTeams(teamsConfiguration());}catch(error){notify(error.message);renderTeams();}};
 $('#teams-enabled').onchange=async()=>{teamsSettingsDirty=true;try{await configureTeams(teamsConfiguration());}catch(error){notify(error.message);renderTeams();}};
 $('#teams-target-kind').onchange=()=>{teamsSettingsDirty=true;$('#teams-channel-settings').hidden=$('#teams-target-kind').value!=='channel';};
 addEventListener('pagehide',()=>{mounted?.dispose();teamsMounted?.dispose();});
 return {hydrate,render,openTeamsDraft:id=>teamsMounted?.openDraft(id),statusChanged:value=>mounted?.statusChanged(value),enabled:()=>value.backlog.enabled,teamsEnabled:()=>value.teams.enabled,teamsStatusChanged(next){if(!next)return;teamsStatus=next;teamsMounted?.statusChanged(next);$('#teams-launch-state').textContent=value.teams.enabled?(next.connected?toolText('接続済み · 確認して送信'):toolText('ON · Microsoftに接続')):toolText('OFF · 接続設定から有効にする');},teamsDraftsChanged(next){if(!next||(teamsDrafts&&(next.revision||0)<(teamsDrafts.revision||0)))return;teamsDrafts=next;teamsMounted?.statusChanged(next);}};
}
