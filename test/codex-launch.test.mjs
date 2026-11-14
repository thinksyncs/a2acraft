import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIsolatedConfig,verifyThreadPermissions,threadPermissionRequest} from '../codex-launch.mjs';
const isolated=()=>({config:{forced_login_method:'chatgpt',cli_auth_credentials_store:'file',allow_login_shell:false,
  mcp_servers:{},hooks:{SessionStart:[],PreToolUse:[]},features:Object.fromEntries(['apps','plugins','remote_plugin','hooks','shell_snapshot','skill_mcp_dependency_install'].map(key=>[key,false]))}});
test('normalized empty hook events do not prevent the real Codex connection',()=>{
  assert.equal(verifyIsolatedConfig(isolated()),true);
});
test('an injected tool server or hook fails before any turn is allowed',()=>{
  const server=isolated();server.config.mcp_servers.example={command:'/usr/bin/false'};
  assert.throws(()=>verifyIsolatedConfig(server),/接続を停止/);
  const hook=isolated();hook.config.hooks.SessionStart=[{hooks:[{type:'command',command:'/usr/bin/false'}]}];
  assert.throws(()=>verifyIsolatedConfig(hook),/接続を停止/);
  const feature=isolated();feature.config.features.plugins=true;
  assert.throws(()=>verifyIsolatedConfig(feature),/接続を停止/);
});

test('effective thread permissions fail closed and do not accept requested mode as evidence',()=>{
  const result={cwd:'/task/workspace',approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false}};
  assert.equal(verifyThreadPermissions(result,{cwd:result.cwd}),true);
  for(const sandbox of [undefined,null,{type:'workspaceWrite',writableRoots:[]},{type:'dangerFullAccess'},{type:'externalSandbox'},{type:'futurePolicy'}])
    assert.throws(()=>verifyThreadPermissions({...result,sandbox},{cwd:result.cwd}),/読み取り専用/);
  assert.throws(()=>verifyThreadPermissions({...result,cwd:'/other'},{cwd:result.cwd}),/作業フォルダ/);
  assert.throws(()=>verifyThreadPermissions({...result,approvalPolicy:'on-request'},{cwd:result.cwd}),/承認設定/);
  assert.throws(()=>verifyThreadPermissions(result,{cwd:result.cwd,readOnly:false}),/ファイル作業を開始できません/);
  const work={...result,sandbox:{type:'workspaceWrite',writableRoots:[]}};
  assert.equal(verifyThreadPermissions(work,{cwd:result.cwd,readOnly:false}),true);
  assert.equal(verifyThreadPermissions({...work,sandbox:{...work.sandbox,writableRoots:['/task/workspace/child']}},{cwd:result.cwd,readOnly:false}),true);
  for(const writableRoots of [undefined,['/task/workspace-sibling'],['/task'],['relative'],[null]])
    assert.throws(()=>verifyThreadPermissions({...work,sandbox:{...work.sandbox,writableRoots}},{cwd:result.cwd,readOnly:false}),/書き込み範囲/);
});

test('managed thread requests select only explicitly allowed fixed child profiles with the exact working root',()=>{
  const requirements={defaultPermissions:'protected-workspace',allowedPermissionProfiles:{'protected-workspace':true,'a2acraft-chat':true,'a2acraft-work':true}};
  for(const [sandbox,profile] of [['read-only','a2acraft-chat'],['workspace-write','a2acraft-work']]){
    const params={cwd:'/task/workspace',sandbox,approvalPolicy:'never',ephemeral:true,developerInstructions:'Keep protections',runtimeWorkspaceRoots:['/unrelated']};
    const previous=structuredClone(params),result=threadPermissionRequest(params,requirements);
    assert.deepEqual(result,{cwd:params.cwd,approvalPolicy:'never',ephemeral:true,developerInstructions:'Keep protections',permissions:profile,runtimeWorkspaceRoots:[params.cwd]});
    assert.deepEqual(params,previous);
    assert.equal(Object.hasOwn(result,'sandbox'),false);
  }
  assert.deepEqual(requirements.allowedPermissionProfiles,{'protected-workspace':true,'a2acraft-chat':true,'a2acraft-work':true});
});

