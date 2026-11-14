import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextBoard,snapshotContext} from '../context-board.mjs';

test('Context board: bounded immutable snapshots, persistence, cancellation and in-flight protection',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'context-board-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const board=await new ContextBoard(dir).load(),source={id:'source',title:'Source',messages:[{role:'user',text:'old '.repeat(10000)},{role:'assistant',text:'Latest answer'}]},target={id:'target',title:'Target'};
 const shared=await board.transfer(source,target);
 assert(shared.text.length<=16000);assert.equal(shared.truncated,true);assert.match(shared.text,/Latest answer/);
 source.messages.at(-1).text='Changed after transfer';assert.match(board.pending(target.id)[0].text,/Latest answer/);
 const loaded=await new ContextBoard(dir).load();assert.equal(loaded.pending(target.id)[0].id,shared.id);
 if(process.platform!=='win32')assert.equal((await stat(path.join(dir,'context-board.json'))).mode&0o777,0o600);
 const reserved=await board.reserve(target.id);await assert.rejects(board.cancel(shared.id),/送信中/);
 board.release(reserved);await board.cancel(shared.id);assert.equal(board.entries.length,0);
 await assert.rejects(board.transfer(source,source),/別の会話/);
 assert.throws(()=>snapshotContext({messages:[{role:'system',text:'Hidden instructions'}]}),/共有できる/);
});

test('Context board: serial transfers enforce pending and per-target limits',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'context-board-limit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const board=await new ContextBoard(dir).load(),source={id:'source',title:'Source',messages:[{role:'user',text:'Small reference'}]},target={id:'target',title:'Target'};
 const results=await Promise.allSettled(Array.from({length:33},()=>board.transfer(source,target)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,32);assert.equal(board.pending(target.id).length,32);
 for(const entry of board.entries)await board.cancel(entry.id);
 const large={...source,messages:[{role:'assistant',text:'x'.repeat(20000)}]};
 await board.transfer(large,target);await board.transfer(large,target);await board.transfer(large,target);
 await assert.rejects(board.transfer(large,target),/多すぎ/);
});
