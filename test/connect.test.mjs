import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,copyFile,chmod,rename,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContextBoard} from '../context-board.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,initial={},missingCli=false,selectedWorkspace=false){
 const dir=await mkdtemp(path.join(tmpdir(),'chat-ui-connect-')),controlFile=path.join(dir,'control.json'),logFile=path.join(dir,'rpc.jsonl');
 let control=initial;
 const update=async change=>{control={...control,...change};await writeFile(controlFile+'.tmp',JSON.stringify(control));await rename(controlFile+'.tmp',controlFile);};
 await update({});
 const cli=missingCli?path.join(dir,'codex'):path.join(root,'test/fake-codex.mjs');
 const workspaceOverride=selectedWorkspace?path.join(await realpath(dir),'selected','workspace'):'';
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:'0',CHAT_UI_DATA_DIR:path.join(dir,'data'),CHAT_UI_WORKSPACE_DIR:workspaceOverride,CODEX_BIN:cli,A2ACRAFT_FIXTURE_CONTROL:controlFile,A2ACRAFT_FIXTURE_LOG:logFile,OPENAI_API_KEY:'fixture-only',CODEX_API_KEY:'fixture-only'},stdio:['ignore','pipe','pipe','ipc']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});});
 const {origin}=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Backend startup timed out')),5000);
  child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m);}if(m.type==='startup-error'){clearTimeout(timer);reject(Error(m.message));}});
  child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code));});
 });
 const state=async()=>await(await fetch(origin+'/api/state')).json();
 const post=async(route,body={})=>{const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{'X-Chat-UI':'1','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const until=async predicate=>{for(let i=0;i<100;i++){const current=await state();if(predicate(current))return current;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected state was not reached');};
 return {update,state,post,until,cli,dir,log:async()=> (await readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse)};
}

