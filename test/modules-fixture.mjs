import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function moduleFixture(t,initial={},environment={}){
 const dir=await mkdtemp(path.join(tmpdir(),'chat-ui-modules-')),controlFile=path.join(dir,'control.json'),logFile=path.join(dir,'rpc.jsonl');
 let child,origin,control={autoComplete:true,turnDelay:80,...initial};
 const update=async value=>{control={...control,...value};await writeFile(controlFile+'.tmp',JSON.stringify(control));await rename(controlFile+'.tmp',controlFile);};await update({});
 const stop=async()=>{if(child?.exitCode===null&&child?.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}};
 const boot=async()=>{
  child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,...environment,PORT:'0',CHAT_UI_DATA_DIR:path.join(dir,'data'),CODEX_BIN:path.join(root,'test/fake-codex.mjs'),A2ACRAFT_FIXTURE_CONTROL:controlFile,A2ACRAFT_FIXTURE_LOG:logFile},stdio:['ignore','pipe','pipe','ipc']});
  origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Backend startup timeout')),5000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.origin);}if(m.type==='startup-error'){clearTimeout(timer);reject(Error(m.message));}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code));});child.once('error',reject);});
 };
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});await boot();
 const post=async(route,body={})=>{const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{'X-Chat-UI':'1','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const state=async()=>await(await fetch(origin+'/api/state')).json();
 const until=async predicate=>{for(let i=0;i<200;i++){const value=await state();if(predicate(value))return value;await new Promise(r=>setTimeout(r,15));}assert.fail('Expected state was not reached: '+JSON.stringify((await state()).party.quest));};
 await post('connect');const chats=[];for(const title of ['Leader','Scout','Writer','Reviewer'])chats.push((await post('conversations',{title})).body);
 const config={name:'Fixture party',leaderId:chats[0].id,members:chats.map((chat,index)=>({conversationId:chat.id,role:['まとめ','調査','執筆','レビュー'][index]}))};
 assert.equal((await post('party/configure',{party:config})).status,200);
 return {post,state,until,get origin(){return origin;},update,chats,config,dir,stop,restart:async()=>{await stop();await boot();await post('connect');},log:async()=> (await readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse)};
}

