import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {moduleFixture} from './modules-fixture.mjs';

const startedThreads=calls=>calls.filter(call=>call.method==='thread/start');
const turns=calls=>calls.filter(call=>call.method==='turn/start');
const childRequirements={defaultPermissions:'protected-workspace',allowedPermissionProfiles:{'protected-workspace':true,'a2acraft-chat':true,'a2acraft-work':true}};

test('allowed managed child profiles are requested explicitly and both readiness scopes pass',async t=>{
 const f=await moduleFixture(t,{permissionRequirements:childRequirements,quotaUsedPercent:95});
 const result=await f.post('codex/readiness');assert.equal(result.status,200);
 assert.equal(result.body.chat.status,'ready');assert.equal(result.body.work.status,'ready');
 const calls=await f.log(),threads=startedThreads(calls);
 assert.equal(calls.filter(call=>call.method==='configRequirements/read').length,1);
 assert.deepEqual(threads.map(call=>call.params.permissions),['a2acraft-chat','a2acraft-work']);
 for(const {params} of threads){
  assert.equal(Object.hasOwn(params,'sandbox'),false);
  assert.equal(params.ephemeral,true);assert.equal(params.approvalPolicy,'never');
  assert.deepEqual(params.runtimeWorkspaceRoots,[params.cwd]);
 }
 assert.equal(turns(calls).length,0);
});

test('state refresh retains its server but a full restart reloads managed requirements without another login',async t=>{
 const f=await moduleFixture(t,{permissionRequirements:{defaultPermissions:'protected-workspace',allowedPermissionProfiles:{'protected-workspace':true}}});
 const before=(await f.state()).conversations;
 assert.equal((await f.post('codex/readiness')).status,200);
 assert(startedThreads(await f.log()).every(call=>call.params.permissions===undefined));
 await f.update({permissionRequirements:childRequirements});
 assert.equal((await f.post('connect')).status,200);
 assert.equal((await f.log()).filter(call=>call.method==='configRequirements/read').length,1);
 await f.restart();
 assert.equal((await f.log()).filter(call=>call.method==='configRequirements/read').length,2);
 const result=await f.post('codex/readiness');assert.equal(result.status,200);
 assert.equal(result.body.chat.status,'ready');assert.equal(result.body.work.status,'ready');
 assert.deepEqual(startedThreads(await f.log()).slice(-2).map(call=>call.params.permissions),['a2acraft-chat','a2acraft-work']);
 assert.deepEqual((await f.state()).conversations,before);
 assert.equal((await f.log()).filter(call=>call.method==='account/login/start').length,0);
 assert.equal(turns(await f.log()).length,0);
});

test('wrong managed profiles and broad write roots reject readiness and real sends before any turn',async t=>{
 const variants=[
  {name:'wrong profile',permissionRequirements:childRequirements,activePermissionProfile:{id:'protected-workspace'}},
  {name:'outside write root',permissionRequirements:childRequirements,mode:'work',effectiveSandbox:{type:'workspaceWrite',writableRoots:['/outside-fixture'],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}},
  {name:'children not allowed',permissionRequirements:{defaultPermissions:'protected-workspace',allowedPermissionProfiles:{'protected-workspace':true}},effectiveSandbox:{type:'workspaceWrite',writableRoots:['/outside-fixture']}}
 ];
 for(const variant of variants)await t.test(variant.name,async t=>{
  const f=await moduleFixture(t,{localWork:true,...variant});
  const result=await f.post('codex/readiness');assert.equal(result.status,200);
  assert.equal(result.body.chat.code,'permission_mismatch');assert.equal(result.body.work.code,'permission_mismatch');
  if(variant.name==='wrong profile'){
   assert.equal(result.body.chat.diagnostics.profileMatches,false);
   assert.equal(result.body.chat.diagnostics.networkAccess,false);
  }
  if(variant.name==='outside write root'){
   assert.equal(result.body.work.diagnostics.profileMatches,true);
   assert.equal(result.body.work.diagnostics.writableRootsWithinScope,false);
   assert.equal(result.body.work.diagnostics.excludeTmpdirEnvVar,true);
   assert.equal(result.body.work.diagnostics.excludeSlashTmp,true);
  }
  if(variant.mode==='work')assert.equal((await f.post('conversation-mode',{id:f.chats[0].id,mode:'work'})).status,200);
  const before=(await f.state()).conversations.find(chat=>chat.id===f.chats[0].id).messages;
  assert.equal((await f.post('send',{id:f.chats[0].id,text:'Must not reach a model',model:'fixture-model'})).status,400);
  assert.equal(turns(await f.log()).length,0);
  assert.deepEqual((await f.state()).conversations.find(chat=>chat.id===f.chats[0].id).messages,before);
  if(variant.name==='children not allowed')for(const call of startedThreads(await f.log()))assert.equal(call.params.permissions,undefined);
 });
});

