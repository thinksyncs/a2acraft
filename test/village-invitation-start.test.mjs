import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TodoStore} from '../todos.mjs';
import {assertVillageInvitation, villageInvitation} from '../public/village-initiative.js';

test('a map offer can reserve only the reviewed task and roster, once', async t => {
 const directory=await mkdtemp(path.join(os.tmpdir(),'a2acraft-invitation-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const todos=await new TodoStore(directory).load();
 const crew={leaderId:'scout',members:[{conversationId:'scout',role:'見張り'},{conversationId:'smith',role:'鍛冶'}]};
 const task=await todos.save({title:'北の橋を調べる',assignee:{type:'party'}},[],[]);
 const invite=villageInvitation(task,crew);
 const guard=(party,token=invite.version)=>item=>assertVillageInvitation(item,party,token);
 await assert.rejects(todos.begin(task.id,guard({...crew,leaderId:'smith'})),/担当が変わりました/);
 assert.equal(todos.item(task.id).runs.length,0);
 // A write already queued before the map request must invalidate it too.
 const editing=todos.save({...task,title:'南の橋を調べる'},[],[]);
 const stale=todos.begin(task.id,guard(crew));
 const updated=await editing;
 await assert.rejects(stale,/担当が変わりました/);
 const current=villageInvitation(updated,crew);
 const attempts=await Promise.allSettled([todos.begin(task.id,guard(crew,current.version)),todos.begin(task.id,guard(crew,current.version))]);
 assert.deepEqual(attempts.map(result=>result.status),['fulfilled','rejected']);
 assert.equal(todos.item(task.id).runs.length,1);
 assert.equal(todos.item(task.id).runs[0].snapshot.title,updated.title);
});
