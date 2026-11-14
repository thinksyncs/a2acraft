import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {moduleFixture} from './modules-fixture.mjs';

const rollout=(id,text,title='Original title')=>[
  {type:'session_meta',payload:{id,name:title}},
  {type:'event_msg',payload:{type:'user_message',message:text}},
  {type:'event_msg',payload:{type:'agent_message',message:'Recorded answer'}}
].map(JSON.stringify).join('\n');
const importText=(f,text)=>f.post('history/codex/file',{name:'rollout-bundle.jsonl',text});
const savedFile=f=>path.join(f.dir,'data','conversations.json');

test('changed unused imports refresh in place, preserve the local title, and deduplicate all accepted versions',async t=>{
  const f=await moduleFixture(t),first=await importText(f,rollout('source','Original instruction'));
  assert.equal(first.status,200);const original=first.body.conversations[0];
  await f.stop();
  const saved=JSON.parse(await readFile(savedFile(f),'utf8'));
  const local=saved.find(chat=>chat.id===original.id);local.title='My chosen name';
  delete local.migration.sourceDigest;delete local.migration.sourceDigests; // Legacy imports migrate without losing identity.
  await writeFile(savedFile(f),JSON.stringify(saved));await f.restart();
  const updated=await importText(f,rollout('source','Complete instruction','Renamed source'));
  assert.equal(updated.status,200);assert.equal(updated.body.updated,1);assert.equal(updated.body.imported,1);
  const value=updated.body.conversations[0];assert.equal(value.id,original.id);assert.equal(value.title,'My chosen name');
  assert.equal(value.messages[0].text,'Complete instruction');assert.equal(value.migration.sourceDigests.length,2);
  const backup=JSON.parse(await readFile(path.join(f.dir,'data',updated.body.backup),'utf8'));
  assert.equal(backup.find(chat=>chat.id===original.id).messages[0].text,'Original instruction');
  for(const text of ['Complete instruction','Original instruction']){
    const duplicate=await importText(f,rollout('source',text));
    assert.equal(duplicate.body.imported,0);assert.equal(duplicate.body.skipped,1);
  }
  await f.restart();
  assert.equal((await f.state()).conversations.find(chat=>chat.id===original.id).messages[0].text,'Complete instruction');
});

test('continued imports retain their conversation and receive changed source content as a separate snapshot',async t=>{
  const f=await moduleFixture(t),first=await importText(f,rollout('source','Original instruction'));
  const id=first.body.conversations[0].id;
  assert.equal((await f.post('send',{id,text:'Continue this task',model:'fixture-model'})).status,200);
  await f.until(state=>state.conversations.find(chat=>chat.id===id)?.status==='completed');
  const before=(await f.state()).conversations.find(chat=>chat.id===id);
  const result=await importText(f,rollout('source','More complete instruction'));
  assert.equal(result.status,200);assert.equal(result.body.updated,0);assert.equal(result.body.imported,1);
  assert.notEqual(result.body.conversations[0].id,id);
  assert.deepEqual((await f.state()).conversations.find(chat=>chat.id===id),before);
  assert.equal((await importText(f,rollout('source','More complete instruction'))).body.skipped,1);
});

test('failed reimport persistence and malformed later bundle sessions leave existing history unchanged',async t=>{
  const f=await moduleFixture(t),first=await importText(f,rollout('source','Original instruction'));
  const id=first.body.conversations[0].id,file=savedFile(f),before=await readFile(file,'utf8');
  const original=(await f.state()).conversations.find(chat=>chat.id===id),blocked=path.join(f.dir,'data','conversations.tmp');
  await mkdir(blocked);
  assert.equal((await importText(f,rollout('source','Changed instruction'))).status,400);
  assert.equal(await readFile(file,'utf8'),before);
  assert.deepEqual((await f.state()).conversations.find(chat=>chat.id===id),original);
  await rm(blocked,{recursive:true});
  const malformed=rollout('second','Do not partially import')+'\n'+JSON.stringify({type:'session_meta',payload:{id:'empty'}});
  assert.equal((await importText(f,malformed)).status,400);
  assert.equal(await readFile(file,'utf8'),before);
  assert.equal((await f.state()).conversations.filter(chat=>chat.migration).length,1);
});

test('one bundle imports multiple conversations atomically and skips unchanged reimports',async t=>{
  const f=await moduleFixture(t),bundle=rollout('first','First instruction')+'\n'+rollout('second','Second instruction');
  const first=await importText(f,bundle);assert.equal(first.status,200);assert.equal(first.body.imported,2);
  assert.deepEqual(first.body.conversations.map(chat=>chat.migration.sourceThreadId),['first','second']);
  const again=await importText(f,bundle);assert.equal(again.body.imported,0);assert.equal(again.body.skipped,2);
});
