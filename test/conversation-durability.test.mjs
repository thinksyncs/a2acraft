import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {moduleFixture} from './modules-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Conversation durability: unreadable history stops startup and preserves the original bytes',async t=>{
 for(const [name,raw] of [
  ['invalid JSON','[{"id":"saved-chat","messages":[{"role":"user","text":"keep this history"}]}'],
  ['invalid collection','{"messages":[]}'],
  ['invalid message collection','[{"id":"saved-chat","title":"Saved","status":"idle","messages":{}}]']
 ])await t.test(name,async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'chat-ui-durability-'));
  const file=path.join(data,'conversations.json');await writeFile(file,raw);
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:'0',CHAT_UI_DATA_DIR:data},stdio:['ignore','pipe','pipe','ipc']});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped;}await rm(data,{recursive:true,force:true});});
  let ready=false,stderr='';child.on('message',message=>{if(message.type==='ready')ready=true;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Invalid history must fail startup')),5000);child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});});
  assert.notEqual(result.code,0,stderr);assert.equal(ready,false);assert.equal(await readFile(file,'utf8'),raw);
 });
});

test('Conversation durability: failed initial checkpoint prevents model execution and reports unsaved state',async t=>{
 const f=await moduleFixture(t),file=path.join(f.dir,'data','conversations.json'),blocked=path.join(f.dir,'data','conversations.tmp');
 const saved=await readFile(file,'utf8');await mkdir(blocked);
 const response=await f.post('send',{id:f.chats[0].id,text:'Do not submit without a durable checkpoint.',model:'fixture-model'});
 assert.equal(response.status,400);
 const state=await f.until(value=>Boolean(value.persistenceError));assert.equal(typeof state.persistenceError,'string');
 assert.equal((await f.log()).filter(call=>call.method==='turn/start').length,0);
 assert.equal(await readFile(file,'utf8'),saved);
 await f.post('refresh');assert((await f.state()).persistenceError,'Account refresh must not hide an unsaved-history error');
 await rm(blocked,{recursive:true});
});

test('Conversation durability: a mid-turn save failure is visible and recovery persists the completed transcript without replay',async t=>{
 const f=await moduleFixture(t,{autoComplete:true,turnDelay:1500}),file=path.join(f.dir,'data','conversations.json'),blocked=path.join(f.dir,'data','conversations.tmp');
 const message='Keep both this prompt and its response.';
 assert.equal((await f.post('send',{id:f.chats[0].id,text:message,model:'fixture-model'})).status,200);
 let saved;
 for(let attempt=0;attempt<100;attempt++){
  saved=await readFile(file,'utf8');
  if(JSON.parse(saved).find(chat=>chat.id===f.chats[0].id).messages.some(item=>item.text===message))break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert(JSON.parse(saved).find(chat=>chat.id===f.chats[0].id).messages.some(item=>item.text===message));
 assert.equal((await f.state()).conversations.find(chat=>chat.id===f.chats[0].id).status,'running');
 await mkdir(blocked);
 const failed=await f.until(state=>state.conversations.find(chat=>chat.id===f.chats[0].id).status==='completed'&&Boolean(state.persistenceError));
 const completed=failed.conversations.find(chat=>chat.id===f.chats[0].id);
 assert.equal(completed.messages.at(-1).text,'Fixture result 1');assert.equal(await readFile(file,'utf8'),saved);
 await f.post('refresh');assert((await f.state()).persistenceError);
 assert.equal((await f.post('history/save')).status,400);
 assert((await f.state()).persistenceError,'A failed retry must retain the unsaved warning');
 await rm(blocked,{recursive:true});
 assert.equal((await f.post('history/save')).status,200);
 assert(!(await f.state()).persistenceError);
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).find(chat=>chat.id===completed.id).messages,completed.messages);
 assert.equal((await f.log()).filter(call=>call.method==='turn/start').length,1);
 await f.restart();
 const restored=(await f.state()).conversations.find(chat=>chat.id===completed.id);
 assert.equal(restored.status,'completed');assert.deepEqual(restored.messages,completed.messages);
 assert.equal((await f.log()).filter(call=>call.method==='turn/start').length,1);
});
