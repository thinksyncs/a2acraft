import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPlan} from '../policy.mjs';
const account={type:'chatgpt'},future=()=>Math.floor(Date.now()/1000)+300;
const limits=(usedPercent=30)=>({rateLimits:{primary:{usedPercent,resetsAt:future()}}});
test('ChatGPT plan permits a known unexpired quota',()=>assert.equal(checkPlan(account,limits()).ok,true));
test('API credentials cannot enable inference',()=>assert.equal(checkPlan({type:'apiKey'},limits()).ok,false));
test('unknown quota never counts as zero',()=>{for(const x of [null,{}, {rateLimits:{}},limits(NaN),limits(null)])assert.equal(checkPlan(account,x).ok,false);});
test('5% reserve blocks new work',()=>{assert.equal(checkPlan(account,limits(94)).ok,true);assert.equal(checkPlan(account,limits(95)).ok,false);assert.equal(checkPlan(account,limits(100)).ok,false);});
test('any reached bucket blocks work',()=>assert.equal(checkPlan(account,{rateLimitsByLimitId:{codex:limits(20).rateLimits,other:limits(97).rateLimits}}).ok,false));
test('provider limit marker blocks even with low visible usage',()=>assert.equal(checkPlan(account,{rateLimits:{...limits().rateLimits,rateLimitReachedType:'usage'}}).ok,false));
test('expired reset time requires a fresh server reading',()=>assert.equal(checkPlan(account,{rateLimits:{primary:{usedPercent:2,resetsAt:1}}}).ok,false));

test('quota links to the measured window that actually hit the reserve',()=>{
  const free={usedPercent:20,resetsAt:future()},full={usedPercent:100,resetsAt:future()};
  const prior={limitName:'other',primary:free};
  const gate=bucket=>checkPlan(account,{rateLimitsByLimitId:{other:prior,codex:bucket}});
  assert.deepEqual(gate({primary:free,secondary:full}).quota,{bucketIndex:1,slot:'secondary'});
  assert.deepEqual(gate({primary:free,secondary:full,rateLimitReachedType:'usage'}).quota,{bucketIndex:1,slot:'secondary'});
  assert.deepEqual(gate({primary:free,rateLimitReachedType:'usage'}).quota,{},'provider-only marker does not identify a reset time');
  assert.deepEqual(gate(null).quota,{});
  assert.equal(checkPlan(null,null).quota,undefined);
});