test('Village contact carries one resident’s words to the other and completes one traceable TODO', async t => {
 const opening = 'The garden was still damp this morning.';
 const taskTitle = 'Draft a watering chart';
 const proposal = {title:taskTitle, description:'Draft a table comparing wet and dry days.', assignee:'self'};
 const chart = 'Wet day | Check the soil before watering.\nDry day | Water if the soil is dry.';
 const f = await fixture(t, {autoComplete:true, turnDelay:20, encounterTask:{title:taskTitle, result:chart}, encounterReplies:{
  OPENING:opening,
  REPLY:JSON.stringify({message:'I can draft a chart using that observation.', task:proposal}),
  DECISION:JSON.stringify({message:'Yes, please draft the chart.', accept:true}),
 }});
 assert.equal((await f.post('connect')).status, 200);
 const makeResident = async (title, observation) => {
  const response = await f.post('conversations', {title});
  assert.equal(response.status, 200);
  const id = response.body.id;
  assert.equal((await f.post('send', {id, text:observation, model:'fixture-model'})).status, 200);
  await f.until(state => state.conversations.some(chat => chat.id === id && chat.status === 'completed'));
  return id;
 };
 const gardenNote = 'The blue garden gauge reads five millimetres.';
 const planNote = 'The planning board has six empty rows.';
 const gardener = await makeResident('Garden observations', gardenNote);
 const planner = await makeResident('Watering plans', planNote);
 const baseline = (await f.log()).filter(call => call.method === 'turn/start').length;
 const contact = {conversationIds:[gardener,planner], model:'fixture-model', locale:'en'};
 assert.equal((await f.post('encounters/settings', {enabled:true})).status, 200);
 const started = await f.post('encounters/contact', contact);
 assert.ok(started.status < 300, JSON.stringify(started.body));
 const finished = await f.until(state => state.todos.items.some(item => item.status === 'done' && item.title === taskTitle));
 const items = finished.todos.items.filter(item => item.source?.provider === 'encounter');
 assert.equal(items.length, 1);
 const item = items[0];
 assert.equal(item.source.encounterId, item.id);
 assert.ok(contact.conversationIds.includes(item.assignee.conversationId));
 assert.equal(item.runs.length, 1);
 assert.equal(item.runs[0].output, chart);
 assert.deepEqual(item.source.turns.map(turn => turn.conversationId), [gardener,planner,gardener]);
 const calls = (await f.log()).filter(call => call.method === 'turn/start').slice(baseline);
 assert.equal(calls.length, 4);
 const inputs = calls.map(call => call.params.input.map(chunk => chunk.text || '').join('\n'));
 assert.ok(inputs[0].includes(gardenNote) && !inputs[0].includes(planNote));
 assert.ok(inputs[1].includes(planNote) && !inputs[1].includes(gardenNote));
 assert.ok(inputs[1].includes(opening), 'the second resident sees the first resident’s actual words');
 assert.ok(inputs[2].includes(proposal.title), 'the first resident reviews the proposed work');
 assert.ok(inputs[3].includes(proposal.description), 'the assignee receives the agreed TODO');
 await f.post('encounters/contact', {...contact, conversationIds:[planner,gardener]});
 const repeated = await f.state();
 assert.equal(repeated.todos.items.filter(todo => todo.source?.provider === 'encounter').length, 1);
 assert.equal((await f.log()).filter(call => call.method === 'turn/start').length, baseline + 4);

 // Explicitly rerunning a saved TODO uses its original conversation even after the feature is off.
 await f.post('encounters/settings', {enabled:false});
 assert.equal((await f.post('todos/reopen', {id:item.id})).status, 200);
 await f.update({turnDelay:600});
 assert.equal((await f.post('todos/start', {id:item.id, model:'fixture-model'})).status, 200);
 await f.until(state => state.party.quest?.steps[0]?.turnId);
 assert.equal((await f.post('party/pause')).status, 200);
 await f.until(state => state.party.quest?.status === 'paused');
 await f.update({turnDelay:20});
 assert.equal((await f.post('party/resume', {retry:true})).status, 200);
 const resumed = await f.until(state => state.todos.items.find(todo => todo.id === item.id)?.status === 'done');
 assert.equal(resumed.todos.items.find(todo => todo.id === item.id).runs.length, 2);
 assert.deepEqual(resumed.conversations.map(c => c.messages), repeated.conversations.map(c => c.messages));
 const log = await f.log();
 const taskThreads = log.filter(call => call.method === 'thread/start').slice(-2);
 assert.equal(taskThreads.length, 2);
 assert.ok(taskThreads.every(call => call.params.ephemeral === true && call.params.sandbox === 'read-only'));
 const retries = log.filter(call => call.method === 'turn/start').slice(-2);
 assert.ok(retries.every(call => call.params.input.some(input => input.text?.includes(opening))));
});

test('Selected workspace is shared by CLI and conversation scopes while history stays in app data',async t=>{
 const f=await fixture(t,{localWork:true},false,true),workspace=path.join(await realpath(f.dir),'selected','workspace');
 assert.equal((await f.post('connect')).status,200);
 const c=(await f.post('conversations',{title:'Selected task folder'})).body;
 assert.equal((await f.post('conversation-mode',{id:c.id,mode:'work'})).status,200);
 assert.equal((await f.post('send',{id:c.id,text:'Fixture only',model:'fixture-model'})).status,200);
 const calls=await f.log(),cwd=path.join(workspace,'chats',c.id);
 assert.equal(calls.find(call=>call.args).cwd,workspace);
 assert.equal(calls.find(call=>call.method==='thread/start').params.cwd,cwd);
 assert.equal(calls.find(call=>call.method==='turn/start').params.cwd,cwd);
 assert.match(await readFile(path.join(cwd,'AGENTS.md'),'utf8'),/Standing security instructions/);
 const stored=JSON.parse(await readFile(path.join(f.dir,'data','conversations.json'),'utf8'));
 assert.equal(stored.find(chat=>chat.id===c.id).workMode,'work');
 await assert.rejects(readFile(path.join(workspace,'conversations.json')),{code:'ENOENT'});
});

