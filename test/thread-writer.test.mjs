import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const conflict='thread saved-thread already has an active writer';
const original={id:'saved-chat',title:'Existing chat',threadId:'saved-thread',turnId:null,status:'failed',error:conflict,model:'fixture-model',messages:[{id:'saved-user',role:'user',text:'Keep the original question'},{id:'saved-answer',role:'assistant',text:'Keep the original answer'}],equipment:{},characterName:'ルナ'};
async function fixture(t,options={}){
 const directory=await mkdtemp(path.join(tmpdir(),'chat-ui-writer-')),data=path.join(directory,'data'),controlFile=path.join(directory,'control.json'),logFile=path.join(directory,'rpc.jsonl');
 await mkdir(data);await writeFile(path.join(data,'conversations.json'),JSON.stringify([original]));
 let control={autoComplete:true,turnDelay:30,...options},child,origin;
 const update=async change=>{control={...control,...change};await writeFile(controlFile+'.tmp',JSON.stringify(control));await rename(controlFile+'.tmp',controlFile);};
 await update({});
 const stop=async()=>{if(child?.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}};
 const boot=async()=>{
  child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:'0',CHAT_UI_DATA_DIR:data,CODEX_BIN:path.join(root,'test/fake-codex.mjs'),A2ACRAFT_FIXTURE_CONTROL:controlFile,A2ACRAFT_FIXTURE_LOG:logFile},stdio:['ignore','pipe','pipe','ipc']});
  origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Backend startup timed out')),5000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.origin);}if(m.type==='startup-error'){clearTimeout(timer);reject(Error(m.message));}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code));});});
 };
 await boot();t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
 const post=async(route,body={})=>{const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{'X-Chat-UI':'1','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const state=async()=>await(await fetch(origin+'/api/state')).json();
 const calls=async()=> (await readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse);
 const until=async predicate=>{for(let i=0;i<160;i++){const s=await state();if(predicate(s))return s;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected state not reached');};
 const send=()=>post('send',{id:original.id,text:'Continue once',model:'fixture-model'});
 await post('connect');
 return {post,state,calls,until,update,send,restart:async()=>{await stop();await boot();await post('connect');}};
}

test('Writer recovery preserves local history, forks once before sending, and survives restart',async t=>{
 const f=await fixture(t,{threadResumeError:conflict});
 assert.equal((await f.send()).status,200);
 let s=await f.until(s=>s.conversations[0].status==='completed'),chat=s.conversations[0];
 assert.notEqual(chat.threadId,original.threadId);assert.deepEqual(chat.messages.slice(0,2),original.messages);assert.equal(chat.messages.length,4);assert.equal(chat.error,null);
 assert.deepEqual(chat.equipment,original.equipment);assert.equal(chat.characterName,original.characterName);assert.equal(chat.threadRecovery.fromThreadId,original.threadId);
 let calls=await f.calls(),forks=calls.filter(c=>c.method==='thread/fork'),turns=calls.filter(c=>c.method==='turn/start');
 assert.equal(forks.length,1);assert.equal(turns.length,1);assert.equal(turns[0].params.threadId,chat.threadId);
 assert.equal(forks[0].params.threadId,original.threadId);assert.equal(forks[0].params.approvalPolicy,'never');assert.equal(forks[0].params.sandbox,'read-only');
 assert.match(forks[0].params.developerInstructions,/personal chat interface/);
 assert.equal((await f.send()).status,200);await f.until(s=>s.conversations[0].status==='completed');
 assert.equal((await f.calls()).filter(c=>c.method==='thread/fork').length,1);
 const recovered=chat.threadId;await f.update({threadResumeError:null});await f.restart();
 assert.equal((await f.send()).status,200);s=await f.until(s=>s.conversations[0].status==='completed');
 assert.equal(s.conversations[0].threadId,recovered);assert.equal(s.conversations[0].threadRecovery.fromThreadId,original.threadId);
 calls=await f.calls();assert.equal(calls.filter(c=>c.method==='thread/fork').length,1);assert.equal(calls.filter(c=>c.method==='thread/resume').at(-1).params.threadId,recovered);
});

test('Resume failures other than this thread writer conflict never fork or submit a turn',async t=>{
 for(const message of ['thread/resume: 応答がありません。','thread different-thread already has an active writer','Permission denied'])await t.test(message,async t=>{
  const f=await fixture(t,{threadResumeError:message});assert.equal((await f.send()).status,400);
  const chat=(await f.state()).conversations[0];assert.equal(chat.threadId,original.threadId);assert.deepEqual(chat.messages,original.messages);assert.equal(chat.threadRecovery,undefined);
  const calls=await f.calls();assert.equal(calls.filter(c=>c.method==='thread/fork'||c.method==='turn/start').length,0);
 });
});

test('A failed fork keeps the original binding and history and sends nothing',async t=>{
 const f=await fixture(t,{threadResumeError:conflict,threadForkError:'Fork unavailable'});
 const failed=await f.send();assert.equal(failed.status,400);assert.equal(failed.body.error,'Fork unavailable');
 const chat=(await f.state()).conversations[0];assert.equal(chat.threadId,original.threadId);assert.deepEqual(chat.messages,original.messages);
 assert.equal((await f.calls()).filter(c=>c.method==='turn/start').length,0);
});

test('A writer error from turn/start is not retried or forked',async t=>{
 const f=await fixture(t,{turnError:conflict});assert.equal((await f.send()).status,400);
 const calls=await f.calls();assert.equal(calls.filter(c=>c.method==='turn/start').length,1);assert.equal(calls.filter(c=>c.method==='thread/fork').length,0);
 assert.deepEqual((await f.state()).conversations[0].messages,original.messages);
});

test('Concurrent sends during writer recovery produce one fork and one turn',async t=>{
 const f=await fixture(t,{threadResumeError:conflict,threadForkDelay:250});
 const first=f.send();await f.until(s=>s.conversations[0].status==='starting');
 assert.equal((await f.send()).status,400);assert.equal((await first).status,200);
 await f.until(s=>s.conversations[0].status==='completed');
 const calls=await f.calls();assert.equal(calls.filter(c=>c.method==='thread/fork').length,1);assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
});

test('resume and recovery fork reject a managed write policy before a consultation turn',async t=>{
 for(const recover of [false,true])await t.test(recover?'fork':'resume',async t=>{
  const f=await fixture(t,{effectiveSandbox:{type:'workspaceWrite',writableRoots:[]},...(recover?{threadResumeError:conflict}:{})});
  const response=await f.send();assert.equal(response.status,400);assert.match(response.body.error,/読み取り専用/);
  const calls=await f.calls();assert.equal(calls.filter(call=>call.method==='turn/start').length,0);
  assert.equal(calls.filter(call=>call.method==='thread/fork').length,recover?1:0);
  const chat=(await f.state()).conversations[0];assert.equal(chat.threadId,original.threadId);assert.deepEqual(chat.messages,original.messages);
 });
});