test('missing, denied, malformed or unknown profile requirements retain the original legacy request',()=>{
  const params={cwd:'/task/workspace',sandbox:'read-only',approvalPolicy:'never'};
  for(const requirements of [undefined,null,{},
    {defaultPermissions:'protected-workspace'},
    {defaultPermissions:'protected-workspace',allowedPermissionProfiles:{'protected-workspace':true}},
    {allowedPermissionProfiles:{'a2acraft-chat':false}},
    {allowedPermissionProfiles:{'a2acraft-chat':'true'}},
    {allowedPermissionProfiles:{'*':true}},
    {allowedPermissionProfiles:['a2acraft-chat']},
    {allowedPermissionProfiles:Object.create({'a2acraft-chat':true})}
  ])assert.equal(threadPermissionRequest(params,requirements),params);
  for(const sandbox of [undefined,'danger-full-access','external-sandbox']){
    const other={...params,sandbox};
    assert.equal(threadPermissionRequest(other,{allowedPermissionProfiles:{'a2acraft-chat':true,'a2acraft-work':true}}),other);
  }
  assert.throws(()=>threadPermissionRequest({...params,cwd:'relative'},{allowedPermissionProfiles:{'a2acraft-chat':true}}),{code:'execution_scope'});
});

test('an expected profile must match without weakening legacy effective-permission validation',()=>{
  const result={cwd:'/task/workspace',approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false},activePermissionProfile:{id:'a2acraft-chat'}};
  assert.equal(verifyThreadPermissions(result,{cwd:result.cwd,expectedProfile:'a2acraft-chat'}),true);
  for(const activePermissionProfile of [undefined,null,{id:'protected-workspace'},{id:'a2acraft-work'},{}])
    assert.throws(()=>verifyThreadPermissions({...result,activePermissionProfile},{cwd:result.cwd,expectedProfile:'a2acraft-chat'}),/プロファイル/);
  for(const sandbox of [{type:'workspaceWrite',writableRoots:[]},{type:'dangerFullAccess'},undefined])
    assert.throws(()=>verifyThreadPermissions({...result,sandbox},{cwd:result.cwd,expectedProfile:'a2acraft-chat'}),/読み取り専用/);
  const work={...result,sandbox:{type:'workspaceWrite',writableRoots:[result.cwd],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},activePermissionProfile:{id:'a2acraft-work'}};
  assert.equal(verifyThreadPermissions(work,{cwd:work.cwd,readOnly:false,expectedProfile:'a2acraft-work'}),true);
  assert.throws(()=>verifyThreadPermissions({...work,sandbox:{type:'workspaceWrite',writableRoots:['/task']}},{cwd:work.cwd,readOnly:false,expectedProfile:'a2acraft-work'}),/書き込み範囲/);
  for(const networkAccess of [true,undefined]){
    assert.throws(()=>verifyThreadPermissions({...result,sandbox:{...result.sandbox,networkAccess}},{cwd:result.cwd,expectedProfile:'a2acraft-chat'}),/外部通信/);
    assert.throws(()=>verifyThreadPermissions({...work,sandbox:{...work.sandbox,networkAccess}},{cwd:work.cwd,readOnly:false,expectedProfile:'a2acraft-work'}),/外部通信/);
  }
  for(const key of ['excludeTmpdirEnvVar','excludeSlashTmp'])for(const value of [false,undefined])
    assert.throws(()=>verifyThreadPermissions({...work,sandbox:{...work.sandbox,[key]:value}},{cwd:work.cwd,readOnly:false,expectedProfile:'a2acraft-work'}),/一時フォルダ/);
});