test('Connect: missing executable and initialize failure retain reasons and allow retry',async t=>{
 const f=await fixture(t,{},true);
 const missing=await f.post('connect');assert.equal(missing.status,400);assert.match(missing.body.error,/CLIが見つかりません/);
 await new Promise(r=>setTimeout(r,50));assert.equal((await f.state()).error,missing.body.error);
 await copyFile(path.join(root,'test/fake-codex.mjs'),f.cli);await chmod(f.cli,0o755);
 await f.update({initializeError:'Fixture initialization failed'});
 const failed=await f.post('connect');assert.equal(failed.status,400);assert.equal(failed.body.error,'Fixture initialization failed');
 assert.equal((await f.state()).connected,false);
 await f.update({initializeError:null});
 const retried=await f.post('connect');assert.equal(retried.status,200);assert.equal(retried.body.account.type,'chatgpt');assert.equal(retried.body.error,null);
});

test('Connect: login failure, cancellation, completion, disconnect and read-only resume',async t=>{
 const f=await fixture(t,{loggedIn:false});
 assert.equal((await f.post('connect')).body.account,null);
 const first=(await f.post('login')).body;
 await f.update({completion:{loginId:first.loginId,success:false,error:'Fixture consent denied'}});
 const failed=await f.until(s=>s.error==='Fixture consent denied');assert.equal(failed.login,null);assert.equal(failed.policy.ok,false);
 const second=(await f.post('login')).body,third=(await f.post('login')).body;
 assert.notEqual(second.loginId,third.loginId);
 await new Promise(r=>setTimeout(r,120));const pending=await f.state();assert.equal(pending.login.loginId,third.loginId);assert.equal(pending.error,null);
 await f.update({completion:{loginId:third.loginId,success:true}});
 await f.until(s=>s.account?.type==='chatgpt'&&s.policy.ok&&!s.login);
 const c=(await f.post('conversations',{title:'Preserved conversation'})).body;
 assert.equal((await f.post('send',{id:c.id,text:'Fixture only',model:'fixture-model'})).status,200);
 await f.post('stop',{id:c.id});await f.until(s=>s.conversations[0].status==='cancelled');
 await f.update({disconnect:true});await f.until(s=>!s.connected);
 await f.update({disconnect:false,loggedIn:true});assert.equal((await f.post('connect')).status,200);
 assert.equal((await f.state()).conversations[0].id,c.id);
 assert.equal((await f.post('send',{id:c.id,text:'Resume fixture',model:'fixture-model'})).status,200);
 const calls=await f.log();assert(calls.some(m=>m.method==='thread/resume'));assert.equal(calls.filter(m=>m.args).length,2);
});

test('Connect: account read failure clears stale authentication; quota failure blocks sending',async t=>{
 const f=await fixture(t);assert.equal((await f.post('connect')).body.account.type,'chatgpt');
 await f.update({accountError:'Fixture auth read failed'});assert.equal((await f.post('connect')).status,400);
 const failed=await f.state();assert.equal(failed.account,null);assert.equal(failed.error,'Fixture auth read failed');assert.equal(failed.policy.ok,false);
 await f.update({accountError:null,quotaError:'Fixture quota unavailable'});
 const retried=await f.post('connect');assert.equal(retried.status,200);assert.equal(retried.body.account.type,'chatgpt');assert.equal(retried.body.policy.ok,false);assert.equal(retried.body.error,'Fixture quota unavailable');
});

test('Connect: an initial account update cannot return a stale logged-out response',async t=>{
 const f=await fixture(t,{accountUpdateOnRead:true});const connected=await f.post('connect');
 assert.equal(connected.status,200);assert.equal(connected.body.account?.type,'chatgpt');assert.equal(connected.body.policy.ok,true);assert.equal(connected.body.models.length,1);
 assert.equal((await f.log()).filter(call=>call.method==='account/login/start').length,0);
});

