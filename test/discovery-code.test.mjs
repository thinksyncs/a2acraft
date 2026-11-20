import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeDiscovery,decodeDiscovery,importDiscovery,emptyDiscoveryState,validateDiscoveryState} from '../public/discovery-code.js';

const finding={questId:'q'.repeat(22),discoveryId:'d'.repeat(22),kind:'idea'};
const raw=value=>'A2A1.'+btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
test('the compact discovery envelope contains exactly three fields and round trips',()=>{
  const code=encodeDiscovery(finding);
  assert(code.length<200);assert.deepEqual(decodeDiscovery(code),finding);
  assert.deepEqual(Object.keys(JSON.parse(atob(code.slice(5).replaceAll('-','+').replaceAll('_','/')))),['questId','discoveryId','kind']);
  assert.deepEqual(decodeDiscovery(' \n'+code+'\n'),finding);
});
test('codes reject content, unknown fields, malformed identifiers and unknown kinds',()=>{
  for(const value of [{...finding,output:'private contents'},{...finding,title:'private title'},
    {...finding,kind:['idea']},{...finding,kind:'constructor'},{...finding,kind:'completed-work'},
    {...finding,questId:'a/path'},[finding],null]){
    assert.throws(()=>encodeDiscovery(value));assert.throws(()=>decodeDiscovery(raw(value)));
  }
  for(const code of ['https://example.test','A2A1.!!!','A2A2.'+encodeDiscovery(finding).slice(5),
    encodeDiscovery(finding)+'=',encodeDiscovery(finding)+'\n'+encodeDiscovery(finding),'x'.repeat(321)])
    assert.throws(()=>decodeDiscovery(code));
});
test('duplicate codes leave progress and revision unchanged and conflicts do not create a new finding',()=>{
  const original=emptyDiscoveryState(),code=encodeDiscovery(finding),first=importDiscovery(original,code);
  assert.equal(first.added,true);assert.equal(first.state.items.length,1);assert.equal(first.state.revision,1);
  assert.deepEqual(original,emptyDiscoveryState());
  const duplicate=importDiscovery(first.state,code);
  assert.equal(duplicate.added,false);assert.deepEqual(duplicate.state,first.state);
  assert.throws(()=>importDiscovery(first.state,encodeDiscovery({...finding,kind:'method'})),/種類が異なり/);
  assert.throws(()=>validateDiscoveryState({...first.state,items:[finding,finding]}),/重複/);
});
