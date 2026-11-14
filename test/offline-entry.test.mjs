import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function openOfflineWorkspace() {');
const end=source.indexOf("\n$('#open-offline').onclick",start);
assert.ok(start>=0&&end>start);

function fixture(values={}){
  const calls=[],prompt={focus(){calls.push('focus-draft');}};
  const context=vm.createContext({
    booting:false,connectionBusy:false,offlineBrowsing:false,chats:[],selected:null,drafts:{},...values,
    $:selector=>{assert.equal(selector,'#prompt');return prompt;},
    updateState(){calls.push('show-workspace');},
    select(id,view,focus){calls.push({chat:id,view});focus();},
    switchView(view,focus){calls.push({view});focus();},
    townSection(section){calls.push({section});},village:{focus(){calls.push('focus-map');}},
    connect(){assert.fail('Offline entry must not connect');},api(){assert.fail('Offline entry must not dispatch work');}
  });
  vm.runInContext(source.slice(start,end),context);
  context.openOfflineWorkspace();
  return {context,calls};
}

test('offline entry restores the selected draft or conversation without connecting',()=>{
  for(const saved of [{messages:[],draft:'saved draft'},{messages:[{role:'user',text:'saved message'}],draft:''}]){
    const f=fixture({chats:[{id:'first',messages:[]},{id:'last',messages:saved.messages}],selected:'last',drafts:{last:saved.draft}});
    assert.equal(f.context.offlineBrowsing,true);
    assert.deepEqual(f.calls,['show-workspace',{chat:'last',view:'chat'},'focus-draft']);
    assert.equal(f.context.drafts.last,saved.draft);
  }
});

test('offline entry opens the village for first use or a missing saved conversation',()=>{
  for(const values of [{chats:[{id:'main',messages:[]}],selected:'main'},{chats:[],selected:'removed'}]){
    const f=fixture(values);assert.equal(f.context.offlineBrowsing,true);
    assert.deepEqual(f.calls,['show-workspace',{view:'town'},{section:'town'},'focus-map']);
  }
});

test('offline entry waits for loading or an active connection attempt to finish',()=>{
  for(const values of [{booting:true},{connectionBusy:true}]){
    const f=fixture(values);assert.equal(f.context.offlineBrowsing,false);assert.deepEqual(f.calls,[]);
  }
});
