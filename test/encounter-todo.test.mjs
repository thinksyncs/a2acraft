import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TodoStore} from '../todos.mjs';

test('concurrent encounter proposals share one durable TODO with the original spoken exchange',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'a2acraft-encounter-todo-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=await new TodoStore(directory).load();
 const chats=[{id:'a',title:'Garden',characterName:'A'},{id:'b',title:'Water',characterName:'B'}];
 const turns=[{conversationId:'a',text:'Shall we compare watering times?'},{conversationId:'b',text:'Yes, let me make a chart.'},{conversationId:'a',text:'Agreed.'}];
 const proposed={encounterId:'meeting-1',participants:['a','b'],assigneeId:'b',title:'Watering chart',description:'Draft a weekly schedule.',turns};
 const receipts=await Promise.all([1,2].map(()=>store.fromEncounter(proposed,chats,()=>{})));
 assert.deepEqual(receipts.map(v=>v.created).sort(),[false,true]);
 assert.equal(store.value.items.length,1);
 const saved=await new TodoStore(directory).load();
 const task=saved.item('meeting-1');
 assert.deepEqual(task.assignee,{type:'chat',conversationId:'b'});
 assert.deepEqual(task.source,{provider:'encounter',encounterId:'meeting-1',participants:['a','b'],participantNames:{a:'A',b:'B'},turns});
 assert.deepEqual(task.runs,[]);
 await assert.rejects(store.fromEncounter({...proposed,encounterId:'meeting-2'},chats,()=>{throw Error('disabled');}),/disabled/);
 assert.equal(store.value.items.length,1);
 await assert.rejects(store.fromEncounter({...proposed,encounterId:'meeting-3',assigneeId:'other'},chats,()=>{}));
 assert.equal(store.value.items.length,1);
});

test('manual TODO runs use the immutable encounter source and reject missing or mismatched provenance',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'a2acraft-encounter-source-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=await new TodoStore(directory).load();
 const chats=[{id:'a',title:'Garden'},{id:'b',title:'Water'}];
 const turns=['Rain today','I can plan','Agreed'].map((text,i)=>({conversationId:chats[i%2].id,text}));
 await store.fromEncounter({encounterId:'meeting',participants:['a','b'],assigneeId:'b',title:'Make a plan',description:'A short chart.',turns},chats,()=>{});
 const run=await store.begin('meeting');
 const manualLink={todoId:'meeting',runId:run.runId};
 assert.deepEqual(store.encounterSource(manualLink,'b').turns,turns);
 assert.throws(()=>store.encounterSource(manualLink,'other'));
 assert.throws(()=>store.encounterSource({...manualLink,runId:'unrelated'},'b'));
 assert.throws(()=>store.encounterSource({...manualLink,autoEncounterId:'wrong'},'b'));
 const ordinary=await store.save({title:'Other work',assignee:{type:'chat',conversationId:'b'}},chats,[]);
 const ordinaryRun=await store.begin(ordinary.id);
 assert.equal(store.encounterSource({todoId:ordinary.id,runId:ordinaryRun.runId},'b'),null);
 assert.equal(store.encounterSource(null,'b'),null);
});