test('Local work: explicit scope persists and is bounded, then resuming downgrades to read-only',async t=>{
 const f=await fixture(t,{localWork:true});await f.post('connect');
 const c=(await f.post('conversations',{title:'Local task'})).body;
 const postSend=text=>f.post('send',{id:c.id,text,model:'fixture-model'});
 const stop=async()=>{await f.post('stop',{id:c.id});await f.until(s=>s.conversations.find(chat=>chat.id===c.id)?.status==='cancelled');};
 assert.equal((await postSend('Read-only first')).status,200);await stop();
 let calls=await f.log();assert.equal(calls.filter(m=>m.method==='thread/start').at(-1).params.sandbox,'read-only');
 assert.match(calls.filter(m=>m.method==='thread/start').at(-1).params.developerInstructions,/Never read, list, search/);
 assert.equal((await f.post('conversation-mode',{id:c.id,mode:'work'})).status,200);
 const stored=JSON.parse(await readFile(path.join(f.dir,'data/conversations.json'),'utf8'));
 assert.equal(stored.find(chat=>chat.id===c.id).workMode,'work');
 const cwd=path.join(await realpath(path.join(f.dir,'data')),'workspace','chats',c.id);
 assert.match(await readFile(path.join(cwd,'AGENTS.md'),'utf8'),/Proton VPN/);
 assert.equal((await postSend('Create only within my task')).status,200);
 assert.equal((await f.post('conversation-mode',{id:c.id,mode:'chat'})).status,400);
 calls=await f.log();const work=calls.filter(m=>m.method==='turn/start').at(-1).params;
 assert.equal(work.cwd,cwd);assert.equal(work.sandboxPolicy,undefined);
 assert.equal(calls.filter(m=>m.method==='thread/resume').at(-1).params.sandbox,'workspace-write');
 await stop();assert.equal((await f.post('conversation-mode',{id:c.id,mode:'chat'})).status,200);
 assert.equal((await postSend('Read-only again')).status,200);
 calls=await f.log();assert.equal(calls.filter(m=>m.method==='turn/start').at(-1).params.sandboxPolicy,undefined);
 const resumed=calls.filter(m=>m.method==='thread/resume').at(-1).params;
 assert.equal(resumed.sandbox,'read-only');assert.match(resumed.developerInstructions,/Proton services/);
 await stop();assert.equal((await f.post('conversation-mode',{id:c.id,mode:'all-files'})).status,400);
 assert.equal((await f.post('conversation-mode',{id:'missing',mode:'work'})).status,400);
});

test('Equipment: available skills, isolated loadouts, validated IDs and read-only invocation',async t=>{
 const f=await fixture(t);
 assert.equal((await f.post('skills')).status,400);
 await f.post('connect');
 const stock=await f.post('skills');assert.equal(stock.status,200);assert.equal(stock.body.skills.length,4);
 assert(stock.body.skills.every(skill=>!('path' in skill)));assert(!stock.body.skills.some(skill=>skill.name==='disabled-skill'));
 const skill=name=>stock.body.skills.find(skill=>skill.name===name);
 const source=(await f.post('conversations',{title:'Equipped'})).body,other=(await f.post('conversations',{title:'Other'})).body;
 assert.equal((await f.post('equipment',{id:source.id,slot:'weapon',skillId:'/etc/passwd'})).status,400);
 assert.equal((await f.post('equipment',{id:source.id,slot:'__proto__',skillId:skill('code-review').id})).status,400);
 assert.equal((await f.post('equipment',{id:source.id,slot:'spell',skillId:skill('code-review').id})).status,400);
 for(const [slot,name] of [['weapon','code-review'],['tool','pdf'],['spell','openai-docs']])assert.equal((await f.post('equipment',{id:source.id,slot,skillId:skill(name).id})).status,200);
 assert.equal((await f.state()).conversations.find(c=>c.id===other.id).equipment,undefined);
 assert.equal((await f.post('send',{id:source.id,text:'Use my equipment',model:'fixture-model'})).status,200);
 const sent=(await f.log()).filter(m=>m.method==='turn/start').at(-1);
 assert.deepEqual(sent.params.input.filter(input=>input.type==='skill').map(input=>input.name),['code-review','pdf','openai-docs']);
 assert(sent.params.input.filter(input=>input.type==='skill').every(input=>input.path.startsWith('/fixture/skills/')));
 assert.equal(sent.params.sandboxPolicy,undefined);assert.equal(sent.params.approvalPolicy,'never');
 assert.equal((await f.post('equipment',{id:source.id,slot:'weapon',skillId:null})).status,400);
 assert.equal((await f.post('steer',{id:source.id,text:'Keep investigating',expectedTurnId:'turn-fixture'})).status,200);
 assert.equal((await f.log()).filter(m=>m.method==='turn/steer').at(-1).params.input.filter(input=>input.type==='skill').length,3);
 await f.post('stop',{id:source.id});await f.until(s=>s.conversations[0].status==='cancelled');
 await f.post('send',{id:other.id,text:'Plain conversation',model:'fixture-model'});
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').at(-1).params.input.filter(input=>input.type==='skill').length,0);
 const saved=await f.until(s=>s.conversations[0].equipment.spell.id===skill('openai-docs').id);assert.equal(saved.conversations[0].messages[0].skills.length,3);
 for(let i=0;i<20;i++){
  const stored=JSON.parse(await readFile(path.join(f.dir,'data/conversations.json'),'utf8'));
  if(stored[0].equipment?.spell?.id===skill('openai-docs').id)break;
  if(i===19)assert.fail('Equipment was not persisted');await new Promise(r=>setTimeout(r,10));
 }
});

