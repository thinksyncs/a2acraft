import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMapGroups} from '../public/project-map-groups.js';
import {createProjectWorld} from '../public/project-world.js';

const projects=['a','b','c','d'].map(id=>({id,name:id,jobs:[],events:[],repositories:[]}));
const layout={a:{x:0,y:0},b:{x:2000,y:0},c:{x:1000,y:2000},d:{x:20000,y:0}};

test('atlas grouping keeps nearby districts together while retaining remote districts and all source data',()=>{
  const before=structuredClone({projects,layout}),groups=projectMapGroups(projects,layout,.02);
  assert.deepEqual(groups.map(group=>group.ids),[['a','b','c'],['d']]);
  assert.equal(groups[0].x,1500);assert.equal(groups[0].y,320+2000/3);
  assert.deepEqual({projects,layout},before);
  assert.deepEqual(groups.flatMap(group=>group.ids).sort(),projects.map(project=>project.id));
});

test('groups are independent of registration order and separate naturally on zooming in',()=>{
  const before=projectMapGroups(projects,layout,.02);
  assert.deepEqual(projectMapGroups([...projects].reverse(),layout,.02),before);
  assert.deepEqual(projectMapGroups(projects,layout,.12).map(group=>group.ids),[['a'],['b'],['c'],['d']]);
  assert.deepEqual(projectMapGroups([...projects,{id:'unknown'}],layout,.02),before,'missing positions do not create phantom groups');
});

test('atlas grouping leaves enough room for the actual district label width',()=>{
  const pair=projects.slice(0,2),near={a:{x:0,y:0},b:{x:2300,y:0}};
  assert.deepEqual(projectMapGroups(pair,near,.05).map(group=>group.ids),[['a','b']],
    '120px labels would overlap at 115 screen pixels and need one shared control');
  assert.deepEqual(projectMapGroups(pair,{...near,b:{x:2800,y:0}},.05).map(group=>group.ids),[['a'],['b']],
    'labels remain separate once their screen footprints have a visible gap');
});

test('the real atlas control opens a group without selecting or executing a project',t=>{
  const storage=new Map([['chat-ui-project-camera-leader-inset',JSON.stringify({visible:false})]]);
  class Element{
    constructor(){this.dataset={};this.style={};this.children=[];this.attributes={};this.textContent='';
      this.context=new Proxy({canvas:this,measureText:text=>({width:String(text).length*6}),
        getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})},{get:(target,key)=>key in target?target[key]:()=>{}});}
    getContext(){return this.context;}
    getBoundingClientRect(){return {width:1000,height:640,left:0,top:0};}
    append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(){} before(){} after(){} querySelector(){return null;}
  }
  const globals={location:{search:''},devicePixelRatio:1,
    document:{body:{dataset:{}},hidden:false,createElement:()=>new Element(),addEventListener(){}},
    window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    matchMedia:()=>({matches:false,addEventListener(){}}),ResizeObserver:class{observe(){}},
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>0}};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  let view;
  t.after(()=>{try{view?.setVisible(false);}finally{for(const [key,descriptor] of originals){
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}});
  const canvas=new Element(),overlay=new Element(),frame=new Element(),container=new Element();
  container.append(frame);frame.append(canvas);
  const local=structuredClone(projects.slice(0,3));local[0].events.push({id:'question',status:'open',kind:'question'});
  const before=structuredClone(local);let selected=0;
  view=createProjectWorld({canvas,overlay,getProjects:()=>local,getChats:()=>[],
    getWorld:()=>({places:layout}),onDistrict:()=>selected++});
  view.setVisible(true);view.zoom(.0001);
  const group=overlay.children.find(button=>button.dataset.cluster);
  assert.ok(group,'the world view must replace overlapping district labels with one control');
  assert.equal(group.textContent,'仕事の街 · 3地区');
  assert.equal(group.style.minHeight,'44px');
  assert.equal(group.children[0].textContent,'! 相談 1地区','grouping retains work that needs attention');
  assert.deepEqual(JSON.parse(group.dataset.cluster),['a','b','c']);
  group.onclick();
  const camera=JSON.parse(storage.get('chat-ui-project-camera'));
  assert.ok(camera.zoom>=.12);
  assert.equal(overlay.children.filter(button=>button.dataset.cluster).length,0,'zoom reveals the individual districts');
  assert.equal(overlay.children.filter(button=>button.className==='project-district-label').length,3);
  assert.equal(selected,0,'expanding the atlas must not open work details');
  assert.deepEqual(local,before);
});
