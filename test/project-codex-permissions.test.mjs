import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectCodex} from '../project-codex.mjs';

function fixture(sandbox){
 const calls=[],chat={id:'chat',messages:[]},cwd='/assigned/workspace';
 const state={connected:true,account:{type:'chatgpt'},models:[{model:'fixture-model'}],limits:{rateLimits:{primary:{usedPercent:10,resetsAt:Date.now()/1000+3600}}}};
 const engine=new ProjectCodex({refresh:async()=>{},getState:()=>state,getConversation:()=>chat,save:async()=>{},rpc:async(method,params)=>{
  calls.push({method,params});
  if(method==='thread/start')return {thread:{id:'thread'},cwd,approvalPolicy:'never',sandbox};
  if(method==='turn/start'){
   setImmediate(()=>engine.message({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}}));
   return {turn:{id:'turn'}};
  }
  assert.fail('Unexpected RPC '+method);
 }});
 const execute=readOnly=>engine.execute({project:{id:'project',model:'fixture-model',goal:'Fixture'},job:{id:'job',conversationId:chat.id,title:'Fixture'},cwd,readOnly,prompt:'Fixture only',signal:new AbortController().signal});
 return {calls,chat,execute};
}

test('project starts reject broader effective permissions without sending work',async()=>{
 for(const [readOnly,sandbox] of [[true,{type:'workspaceWrite',writableRoots:[]}],[false,{type:'readOnly'}],[false,{type:'workspaceWrite',writableRoots:['/other']}],[false,{type:'dangerFullAccess'}]]){
  const f=fixture(sandbox);
  await assert.rejects(f.execute(readOnly),{code:'execution_scope'});
  assert.equal(f.calls.filter(call=>call.method==='turn/start').length,0);
  assert.equal(f.chat.threadId,undefined);assert.deepEqual(f.chat.messages,[]);
 }
});

test('project turns carry standing instructions and inherit the verified thread policy',async()=>{
 for(const [readOnly,sandbox] of [[true,{type:'readOnly',networkAccess:false}],[false,{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}]]){
  const f=fixture(sandbox);await f.execute(readOnly);
  const start=f.calls.find(call=>call.method==='thread/start').params,turn=f.calls.find(call=>call.method==='turn/start').params;
  assert.match(start.developerInstructions,/Never read, list, search/);assert.match(start.developerInstructions,/Proton services/);
  assert.equal(turn.sandboxPolicy,undefined);assert.equal(turn.permissions,undefined);assert.equal(turn.cwd,start.cwd);
 }
});