test('Equipment: projectile is armed explicitly, survives failure, and is spent once',async t=>{
 const f=await fixture(t);await f.post('connect');const stock=(await f.post('skills')).body.skills,mail=stock.find(s=>s.name==='shared-gmail-workflow');
 assert.equal(mail.icon,'bow');assert.equal(mail.singleUse,true);
 const c=(await f.post('conversations')).body;
 await f.post('equipment',{id:c.id,slot:'weapon',skillId:mail.id});
 await f.post('send',{id:c.id,text:'A normal message',model:'fixture-model'});
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').at(-1).params.input.filter(i=>i.type==='skill').length,0);
 await f.post('stop',{id:c.id});await f.until(s=>s.conversations[0].status==='cancelled');
 await f.post('equipment',{id:c.id,slot:'weapon',skillId:mail.id,arm:true});
 await f.update({turnError:'Fixture rejected shot'});assert.equal((await f.post('send',{id:c.id,text:'One explicit shot',model:'fixture-model'})).status,400);
 assert.equal((await f.state()).conversations[0].armedSkillId,mail.id);
 await f.update({turnError:null});assert.equal((await f.post('send',{id:c.id,text:'Retry shot',model:'fixture-model'})).status,200);
 const after=(await f.state()).conversations[0];assert.equal(after.armedSkillId,null);assert.equal(after.equipment.weapon.id,mail.id);
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').at(-1).params.input.filter(i=>i.type==='skill')[0].name,mail.name);
 await f.post('stop',{id:c.id});await f.until(s=>s.conversations[0].status==='cancelled');
 await f.post('send',{id:c.id,text:'The next normal message',model:'fixture-model'});
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').at(-1).params.input.filter(i=>i.type==='skill').length,0);
});

test('Equipment: missing or disabled skills block a turn without dropping the loadout',async t=>{
 const f=await fixture(t);await f.post('connect');const skill=(await f.post('skills')).body.skills[0],c=(await f.post('conversations')).body;
 await f.post('equipment',{id:c.id,slot:skill.slot,skillId:skill.id});
 await f.update({skills:[]});const rejected=await f.post('send',{id:c.id,text:'Unavailable skill',model:'fixture-model'});
 assert.equal(rejected.status,400);assert.match(rejected.body.error,/無効/);assert.equal((await f.state()).conversations[0].equipment.weapon.id,skill.id);
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').length,0);
 assert.equal((await f.post('equipment',{id:c.id,slot:'weapon',skillId:null})).status,200);
 assert.equal((await f.post('send',{id:c.id,text:'Continue without it',model:'fixture-model'})).status,200);
});