test('permission readiness remains available at the 5% stop threshold and leaves chat history untouched',async t=>{
 const f=await moduleFixture(t,{quotaUsedPercent:95});
 const before=await f.state(),saved=await readFile(path.join(f.dir,'data','conversations.json'),'utf8');
 assert.equal(before.policy.ok,false);
 const count=(await f.log()).length,result=await f.post('codex/readiness');
 assert.equal(result.status,200);assert.equal(result.body.modelTurnStarted,false);
 assert.equal(result.body.chat.status,'ready');assert.equal(result.body.work.status,'ready');
 assert(Number.isFinite(result.body.checkedAt));
 const calls=(await f.log()).slice(count);
 assert.deepEqual(calls.map(call=>call.method),['thread/start','thread/start']);
 assert.deepEqual(calls.map(call=>call.params.sandbox),['read-only','workspace-write']);
 assert(calls.every(call=>call.params.ephemeral===true&&call.params.approvalPolicy==='never'));
 assert.equal(turns(await f.log()).length,0);
 assert.deepEqual((await f.state()).conversations,before.conversations);
 assert.equal(await readFile(path.join(f.dir,'data','conversations.json'),'utf8'),saved);
 assert.equal((await f.state()).policy.ok,false);
});

test('signed-out and disconnected states cannot create readiness threads',async t=>{
 const f=await moduleFixture(t);
 assert.equal((await f.post('logout')).status,200);
 const before=(await f.log()).length;
 assert.equal((await f.post('codex/readiness')).status,400);
 assert.equal((await f.log()).length,before);
 await f.update({disconnect:true});await f.until(state=>!state.connected);
 assert.equal((await f.post('codex/readiness')).status,400);
 assert.equal((await f.log()).length,before);
});

test('running conversation blocks readiness and its messages are not changed',async t=>{
 const f=await moduleFixture(t,{autoComplete:false});
 assert.equal((await f.post('send',{id:f.chats[0].id,text:'Fixture running turn',model:'fixture-model'})).status,200);
 const before=await f.until(state=>state.active),calls=await f.log();
 assert.equal((await f.post('codex/readiness')).status,400);
 assert.equal(startedThreads(await f.log()).length,startedThreads(calls).length);
 assert.equal(turns(await f.log()).length,1);
 assert.deepEqual((await f.state()).conversations,before.conversations);
});

test('logout during readiness rejects stale results and prevents its second thread',async t=>{
 const f=await moduleFixture(t,{threadStartDelay:120});
 const pending=f.post('codex/readiness');
 for(let i=0;i<100&&!startedThreads(await f.log()).length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(startedThreads(await f.log()).length,1);
 assert.equal((await f.post('logout')).status,200);
 assert.equal((await pending).status,400);
 assert.equal(startedThreads(await f.log()).length,1);
 assert.equal(turns(await f.log()).length,0);
});

test('untrusted browser requests cannot invoke readiness',async t=>{
 const f=await moduleFixture(t),count=(await f.log()).length;
 const denied=await fetch(f.origin+'/api/codex/readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(denied.status,403);assert.equal((await f.log()).length,count);
});
