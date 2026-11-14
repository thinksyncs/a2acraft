import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
async function start(data){
  const token=randomBytes(32).toString('hex');
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{
    cwd:root,env:{...process.env,PORT:'0',CHAT_UI_DESKTOP:'1',CHAT_UI_SESSION_TOKEN:token,
      CHAT_UI_DATA_DIR:data,CODEX_BIN:'/usr/bin/false',CHAT_UI_PRACTICE:'0'},
    stdio:['ignore','pipe','pipe','ipc']
  });
  let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited;};
  try{
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Backend startup timed out: '+errors)),10000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code+': '+errors));});
      child.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message);}});
    });
    return {...ready,stop,headers:{Cookie:'chat_ui_session='+token,'X-Chat-UI':'1','Content-Type':'application/json'}};
  }catch(error){await stop();throw error;}
}

// Local application storage only: no connect, AI, terminal, Git, integration,
// history-import or external messaging endpoint is invoked by this test.
test('desktop storage survives shutdown and restart while loopback sessions stay isolated',{timeout:30000},async()=>{
  const data=await mkdtemp(path.join(tmpdir(),'chat-ui-product-storage-'));let first,second;
  try{
    first=await start(data);
    assert.equal((await fetch(first.origin+'/api/state')).status,403);
    assert.equal((await fetch(first.origin+'/api/state',{headers:{...first.headers,Origin:'https://unrelated.example'}})).status,403);
    const createdResponse=await fetch(first.origin+'/api/conversations',{method:'POST',headers:first.headers,body:JSON.stringify({title:'再起動の保存確認'})});
    assert.equal(createdResponse.status,200);const created=await createdResponse.json();
    const state=await (await fetch(first.origin+'/api/state',{headers:first.headers})).json();
    assert.equal(state.connected,false);assert(state.conversations.some(chat=>chat.id===created.id));
    for(const resource of ['/app.js','/draft-persistence.js','/send-delivery.js','/world-3d.js','/resident-conversation.js','/assets/adventure-landscape.png']){
      assert.equal((await fetch(first.origin+resource,{headers:first.headers})).status,200,resource);
    }
    await first.stop();
    const stored=JSON.parse(await readFile(path.join(data,'conversations.json'),'utf8'));
    assert.equal(stored.find(chat=>chat.id===created.id)?.title,'再起動の保存確認');
    second=await start(data);
    assert.equal((await fetch(second.origin+'/api/state',{headers:first.headers})).status,403);
    const reloaded=await (await fetch(second.origin+'/api/state',{headers:second.headers})).json();
    assert.equal(reloaded.connected,false);
    assert.equal(reloaded.conversations.find(chat=>chat.id===created.id)?.title,'再起動の保存確認');
  }finally{await second?.stop();await first?.stop();await rm(data,{recursive:true,force:true});}
});