test('Context transfer: persistent board, failed send retry, next turn and steer attachment',async t=>{
 const f=await fixture(t);await f.post('connect');
 const source=(await f.post('conversations',{title:'Source'})).body,target=(await f.post('conversations',{title:'Target'})).body;
 assert.equal((await f.post('context/transfer',{sourceId:source.id,targetId:target.id})).status,400);
 await f.post('send',{id:source.id,text:'Source context: preserve read-only mode',model:'fixture-model'});
 await f.post('stop',{id:source.id});await f.until(s=>s.conversations[0].status==='cancelled');
 assert.equal((await f.post('context/transfer',{sourceId:source.id,targetId:source.id})).status,400);
 assert.equal((await f.post('context/transfer',{sourceId:'missing',targetId:target.id})).status,400);
 const shared=await f.post('context/transfer',{sourceId:source.id,targetId:target.id});assert.equal(shared.status,200);assert.equal(shared.body.status,'pending');
 const loaded=await new ContextBoard(path.join(f.dir,'data')).load();assert.equal(loaded.pending(target.id).length,1);
 assert.equal((await f.log()).filter(m=>m.method==='turn/start').length,1);
 await f.update({turnError:'Fixture rejected turn'});
 assert.equal((await f.post('send',{id:target.id,text:'Failed target request',model:'fixture-model'})).status,400);
 assert.equal((await f.state()).contextBoard[0].status,'pending');
 await f.update({turnError:null});
 assert.equal((await f.post('send',{id:target.id,text:'Use the shared context',model:'fixture-model'})).status,200);
 await f.until(s=>s.contextBoard[0].status==='attached');
 const sent=(await f.log()).filter(m=>m.method==='turn/start').at(-1);
 assert.match(sent.params.input[0].text,/Source context: preserve read-only mode/);
 assert.deepEqual(sent.params.input.at(-1),{type:'text',text:'Use the shared context'});
 assert.equal(sent.params.sandboxPolicy,undefined);
 assert.equal((await f.post('context/cancel',{id:shared.body.id})).status,400);
 const next=(await f.post('context/transfer',{sourceId:source.id,targetId:target.id})).body;
 assert.equal((await f.post('steer',{id:target.id,text:'Add this reference',expectedTurnId:'turn-fixture'})).status,200);
 assert.equal((await f.state()).contextBoard.find(e=>e.id===next.id).status,'attached');
 const steered=(await f.log()).filter(m=>m.method==='turn/steer').at(-1);assert.equal(steered.params.input.length,2);
 const cancel=(await f.post('context/transfer',{sourceId:source.id,targetId:target.id})).body;
 assert.equal((await f.post('context/cancel',{id:cancel.id})).status,200);
 assert(!(await f.state()).contextBoard.some(e=>e.id===cancel.id));
});

test('managed policy mismatches stop ordinary chat before a model turn or binding is saved',async t=>{
 for(const effectiveSandbox of [null,{type:'workspaceWrite',writableRoots:[]},{type:'dangerFullAccess'},{type:'externalSandbox'}])await t.test(effectiveSandbox?.type||'missing',async t=>{
  const f=await fixture(t,{effectiveSandbox});await f.post('connect');
  const c=(await f.post('conversations',{title:'Permission mismatch'})).body;
  const response=await f.post('send',{id:c.id,text:'Must not reach model',model:'fixture-model'});
  assert.equal(response.status,400);assert.match(response.body.error,/読み取り専用/);
  assert.equal((await f.log()).filter(call=>call.method==='turn/start').length,0);
  assert.equal((await f.state()).conversations.find(chat=>chat.id===c.id).threadId,null);
 });
});

test('work mode rejects effective read-only and broader managed write roots before a turn',async t=>{
 for(const effectiveSandbox of [{type:'readOnly',networkAccess:false},{type:'workspaceWrite',writableRoots:['/task/outside']}])await t.test(effectiveSandbox.type,async t=>{
  const f=await fixture(t,{localWork:true,effectiveSandbox});await f.post('connect');
  const c=(await f.post('conversations',{title:'Bounded work'})).body;
  await f.post('conversation-mode',{id:c.id,mode:'work'});
  const response=await f.post('send',{id:c.id,text:'Must not reach model',model:'fixture-model'});
  assert.equal(response.status,400);assert.match(response.body.error,/読み取り専用|書き込み範囲/);
  assert.equal((await f.log()).filter(call=>call.method==='turn/start').length,0);
 });
});

