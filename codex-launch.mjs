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

// Codex 0.169 exposes allowedPermissionProfiles as a map of profile IDs to
// booleans. Select only the application's fixed, explicitly allowed profiles;
// do not manufacture a profile or clear the administrator's default policy.
export function threadPermissionRequest(params, requirements) {
  const profile = params?.sandbox === 'read-only' ? 'a2acraft-chat' :
    params?.sandbox === 'workspace-write' ? 'a2acraft-work' : null;
  const allowed = requirements?.allowedPermissionProfiles;
  if (!profile || !allowed || typeof allowed !== 'object' || Array.isArray(allowed) ||
      !Object.hasOwn(allowed, profile) || allowed[profile] !== true) return params;
  if (typeof params.cwd !== 'string' || !path.isAbsolute(params.cwd))
    throw Object.assign(Error('Codexの作業フォルダを確認できません。指示は送信していません。'), {code: 'execution_scope'});
  const {sandbox: _sandbox, ...request} = params;
  return {...request, permissions: profile, runtimeWorkspaceRoots: [params.cwd]};
}

// Only fixed enums, counts and booleans leave the permission verifier. Never
// attach the raw response, path, profile content or account data to an error.
export function threadPermissionDiagnostics(value, {cwd, expectedProfile}) {
  const roots = value?.sandbox?.writableRoots;
  const validCwd = typeof cwd === 'string' && path.isAbsolute(cwd);
  const cwdMatches = validCwd && typeof value?.cwd === 'string' && path.isAbsolute(value.cwd) &&
    path.normalize(value.cwd) === path.normalize(cwd);
  const approvalPolicy = ['never', 'on-request', 'on-failure', 'untrusted'].includes(value?.approvalPolicy)
    ? value.approvalPolicy : 'unknown';
  const sandboxType = ['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox'].includes(value?.sandbox?.type)
    ? value.sandbox.type : 'unknown';
  const writableRootsWithinScope = Array.isArray(roots) ? validCwd && roots.every(root => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) return false;
    const relative = path.relative(cwd, root);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  }) : null;
  const responsePolicyFields = ['sandbox', 'sandboxPolicy', 'permissions', 'activePermissionProfile', 'permissionProfile',
    'permissionsProfile', 'permissionProfileName', 'approvalPolicy', 'cwd']
    .filter(key => value !== null && typeof value === 'object' && Object.hasOwn(value, key));
  const boolean = flag => typeof flag === 'boolean' ? flag : null;
  return {cwdMatches, approvalPolicy, sandboxType,
    writableRootsCount: Array.isArray(roots) ? roots.length : null,
    writableRootsWithinScope, responsePolicyFields,
    profileMatches: expectedProfile === undefined ? null : value?.activePermissionProfile?.id === expectedProfile,
    networkAccess: boolean(value?.sandbox?.networkAccess),
    excludeTmpdirEnvVar: boolean(value?.sandbox?.excludeTmpdirEnvVar),
    excludeSlashTmp: boolean(value?.sandbox?.excludeSlashTmp)};
}

// thread/start, resume and fork return the effective policy at the top level.
// Managed profiles may override the requested legacy sandbox; never assume the
// request itself established read-only execution. This is not a reconstruction
// of a named profile's complete allow/deny rules.
export function verifyThreadPermissions(result,{cwd,readOnly=true,expectedProfile}) {
  const fail=message=>{throw Object.assign(Error(message+' 指示は送信していません。'),{
    code:'execution_scope',diagnostics:threadPermissionDiagnostics(result,{cwd,expectedProfile})});};
  if(typeof result?.cwd!=='string'||!path.isAbsolute(result.cwd)||path.normalize(result.cwd)!==path.normalize(cwd))
    fail('Codexの作業フォルダを確認できません。');
  if(result.approvalPolicy!=='never')fail('Codexの承認設定を確認できません。');
  if(expectedProfile!==undefined&&(typeof expectedProfile!=='string'||!expectedProfile||result.activePermissionProfile?.id!==expectedProfile))
    fail('Codexの実行権限プロファイルを確認できません。');
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
  if(expectedProfile!==undefined){
    if(policy.networkAccess!==false)fail('Codexの外部通信を無効と確認できません。');
    if(!readOnly&&(policy.excludeTmpdirEnvVar!==true||policy.excludeSlashTmp!==true))
      fail('Codexの一時フォルダへの追加書き込みを無効と確認できません。');
  }
  return true;
}
