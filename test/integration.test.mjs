import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,copyFile,mkdir,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('App Server bridge: login gate, send, stable-turn steer, stop, origin isolation',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'chat-ui-test-'));
 let child;
 t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(temp,{recursive:true,force:true});});
 // Follow the reviewed desktop package allowlist so new backend imports cannot
 // silently diverge from this isolated fixture. No build or CLI is executed.
 const config=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 const backend=config.build.extraResources.find(resource=>resource.to==='backend');
 assert(backend?.filter.includes('server.mjs'));
 for(const file of backend.filter.filter(file=>/^[a-z0-9-]+\.mjs$/.test(file)))await copyFile(path.join(root,file),path.join(temp,file));
 await copyFile(path.join(root,'package.json'),path.join(temp,'package.json'));
 await mkdir(path.join(temp,'public'));
 for(const entry of await readdir(path.join(root,'public'),{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.js'))await copyFile(path.join(root,'public',entry.name),path.join(temp,'public',entry.name));
 child=spawn(process.execPath,[path.join(temp,'server.mjs')],{env:{...process.env,PORT:'0',CODEX_BIN:path.join(root,'test/fake-codex.mjs')},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stdout.resume();child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
 const {origin:base}=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Server startup timed out: '+stderr)),5000);
  child.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message);}if(message.type==='startup-error'){clearTimeout(timer);reject(Error(message.message));}});
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+stderr));});
 });
  const post=async(route,data={})=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Chat-UI':'1'},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
  const initial=await (await fetch(base+'/api/state')).json();assert.equal(initial.policy.ok,false);
  const connected=await post('connect');assert.equal(connected.status,200);assert.equal(connected.body.policy.ok,true);
  const c=(await post('conversations',{title:'Test'})).body;
  assert.equal((await post('send',{id:c.id,text:'Hello',model:'fixture-model'})).status,200);
  assert.equal((await post('steer',{id:c.id,text:'Wrong turn',expectedTurnId:'old-turn'})).status,400);
  assert.equal((await post('steer',{id:c.id,text:'Focus on the GUI',expectedTurnId:'turn-fixture'})).status,200);
  let state=await (await fetch(base+'/api/state')).json();assert.equal(state.conversations[0].messages.at(-1).steer,true);assert.equal(state.conversations[0].status,'running');
  assert.equal((await post('stop',{id:c.id})).status,200);
  for(let i=0;i<10;i++){state=await(await fetch(base+'/api/state')).json();if(state.conversations[0].status==='cancelled')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.conversations[0].status,'cancelled');
  const bad=await fetch(base+'/api/refresh',{method:'POST',headers:{Origin:'https://unrelated.example','X-Chat-UI':'1'}});assert.equal(bad.status,403);
});
