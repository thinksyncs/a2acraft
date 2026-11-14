import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ConversationWorkspaces,resolveWorkspaceDirectory} from '../conversation-workspace.mjs';

test('workspace selection accepts only absolute overrides and keeps data separate',()=>{
 assert.equal(resolveWorkspaceDirectory('/app/data'),'/app/data/workspace');
 assert.equal(resolveWorkspaceDirectory('/app/data',''),'/app/data/workspace');
 assert.equal(resolveWorkspaceDirectory('/app/data','/selected/tasks'),'/selected/tasks');
 for(const invalid of ['relative/tasks','../tasks','~/tasks',null,42])assert.throws(()=>resolveWorkspaceDirectory('/app/data',invalid),/絶対パス/);
});

test('mode persistence blocks racing sends and failures require an explicit successful retry',async t=>{
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'chat-ui-scope-')));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 let finish,fail=false,writes=0;
 const scopes=new ConversationWorkspaces({directory,guard:()=>false,changed:()=>{},save:()=>{writes++;return new Promise((resolve,reject)=>{finish=()=>fail?reject(Error('disk failure')):resolve();});}});
 const c={id:'scope-test',status:'idle'},other={id:'other',status:'idle'};
 const pending=scopes.change(c,'chat');
 assert.throws(()=>scopes.snapshot(c),/保存/);assert.throws(()=>scopes.snapshot(other),/保存/);
 finish();await pending;assert.equal(scopes.snapshot(c).thread.sandbox,'read-only');
 fail=true;const failed=scopes.change(c,'chat');finish();await assert.rejects(failed,/disk failure/);
 assert.throws(()=>scopes.snapshot(c),/保存/);
 fail=false;const retry=scopes.change(c,'chat');finish();await retry;
 assert.equal(scopes.snapshot(c).thread.sandbox,'read-only');assert.equal(writes,3);
});

test('automatic sends always get read-only scope even for a work-enabled conversation',()=>{
 const scopes=new ConversationWorkspaces({directory:'/task/workspace',guard:()=>false,save:async()=>{},changed:()=>{}});
 const c={id:'chat-1',workMode:'work'};
 const manual=scopes.snapshot(c),automatic=scopes.snapshot(c,{readOnly:true});
 assert.equal(manual.thread.sandbox,'workspace-write');assert.equal(automatic.thread.sandbox,'read-only');
 assert.notEqual(manual.key,automatic.key);assert.equal(automatic.turn.sandboxPolicy,undefined);
 assert.equal(automatic.cwd,'/task/workspace');
 assert.throws(()=>scopes.snapshot({id:'../escape',workMode:'work'}),/Invalid/);
});

test('project and active work cannot change their scope',async()=>{
 const scopes=new ConversationWorkspaces({directory:'/task/workspace',guard:()=>false,save:async()=>{},changed:()=>{}});
 await assert.rejects(scopes.change({id:'project',project:{id:'p'}},'work'),/project/);
 await assert.rejects(scopes.change({id:'running',status:'running'},'work'),/進行中/);
 await assert.rejects(scopes.change({id:'chat'},'unrestricted'),/実行範囲/);
 assert.equal(scopes.pending.size,0);
});
