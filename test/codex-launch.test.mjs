import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIsolatedConfig,verifyThreadPermissions} from '../codex-launch.mjs';
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
