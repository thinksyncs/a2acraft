import path from 'node:path';
import {ensureAgentWorkspace,initializeIsolatedCodexHome,buildIsolatedCodexEnvironment} from './codex-workspace-policy.mjs';

export async function prepareCodexLaunch({data,workspace,executable,environment=process.env}) {
  await ensureAgentWorkspace(workspace);
  const codexHome=path.join(data,'codex');
  await initializeIsolatedCodexHome(codexHome);
  const env=buildIsolatedCodexEnvironment(environment,{codexHome,workspace});
  // Keep normal development tools available only through the explicitly selected
  // runtime and system directories; never inherit user shell startup or PATH.
  if(path.isAbsolute(executable)){
    const bin=path.dirname(executable);
    env.PATH=[bin,path.join(bin,'..','codex-path'),path.dirname(process.execPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter);
  }
  return {executable,args:['app-server','--listen','stdio://'],env,cwd:workspace};
}

export function verifyIsolatedConfig(value) {
  const config=value?.config;
  if(!config||config.forced_login_method!=='chatgpt'||config.cli_auth_credentials_store!=='file'||config.allow_login_shell!==false)
    throw Error('Codexの専用設定を確認できません。接続を停止しました。');
  // App Server expands an empty hooks table into named events with empty arrays.
  const configuredHooks=Object.values(config.hooks||{}).some(value=>!Array.isArray(value)||value.length>0);
  if(Object.keys(config.mcp_servers||{}).length||configuredHooks)
    throw Error('専用設定に外部ツールまたはフックがあります。接続を停止しました。');
  for(const key of ['apps','plugins','remote_plugin','hooks','shell_snapshot','skill_mcp_dependency_install'])
    if(config.features?.[key]!==false)throw Error('Codexの外部連携を無効と確認できません。接続を停止しました。');
  return true;
}

// thread/start, resume and fork return the effective policy at the top level.
// Managed profiles may override the requested legacy sandbox; never assume the
// request itself established read-only execution. This is not a reconstruction
// of a named profile's complete allow/deny rules.
export function verifyThreadPermissions(result,{cwd,readOnly=true}) {
  const fail=message=>{throw Object.assign(Error(message+' 指示は送信していません。'),{code:'execution_scope'});};
  if(typeof result?.cwd!=='string'||!path.isAbsolute(result.cwd)||path.normalize(result.cwd)!==path.normalize(cwd))
    fail('Codexの作業フォルダを確認できません。');
  if(result.approvalPolicy!=='never')fail('Codexの承認設定を確認できません。');
  const policy=result.sandbox;
  if(readOnly){
    if(policy?.type!=='readOnly')fail('読み取り専用の実行権限を確認できません。管理設定により要求した範囲と異なる可能性があります。');
  }else{
    if(policy?.type==='readOnly')fail('Codexが読み取り専用のため、ファイル作業を開始できません。');
    if(policy?.type!=='workspaceWrite')fail('作業フォルダ内に限定した実行権限を確認できません。');
    if(!Array.isArray(policy.writableRoots)||policy.writableRoots.some(root=>{
      if(typeof root!=='string'||!path.isAbsolute(root))return true;
      const relative=path.relative(cwd,root);
      return relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative);
    }))fail('管理設定の書き込み範囲が、この会話の作業フォルダを超えています。');
  }
  return true;
}
