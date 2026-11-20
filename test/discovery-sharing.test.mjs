import test from 'node:test';
import assert from 'node:assert/strict';
import {initDiscoverySharing} from '../public/discovery-sharing.js';
import {decodeDiscovery,encodeDiscovery,emptyDiscoveryState} from '../public/discovery-code.js';

class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.value='';}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  remove(){this.removed=true;}
}
const all=node=>[node,...node.children.flatMap(all)];
async function fixture(t,{demo=true,clipboard,api,storageWrite}={}){
  const previous=Object.fromEntries(['document','navigator','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const storage=new Map(),writes=[],states=[],notices=[],calls=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:tag=>new Element(tag)}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:clipboard||(async(value)=>writes.push(value)),readText(){throw Error('clipboard reads prohibited');}}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storageWrite?.(key,value);storage.set(key,value);}}});
  const host=new Element('main');let state=emptyDiscoveryState();
  const view=initDiscoverySharing({host,demo,getState:()=>state,getAdventure:()=>({journal:[{questId:'owned-quest',title:'private title',output:'private output'}]}),onState:value=>{states.push(value);state=value;},notify:value=>notices.push(value),api:async(route,input)=>{calls.push({route,input});return api?.(route,input);}});
  t.after(()=>{view.destroy();for(const key of Object.keys(previous)){if(previous[key])Object.defineProperty(globalThis,key,previous[key]);else delete globalThis[key];}});
  const root=host.children[0],find=predicate=>all(root).find(predicate);
  return {root,view,writes,states,notices,calls,storage,
    copy:find(n=>n.tag==='button'&&n.textContent==='発見をコピー'),receive:find(n=>n.tag==='button'&&n.textContent==='相手の発見を取り込む'),
    input:find(n=>n.attributes['aria-label']==='発見コード'),manual:find(n=>n.attributes['aria-label']==='コピーする発見コード'),
    dialog:find(n=>n.tag==='dialog'),form:find(n=>n.tag==='form'),error:find(n=>n.attributes.role==='alert')};
}
test('copy fallback exposes only the minimal code and repeated demo imports keep one lit workshop',async t=>{
  const f=await fixture(t,{clipboard:async()=>{throw Error('clipboard unavailable');}});
  await f.copy.onclick();const code=f.manual.value;
  assert.equal(f.manual.selected,true);assert.deepEqual(Object.keys(decodeDiscovery(code)),['questId','discoveryId','kind']);
  f.receive.onclick();f.input.value=code;await f.form.onsubmit({preventDefault(){}});
  assert.equal(f.root.dataset.lit,'true');assert.equal(f.root.dataset.count,'1');assert.equal(f.dialog.open,false);
  assert.equal(f.states.at(-1).revision,1);const persisted=[...f.storage.values()][0];
  f.receive.onclick();f.input.value=code;await f.form.onsubmit({preventDefault(){}});
  assert.equal(f.root.dataset.count,'1');assert.equal(f.states.at(-1).revision,1);
  assert.equal([...f.storage.values()][0],persisted);assert.match(f.notices.at(-1),/取り込み済み/);
});
test('demo persistence failure keeps the workshop dark and allows a durable retry',async t=>{
  let fail=true;const f=await fixture(t,{storageWrite:()=>{if(fail)throw Error('storage full');}});
  await f.copy.onclick();f.receive.onclick();f.input.value=f.writes[0];await f.form.onsubmit({preventDefault(){}});
  assert.equal(f.root.dataset.lit,'false');assert.equal(f.states.length,0);assert.equal(f.dialog.open,true);assert.match(f.error.textContent,/storage full/);
  fail=false;await f.form.onsubmit({preventDefault(){}});assert.equal(f.root.dataset.lit,'true');assert.equal(f.root.dataset.count,'1');
});
test('live copy sends only an accepted quest ID and refuses a response containing arbitrary text',async t=>{
  let valid=false;const finding={questId:'q'.repeat(22),discoveryId:'f'.repeat(22),kind:'comparison'};
  const f=await fixture(t,{demo:false,api:()=>({code:valid?encodeDiscovery(finding):'PRIVATE OUTPUT'})});
  await f.copy.onclick();assert.equal(f.writes.length,0);assert.equal(f.manual.value,'');
  assert.deepEqual(f.calls[0],{route:'discoveries/copy',input:{questId:'owned-quest'}});
  valid=true;await f.copy.onclick();assert.deepEqual(decodeDiscovery(f.writes[0]),finding);
});
