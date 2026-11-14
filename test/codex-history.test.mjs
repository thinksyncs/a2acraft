import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexRollout,parseCodexRolloutBundle,MAX_CODEX_HISTORY_BYTES} from '../codex-history.mjs';

const response=(role,text,channel)=>({
  type:'response_item',payload:{type:'message',role,...(channel===undefined?{}:{channel}),content:[{type:role==='user'?'input_text':'output_text',text}]}
});
const event=(type,message,channel)=>({type:'event_msg',payload:{type,message,...(channel===undefined?{}:{channel})}});
const parse=records=>parseCodexRollout([
  {type:'session_meta',payload:{id:'history-fixture',timestamp:'2026-11-14T00:00:00Z'}},
  ...records
].map(record=>JSON.stringify(record)).join('\n'));
const texts=result=>result.messages.map(message=>message.text);

test('rollout import excludes analysis and unknown assistant channels from the visible transcript',()=>{
  const result=parse([
    response('user','Create a small map'),
    response('assistant','internal analysis fixture','analysis'),
    response('assistant','internal future channel fixture','future-internal'),
    response('assistant','I am checking the map.','commentary'),
    response('assistant','The map is ready.','final')
  ]);
  assert.deepEqual(texts(result),['Create a small map','I am checking the map.','The map is ready.']);
  assert.ok(result.warnings.some(warning=>warning.includes('推論')));
});

test('rollout import retains legacy assistant messages without a channel and explicit null channels',()=>{
  const result=parse([
    response('user','Keep this instruction'),
    response('assistant','Legacy answer'),
    response('assistant','Null-channel answer',null)
  ]);
  assert.deepEqual(texts(result),['Keep this instruction','Legacy answer','Null-channel answer']);
  assert.deepEqual(result.warnings,[]);
});

test('rollout import excludes explicitly private agent events while deduplicating visible mirrors',()=>{
  const result=parse([
    event('user_message','Continue from the saved map'),
    event('agent_message','internal event fixture','analysis'),
    event('agent_message','internal unknown event fixture','future-internal'),
    response('assistant','The saved map is open.','final'),
    event('agent_message','The saved map is open.','final'),
    event('agent_message','Legacy event answer')
  ]);
  assert.deepEqual(texts(result),['Continue from the saved map','The saved map is open.','Legacy event answer']);
  assert.ok(result.warnings.some(warning=>warning.includes('推論')));
});

test('assistant channel filtering does not discard user-authored text',()=>{
  const result=parse([
    response('user','Please analyze the map','analysis'),
    response('assistant','Visible answer','final')
  ]);
  assert.deepEqual(texts(result),['Please analyze the map','Visible answer']);
});

const session=id=>[
  {type:'session_meta',payload:{id,name:'Source '+id}},
  event('user_message','Instruction '+id),event('agent_message','Answer '+id)
].map(JSON.stringify).join('\n');

test('rollout bundles preserve distinct identities and single-session compatibility',()=>{
  const first=session('one'),second=session('two');
  assert.deepEqual(parseCodexRolloutBundle(first),[parseCodexRollout(first)]);
  const result=parseCodexRolloutBundle(first+'\n'+second);
  assert.deepEqual(result.map(item=>item.sourceThreadId),['one','two']);
  assert.deepEqual(result.map(item=>item.title),['Source one','Source two']);
  assert.deepEqual(result.map(item=>texts(item)),[['Instruction one','Answer one'],['Instruction two','Answer two']]);
});

test('rollout bundles reject duplicate identities, malformed later sessions and size/count overflow',()=>{
  assert.throws(()=>parseCodexRolloutBundle(session('one')+'\n'+session('one')),/同じセッションID/);
  assert.throws(()=>parseCodexRolloutBundle(session('one')+'\n'+JSON.stringify({type:'session_meta',payload:{id:'empty'}})),/移行できる/);
  assert.throws(()=>parseCodexRolloutBundle(Array.from({length:51},(_,i)=>session('session-'+i)).join('\n')),/50件/);
  assert.throws(()=>parseCodexRolloutBundle('x'.repeat(MAX_CODEX_HISTORY_BYTES+1)),/16 MiB/);
});
