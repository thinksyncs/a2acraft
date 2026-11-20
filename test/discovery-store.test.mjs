import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DiscoveryStore} from '../discovery-store.mjs';
import {decodeDiscovery,encodeDiscovery} from '../public/discovery-code.js';

async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'a2acraft-discoveries-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const entry={questId:'quest-local-unique',regionId:'village',title:'PRIVATE REQUEST',output:'PRIVATE AGENT OUTPUT',roles:[{name:'PRIVATE NAME',role:'private role'}],acceptedAt:123};

test('two independent stores exchange only opaque IDs and kind; replay after restart does not advance',async t=>{
  const sender=new DiscoveryStore(await directory(t)),receiverDir=await directory(t);let changes=0;
  const receiver=await new DiscoveryStore(receiverDir,()=>changes++).load();
  const {code}=await sender.copy([entry],entry.questId),payload=decodeDiscovery(code);
  assert.equal(payload.kind,'idea');assert.notEqual(payload.questId,entry.questId);
  assert(!JSON.stringify(payload).includes('PRIVATE'));assert.equal(Object.keys(payload).length,3);
  assert.deepEqual(await sender.copy([entry],entry.questId),{code});
  const [first,duplicate]=await Promise.all([receiver.import(code),receiver.import(code)]);
  assert.equal(first.added,true);assert.equal(first.state.count,1);assert.equal(first.state.lit,true);
  assert.equal(duplicate.added,false);assert.equal(duplicate.state.revision,1);assert.equal(changes,1);
  const reopened=await new DiscoveryStore(receiverDir).load(),replay=await reopened.import(code);
  assert.equal(replay.added,false);assert.equal(replay.state.count,1);assert.equal(replay.state.revision,1);
  assert(!JSON.stringify(await readFile(receiver.file,'utf8')).includes('PRIVATE'));
  assert.equal(sender.public().count,0);
});
test('copy reads no private request, output, name, role or time fields',async t=>{
  const source={questId:'quest-opaque',regionId:'forest'};
  for(const key of ['title','text','output','roles','acceptedAt'])Object.defineProperty(source,key,{get(){throw Error('private field read');}});
  const store=new DiscoveryStore(await directory(t));
  assert.equal(decodeDiscovery((await store.copy([source],source.questId)).code).kind,'method');
  await assert.rejects(store.copy([source],'unknown'),/成果/);
  await assert.rejects(store.copy([{questId:'q',regionId:'unknown'}],'q'));
});
test('write or rename failures do not light the workshop, notify observers or advance memory',async t=>{
  const dir=await directory(t);let phase='write',changes=0;
  const store=new DiscoveryStore(dir,()=>changes++,{
    readFile,
    writeFile:async(...args)=>{if(phase==='write')throw Error('disk full');return writeFile(...args);},
    rename:async(...args)=>{if(phase==='rename')throw Error('rename failed');return rename(...args);}
  });
  const {code}=await store.copy([entry],entry.questId);
  await assert.rejects(store.import(code),/disk full/);assert.equal(store.public().count,0);assert.equal(changes,0);
  phase='rename';await assert.rejects(store.import(code),/rename failed/);assert.equal(store.public().count,0);assert.equal(changes,0);
  phase='okay';assert.equal((await store.import(code)).added,true);assert.equal(store.public().count,1);assert.equal(changes,1);
});
test('a changed kind cannot inflate a known ID and distinct accepted quests have distinct IDs',async t=>{
  const store=new DiscoveryStore(await directory(t));
  const first=await store.copy([entry],entry.questId),nextEntry={...entry,questId:'different-quest'};
  const second=await store.copy([nextEntry],nextEntry.questId);
  assert.notEqual(first.code,second.code);
  await store.import(first.code);
  await assert.rejects(store.import(encodeDiscovery({...decodeDiscovery(first.code),kind:'validation'})),/種類が異なり/);
  assert.equal(store.public().count,1);
  await store.import(second.code);assert.equal(store.public().count,2);
});