test('failed scope negotiation cannot reuse an earlier read-only cache',async t=>{
 const f=await fixture(t,{localWork:true});await f.post('connect');
 const c=(await f.post('conversations',{title:'Scope cache'})).body;
 const send=()=>f.post('send',{id:c.id,text:'Fixture scope check',model:'fixture-model'});
 assert.equal((await send()).status,200);await f.post('stop',{id:c.id});
 await f.until(s=>s.conversations.find(chat=>chat.id===c.id).status==='cancelled');
 await f.post('conversation-mode',{id:c.id,mode:'work'});
 await f.update({effectiveSandbox:{type:'workspaceWrite',writableRoots:['/outside']}});
 assert.equal((await send()).status,400);
 await f.post('conversation-mode',{id:c.id,mode:'chat'});
 assert.equal((await send()).status,400);
 const calls=await f.log();assert.equal(calls.filter(call=>call.method==='thread/resume').length,2);
 assert.equal(calls.filter(call=>call.method==='turn/start').length,1);
});

test('planning inherits a verified read-only policy and rejects managed write access',async t=>{
 const f=await fixture(t,{autoComplete:true});await f.post('connect');
 assert.equal((await f.post('work-quests/generate',{request:'Prepare a fixture plan',model:'fixture-model'})).status,200);
 let calls=await f.log();assert.equal(calls.filter(call=>call.method==='turn/start').length,1);
 assert.equal(calls.find(call=>call.method==='turn/start').params.sandboxPolicy,undefined);
 assert.match(calls.find(call=>call.method==='thread/start').params.developerInstructions,/Proton services/);
 await f.update({effectiveSandbox:{type:'workspaceWrite',writableRoots:[]}});
 const denied=await f.post('work-quests/generate',{request:'Must not generate',model:'fixture-model'});
 assert.equal(denied.status,400);assert.match(denied.body.error,/読み取り専用/);
 calls=await f.log();assert.equal(calls.filter(call=>call.method==='turn/start').length,1);
});

test('new English workspaces use English default titles, and chosen titles survive exactly',async t=>{
 const f=await fixture(t);
 const group=await f.post('chat-groups',{locale:'en'});
 assert.equal(group.status,200);
 assert.equal(group.body.group.title,'Chat 1');
 assert.deepEqual(group.body.conversations.map(chat=>chat.title),['Chat 1','Chat 2','Chat 3','Chat 4']);
 for(const chat of group.body.conversations)assert.match(chat.characterName,/^[A-Za-z ]+$/);
 const named=await f.post('conversations',{title:'会話',locale:'en'});
 assert.equal(named.status,200);
 assert.equal(named.body.title,'会話');
 assert.equal(named.body.chatGroup.title,'Chat 2');
 const another=await f.post('chat-groups',{locale:'ja',title:'A custom name'});
 assert.equal(another.status,200);
 assert.equal(another.body.group.title,'A custom name');
 assert.match(another.body.conversations[0].title,/^会話 /);
 assert.match(another.body.conversations[0].characterName,/[ァ-ヿ]/u);
 const rollout=text=>[{type:'session_meta',payload:{id:'locale-proof',name:'原文の会話名'}},{type:'event_msg',payload:{type:'user_message',message:text}}].map(JSON.stringify).join('\n');
 const imported=await f.post('history/codex/file',{name:'rollout-fixture.jsonl',text:rollout('最初の本文'),locale:'en'});
 assert.equal(imported.status,200);
 const first=imported.body.conversations[0];
 assert.match(first.chatGroup.title,/^Imported from Codex \d{4}-\d{2}-\d{2}$/);
 assert.match(first.characterName,/^[A-Za-z ]+$/);
 assert.equal(first.title,'原文の会話名');assert.equal(first.messages[0].text,'最初の本文');
 const updated=await f.post('history/codex/file',{name:'rollout-fixture.jsonl',text:rollout('原文の続き'),locale:'ja'});
 assert.equal(updated.status,200);const second=updated.body.conversations[0];
 assert.equal(second.id,first.id);assert.equal(second.characterName,first.characterName);
 assert.equal(second.chatGroup.title,first.chatGroup.title);assert.equal(second.messages[0].text,'原文の続き');
});
