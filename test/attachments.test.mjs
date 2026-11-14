import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFile,rename} from 'node:fs/promises';
import {AttachmentStore} from '../attachments.mjs';

// One transparent PNG pixel; the fixture is local and never sent to a model.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function fixture(t){
 const directory=await mkdtemp(path.join(tmpdir(),'chat-ui-attachments-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return {directory,store:await new AttachmentStore(directory).load()};
}
const uploadImage=(store,conversationId='source',name='clipboard.png')=>store.upload({conversationId,name,mimeType:'image/png',bytes:png});
const uploadText=(store,text,conversationId='source',name='notes.txt')=>store.upload({conversationId,name,mimeType:'text/plain',bytes:Buffer.from(text)});

test('Attachments: image drafts survive restart, failed sends can retry, accepted images stay readable',async t=>{
 const {directory,store}=await fixture(t);
 const image=await uploadImage(store);
 assert.equal(image.kind,'image');assert.equal(image.name,'clipboard.png');
 assert.deepEqual(store.drafts().map(row=>row.id),[image.id]);
 assert.equal(image.path,undefined,'renderer metadata must not expose local image paths');
 const loaded=await new AttachmentStore(directory).load();
 assert.deepEqual(loaded.drafts().map(row=>row.id),[image.id]);
 const rows=await loaded.reserve('source',[image.id]);
 const input=await loaded.input(rows);
 assert.equal(input.length,1);assert.equal(input[0].type,'localImage');
 assert(path.isAbsolute(input[0].path));
 const relative=path.relative(directory,input[0].path);
 assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
 assert.deepEqual(await readFile(input[0].path),png);
 if(process.platform!=='win32')assert.equal((await stat(input[0].path)).mode&0o777,0o600);
 await assert.rejects(async()=>loaded.remove('source',image.id));
 await assert.rejects(async()=>loaded.reserve('source',[image.id]));
 loaded.release(rows);
 assert.deepEqual(loaded.drafts().map(row=>row.id),[image.id],'rejected model sends keep the draft');
 const retried=await loaded.reserve('source',[image.id]);
 await loaded.commit(retried);loaded.release(retried);
 assert.equal(loaded.drafts().length,0);
 const accepted=await new AttachmentStore(directory).load();
 assert.equal(accepted.drafts().length,0);
 const thumbnail=await accepted.readImage(image.id);
 assert.equal(thumbnail.mimeType,'image/png');assert.deepEqual(thumbnail.bytes,png);
 await assert.rejects(async()=>accepted.remove('source',image.id));
 await assert.rejects(async()=>accepted.reserve('source',[image.id]));
});

test('Attachments: ownership, duplicate IDs, arbitrary paths, and malformed images are rejected',async t=>{
 const {store}=await fixture(t),image=await uploadImage(store);
 await assert.rejects(async()=>store.reserve('other',[image.id]));
 await assert.rejects(async()=>store.remove('other',image.id));
 await assert.rejects(async()=>store.reserve('source',[image.id,image.id]));
 await assert.rejects(async()=>store.reserve('source',['../../outside.png']));
 await assert.rejects(async()=>store.readImage('../../outside.png'));
 await assert.rejects(async()=>store.readImage('/etc/passwd'));
 await assert.rejects(async()=>store.upload({conversationId:'source',name:'fake.png',mimeType:'image/png',bytes:Buffer.from('<svg onload="alert(1)"></svg>')}));
 assert.deepEqual(store.drafts().map(row=>row.id),[image.id],'invalid operations must preserve the existing draft');
 await store.remove('source',image.id);
 assert.equal(store.drafts().length,0);
 await assert.rejects(async()=>store.readImage(image.id));
});

test('Attachments: Xberg text is quoted for input and shared context includes document text but no image bytes',async t=>{
 const {store}=await fixture(t),text='Review notes: keep the chat sandbox read-only.';
 const document=await uploadText(store,text),image=await uploadImage(store);
 assert.equal(document.kind,'document');
 const rows=await store.reserve('source',[document.id,image.id]);
 const input=await store.input(rows),quoted=input.find(item=>item.type==='text');
 assert(quoted);assert.match(quoted.text,/Review notes: keep the chat sandbox read-only\./);
 assert.match(quoted.text,/notes\.txt/);
 assert.equal(input.filter(item=>item.type==='localImage').length,1);
 await store.commit(rows);store.release(rows);
 const source={id:'source',title:'Source',messages:[{id:'message',role:'user',text:'',attachments:rows.map(row=>store.public(row))}]};
 const enriched=await store.enrich(source);
 assert.match(enriched.messages[0].attachmentText,/Review notes: keep the chat sandbox read-only\./);
 assert.match(enriched.messages[0].attachmentText,/clipboard\.png/);
 assert(!JSON.stringify(enriched).includes(png.toString('base64')));
 assert(!JSON.stringify(enriched).includes(input.find(item=>item.type==='localImage').path));
});

test('Attachments: each send is limited to six items and 60,000 extracted document characters', {timeout:20000},async t=>{
 const {store}=await fixture(t);
 const images=[];
 for(let i=0;i<6;i++)images.push(await uploadImage(store,'images',`image-${i}.png`));
 await assert.rejects(async()=>uploadImage(store,'images','seventh.png'));
 await assert.rejects(async()=>store.reserve('images',[...images.map(image=>image.id),'00000000-0000-4000-8000-000000000000']));
 const six=await store.reserve('images',images.map(image=>image.id));
 assert.equal(six.length,6);store.release(six);
 const documents=[];
 for(let i=0;i<4;i++)documents.push(await uploadText(store,'x'.repeat(20000),'documents',`document-${i}.txt`));
 await assert.rejects(async()=>store.reserve('documents',documents.map(document=>document.id)));
 const bounded=await store.reserve('documents',documents.slice(0,3).map(document=>document.id));
 assert.equal(bounded.length,3);store.release(bounded);
 assert.equal(store.drafts().length,10,'budget rejection preserves all drafts for editing');
});

async function serverFixture(t){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const directory=await mkdtemp(path.join(tmpdir(),'chat-ui-attachment-http-'));
 const controlFile=path.join(directory,'control.json'),logFile=path.join(directory,'rpc.jsonl');
 const cookie='chat_ui_session='+'fixture-attachment-session-token-'.repeat(2);
 let child,origin,control={};
 const update=async change=>{control={...control,...change};await writeFile(controlFile+'.tmp',JSON.stringify(control));await rename(controlFile+'.tmp',controlFile);};
 const stop=async()=>{
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{
   const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
   child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
  });
 };
 t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
 const start=async()=>{
  let stderr='';
  child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:'0',CHAT_UI_DATA_DIR:path.join(directory,'data'),CHAT_UI_DESKTOP:'1',CHAT_UI_SESSION_TOKEN:cookie.slice('chat_ui_session='.length),CODEX_BIN:path.join(root,'test/fake-codex.mjs'),A2ACRAFT_FIXTURE_CONTROL:controlFile,A2ACRAFT_FIXTURE_LOG:logFile,OPENAI_API_KEY:'fixture-only',CODEX_API_KEY:'fixture-only'},stdio:['ignore','pipe','pipe','ipc']});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
  child.stdout.resume();
  ({origin}=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Attachment backend startup timed out: '+stderr)),10000);
   child.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message);}if(message.type==='startup-error'){clearTimeout(timer);reject(Error(message.message));}});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);reject(Error(`Attachment backend exited ${code}: ${stderr}`));});
  }));
 };
 const request=(route,options={})=>fetch(origin+route,{...options,headers:{Cookie:cookie,...options.headers}});
 const post=async(route,value={})=>{
  const response=await request('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Chat-UI':'1'},body:JSON.stringify(value)});
  return {status:response.status,body:await response.json()};
 };
 const upload=async(conversationId,name,bytes,mimeType='image/png')=>{
  const query=new URLSearchParams({conversationId,name});
  const response=await request('/api/attachments?'+query,{method:'POST',headers:{'Content-Type':mimeType,'X-Chat-UI':'1'},body:bytes});
  return {status:response.status,body:await response.json()};
 };
 const state=async()=>await(await request('/api/state')).json();
 const until=async predicate=>{for(let i=0;i<100;i++){const current=await state();if(predicate(current))return current;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Expected attachment state was not reached');};
 await update({});await start();
 return {update,post,upload,state,until,request,restart:async()=>{await stop();await start();},log:async()=>(await readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse)};
}

test('Attachment HTTP bridge: image-only send, retry, document steer, shared context, session isolation and restart', {timeout:30000},async t=>{
 const f=await serverFixture(t);
 assert.equal((await f.post('connect')).status,200);
 const source=(await f.post('conversations',{title:'Image source'})).body;
 const target=(await f.post('conversations',{title:'Context target'})).body;
 const uploaded=await f.upload(source.id,'clipboard.png',png);
 assert.equal(uploaded.status,200,uploaded.body.error);const image=uploaded.body;
 assert.equal((await f.upload('missing','clipboard.png',png)).status,400);
 const thumbnail=await f.request('/api/attachments/'+image.id);
 assert.equal(thumbnail.status,200);assert.match(thumbnail.headers.get('Content-Type'),/^image\/png/);
 assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()),png);
 assert.equal((await f.request('/api/attachments/'+image.id,{headers:{Cookie:''}})).status,403);
 assert.equal((await f.request('/api/attachments?'+new URLSearchParams({conversationId:source.id,name:'blocked.png'}),{method:'POST',headers:{'Content-Type':'image/png','X-Chat-UI':'1',Origin:'https://unrelated.example'},body:png})).status,403);
 assert.equal((await f.request('/api/attachments?'+new URLSearchParams({conversationId:source.id,name:'blocked.png'}),{method:'POST',headers:{'Content-Type':'image/png'},body:png})).status,403);
 assert.equal((await f.post('send',{id:target.id,text:'',attachmentIds:[image.id],model:'fixture-model'})).status,400);
 await f.update({turnError:'Fixture rejected attachment turn'});
 assert.equal((await f.post('send',{id:source.id,text:'',attachmentIds:[image.id],model:'fixture-model'})).status,400);
 let state=await f.state();
 assert.equal(state.conversations.find(chat=>chat.id===source.id).messages.length,0,'rejected sends must not appear as accepted history');
 assert(state.attachmentDrafts.some(row=>row.id===image.id));
 await f.update({turnError:null});
 assert.equal((await f.post('send',{id:source.id,text:'',attachmentIds:[image.id],model:'fixture-model'})).status,200);
 state=await f.until(value=>value.conversations.find(chat=>chat.id===source.id).status==='running');
 const accepted=state.conversations.find(chat=>chat.id===source.id).messages.at(-1);
 assert.equal(accepted.text,'');assert.equal(accepted.attachments[0].id,image.id);
 assert(!state.attachmentDrafts.some(row=>row.id===image.id));
 const started=(await f.log()).filter(call=>call.method==='turn/start').at(-1);
 assert.equal(started.params.input.filter(item=>item.type==='localImage').length,1);
 assert.deepEqual(await readFile(started.params.input.find(item=>item.type==='localImage').path),png);
 assert.equal(started.params.sandboxPolicy,undefined);assert.equal(started.params.approvalPolicy,'never');
 assert.equal((await f.post('attachments/remove',{conversationId:source.id,id:image.id})).status,400);
 const extracted=await f.upload(source.id,'review.txt',Buffer.from('Shared document: retain the read-only chat setting.'),'text/plain');
 assert.equal(extracted.status,200,extracted.body.error);const document=extracted.body;
 assert.equal((await f.post('steer',{id:source.id,text:'',attachmentIds:[document.id],expectedTurnId:'wrong-turn'})).status,400);
 assert((await f.state()).attachmentDrafts.some(row=>row.id===document.id));
 assert.equal((await f.post('steer',{id:source.id,text:'',attachmentIds:[document.id],expectedTurnId:'turn-fixture'})).status,200);
 const steered=(await f.log()).filter(call=>call.method==='turn/steer').at(-1);
 assert(steered.params.input.some(item=>item.type==='text'&&item.text.includes('Shared document: retain the read-only chat setting.')));
 assert.equal(steered.params.expectedTurnId,'turn-fixture');
 assert.equal((await f.post('stop',{id:source.id})).status,200);
 await f.until(value=>value.conversations.find(chat=>chat.id===source.id).status==='cancelled');
 assert.equal((await f.post('context/transfer',{sourceId:source.id,targetId:target.id})).status,200);
 assert.equal((await f.post('send',{id:target.id,text:'Use the shared reference.',model:'fixture-model'})).status,200);
 const shared=(await f.log()).filter(call=>call.method==='turn/start').at(-1);
 assert(shared.params.input.some(item=>item.type==='text'&&item.text.includes('Shared document: retain the read-only chat setting.')));
 assert(shared.params.input.some(item=>item.type==='text'&&item.text.includes('clipboard.png')));
 assert(shared.params.input.some(item=>item.type==='text'&&item.text.includes('画像の内容はこの共有に含まれません')));
 assert.equal(shared.params.input.filter(item=>item.type==='localImage').length,0);
 const removable=(await f.upload(source.id,'remove.png',png)).body;
 assert.equal((await f.post('attachments/remove',{conversationId:target.id,id:removable.id})).status,400);
 assert.equal((await f.post('attachments/remove',{conversationId:source.id,id:removable.id})).status,200);
 assert.equal((await f.request('/api/attachments/'+removable.id)).status,400);
 await f.restart();
 state=await f.state();assert.equal(state.attachmentDrafts.length,0);
 assert.equal(state.conversations.find(chat=>chat.id===source.id).messages[0].attachments[0].id,image.id);
 assert.deepEqual(Buffer.from(await(await f.request('/api/attachments/'+image.id)).arrayBuffer()),png);
});
