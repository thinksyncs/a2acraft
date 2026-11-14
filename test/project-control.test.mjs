import test from "node:test";
import assert from "node:assert/strict";
import { createProjectWorld } from "../public/project-world.js";
import { projectSceneGeometry } from "../public/project-scene.js";
import { placeDistricts, visibleWorldRoads } from "../public/world-geography.js";
import { pointInIsland } from "../public/world-island.js";
import { islandSegmentOnLand, islandRouteWalkable } from "../public/world-island-travel.js";
import { sceneBuildingObstacles } from "../public/project-buildings.js";

// Exercise the real control/redraw lifecycle without WebGL or a browser.
function fixture(t,{hero:initialHero,resident:initialResident}={}) {
  const frames = new Map(), storage = new Map();
  let nextFrame = 0, now = 0, view;
  class Element {
    constructor() {
      this.dataset = {}; this.style = {}; this.children = [];
      this.context = new Proxy({canvas:this,
        measureText:text=>({width:String(text).length*6}),
        getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),
      }, {get:(target,key)=>key in target ? target[key] : ()=>{}});
    }
    getContext() { return this.context; }
    getBoundingClientRect() { return {width:1000,height:640,left:0,top:0}; }
    append(...items) { for (const item of items) { item.parentElement=this; this.children.push(item); } }
    replaceChildren(...items) { this.children=[]; this.append(...items); }
    setAttribute() {}
    setPointerCapture() {}
    addEventListener() {}
    before() {}
    after() {}
    querySelector() { return null; }
  }
  const globals = {
    location:{search:""}, devicePixelRatio:1,
    document:{body:{dataset:{}},hidden:false,createElement:()=>new Element(),addEventListener(){}},
    window:{addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    ResizeObserver:class { observe() {} },
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame:id=>frames.delete(id),
    performance:{now:()=>now},
  };
  const originals = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals))
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{
    try { view?.setVisible(false); }
    finally { for (const [key,descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }}
  });
  storage.set("chat-ui-project-camera-leader-inset",JSON.stringify({visible:false}));
  const points=[{x:500,y:610},{x:1800,y:610}];
  storage.set("chat-ui-project-camera-residents",JSON.stringify(Object.fromEntries(
    ["a","b"].map((id,index)=>[id,{signature:JSON.stringify(points),points,
      progress:100+index*200,position:{x:600+index*200,y:610},heading:Math.PI/2}]))));
  const projects=[{id:"p",name:"Test",repositories:[{id:"r",name:"Repo"}],events:[],jobs:
    ["a","b"].map(id=>({id,repoId:"r",title:id,status:"done",kind:"verify",conversationId:id}))}];
  const chats=["a","b"].map(id=>({id,characterName:id,project:{id:"p",jobId:id}}));
  const world={places:{p:{x:0,y:0}},journeys:Object.fromEntries(
    ["a","b"].map(id=>[id,{from:"p",to:"q",points}]))};
  const layout=placeDistricts(projects,chats,world.places);
  const geometry=projectSceneGeometry(layout,projects,chats.map(chat=>({projectId:chat.project.id})),visibleWorldRoads(layout,world.journeys));
  if(initialResident){
    const records=JSON.parse(storage.get("chat-ui-project-camera-residents"));
    records.a={position:typeof initialResident==="function"?initialResident(geometry):initialResident};
    storage.set("chat-ui-project-camera-residents",JSON.stringify(records));
  }
  if(initialHero)storage.set("chat-ui-project-camera-hero",JSON.stringify({point:
    typeof initialHero==="function"?initialHero(geometry):initialHero}));
  const canvas=new Element(), frame=new Element(), container=new Element();
  container.append(frame); frame.append(canvas);
  view=createProjectWorld({canvas,overlay:new Element(),getProjects:()=>projects,
    getChats:()=>chats,getWorld:()=>world,onResident:()=>{}});
  view.setVisible(true);
  view.fit();
  const camera=()=>JSON.parse(storage.get("chat-ui-project-camera")||"null");
  return {view,canvas,geometry,camera,hero:()=>JSON.parse(canvas.dataset.hero),
    click(point) {
      const view=camera(),event={button:0,pointerId:1,
        clientX:(point.x-view.x)*view.zoom+500,clientY:(point.y-view.y)*view.zoom+320};
      canvas.onpointerdown(event);canvas.onpointerup(event);
    },
    person:id=>view.getResidents().find(person=>person.conversationId===id),
    advance() { now+=100; const callbacks=[...frames.values()]; frames.clear(); for (const callback of callbacks) callback(now); }};
}

const position=person=>({x:person.x,y:person.y});

test("Releasing control to the protagonist resumes the resident after cancellation redraw",t=>{
  const {view,canvas,person,advance}=fixture(t);
  assert.equal(view.control("p","a"),true);
  const held=position(person("a"));
  advance(); advance();
  assert.deepEqual(position(person("a")),held,"controlled resident stays with the leader");
  assert.equal(view.control(),true);
  assert.equal(canvas.dataset.party,"hero");
  assert.deepEqual(position(person("a")),held,"release starts at the actual final location");
  advance(); advance();
  assert.notDeepEqual(position(person("a")),held,"the released resident resumes its own journey");
  assert.equal(person("a").journey.to,"q");
});

function remoteBay(island){
  const points=island.landPatches.map(r=>({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}))
    .filter(p=>Math.hypot(p.x,p.y)>2500);
  for(const start of points)for(const target of points){
    const gap=Math.hypot(start.x-target.x,start.y-target.y);
    if(gap<700||gap>1500||islandSegmentOnLand(start,target,island))continue;
    const sea=Array.from({length:99},(_,n)=>({x:start.x+(target.x-start.x)*(n+1)/100,
      y:start.y+(target.y-start.y)*(n+1)/100})).find(p=>!pointInIsland(p,island));
    if(sea)return {start,target,sea};
  }
  throw new Error("expected an ocean inlet outside the work districts");
}

test("Ground clicks on the distant continent walk around bays and sea clicks preserve that journey",t=>{
  let bay;
  const {view,canvas,geometry,hero,click,advance}=fixture(t,{hero:geometry=>(bay=remoteBay(geometry.island)).start});
  click(bay.target);
  assert.equal(canvas.dataset.travel,"walking");
  advance();const beforeSea=hero();
  click(bay.sea);
  assert.equal(canvas.dataset.travel,"walking","rejecting the sea keeps the current trip");
  assert.deepEqual(hero(),beforeSea);
  let previous=hero(),steps=0;
  while(canvas.dataset.travel==="walking"&&steps++<300){
    advance();const next=hero();
    assert.ok(islandSegmentOnLand(previous,next,geometry.island),"every visible movement stays on dry land");
    previous=next;
  }
  assert.equal(canvas.dataset.travel,"arrived");
  assert.ok(steps>Math.hypot(bay.start.x-bay.target.x,bay.start.y-bay.target.y)/9,
    "the controller follows the longer route around the bay");
  assert.ok(Math.hypot(hero().x-bay.target.x,hero().y-bay.target.y)<1e-6);
  view.cancel();advance();assert.deepEqual(hero(),previous,"arrival and cancellation keep the actual endpoint");
});

test("A failed river destination leaves an existing face-to-face conversation held",t=>{
  const {view,canvas,geometry,hero,click}=fixture(t);
  view.pause(true);assert.equal(view.talkTo("a"),true);
  view.focus("p");
  const encounter=view.getEncounter(),leader=hero();assert.ok(encounter);
  const water=geometry.water.find(rect=>rect.top<=200&&rect.bottom>200);
  click({x:(water.left+water.right)/2,y:200});
  assert.equal(JSON.stringify(view.getEncounter())===JSON.stringify(encounter),true,"the held conversation stays intact");
  assert.deepEqual(hero(),leader);
  assert.equal(canvas.dataset.encounterPhase,"talking");
});

test("A resident beside the river can be approached from dry ground and faces the leader",t=>{
  let bank;
  const {view,canvas,hero}=fixture(t,{resident:geometry=>{
    for(const water of geometry.water){
      if(water.right-water.left<60)continue;
      const y=(water.top+water.bottom)/2,person={x:water.left-12,y},leader={x:water.right+100,y};
      const waterSide={x:person.x+40,y},landSide={x:person.x-40,y};
      if(islandRouteWalkable([person,landSide],geometry.island,geometry)&&
        islandRouteWalkable([leader,leader],geometry.island,geometry)&&
        !islandRouteWalkable([waterSide,waterSide],geometry.island,geometry)){
        bank={person,leader};return person;
      }
    }
    throw new Error("fixture needs a dry bank beside a broad river");
  },hero:()=>bank.leader});
  view.pause(true);
  assert.equal(view.talkTo("a"),true,"the nearby wet approach must not make this resident unreachable");
  const encounter=view.getEncounter();
  assert.ok(encounter);assert.equal(canvas.dataset.encounterPhase,"talking");
  assert.ok(Math.abs(Math.hypot(hero().x-bank.person.x,hero().y-bank.person.y)-40)<1e-6);
  assert.deepEqual({x:encounter.person.x,y:encounter.person.y},bank.person,"the resident stays where selected");
  assert.ok(Math.abs(Math.cos(encounter.person.heading-encounter.leader.heading)+1)<1e-7,
    "the same two actors face each other");
});

test("Switching controlled agents releases only the previous owner",t=>{
  const {view,canvas,person,advance}=fixture(t);
  view.control("p","a");
  const first=position(person("a"));
  assert.equal(view.control("p","b"),true);
  assert.equal(canvas.dataset.party,"p:b");
  const second=position(person("b"));
  advance(); advance();
  assert.notDeepEqual(position(person("a")),first,"previous owner resumes its route");
  assert.deepEqual(position(person("b")),second,"new owner remains controlled");
  view.control(); advance(); advance();
  assert.notDeepEqual(position(person("b")),second,"new owner also resumes when released");
});

test("Zooming out from a district reveals the centered island without moving its residents",t=>{
  const {view,camera,person}=fixture(t);
  view.fit();
  const overview=camera(), resident=position(person("a"));
  view.focus("p");
  assert.ok(camera().zoom>overview.zoom,"the district view is closer than the island overview");
  view.zoom(.0001);
  assert.equal(camera().zoom,overview.zoom,"shrinking stops when the whole island fits");
  assert.equal(camera().x,overview.x);
  assert.equal(camera().y,overview.y);
  assert.deepEqual(position(person("a")),resident,"zoom changes the view, not the people");
  view.fit();
  assert.deepEqual(camera(),overview);
});

test("A restored protagonist inside a decorative cottage is moved onto nearby walkable ground",t=>{
  let cottage;
  const {hero,geometry}=fixture(t,{hero:scene=>{
    cottage=scene.scenery.find(item=>item.kind==="cottage");assert.ok(cottage);
    return {x:cottage.x,y:cottage.y-10};
  }});
  assert.ok(islandRouteWalkable([hero(),hero()],geometry.island,{...geometry,obstacles:sceneBuildingObstacles(geometry)}));
  assert.ok(Math.hypot(hero().x-cottage.x,hero().y-(cottage.y-10))<50,"the saved position is recovered beside the same home");
});

test("Ground walking routes around decorative cottage walls instead of taking the camera through them",t=>{
  let cottage;
  const {view,canvas,geometry,hero,click,advance}=fixture(t,{hero:scene=>{
    cottage=scene.scenery.find(item=>item.kind==="cottage");assert.ok(cottage);
    return {x:cottage.x-70,y:cottage.y-10};
  }});
  const target={x:cottage.x+70,y:cottage.y-10},terrain={...geometry,obstacles:sceneBuildingObstacles(geometry)};
  view.focus("p");view.zoom(100);
  click(target);assert.equal(canvas.dataset.travel,"walking");
  let previous=hero(),steps=0,detoured=false;
  while(canvas.dataset.travel==="walking"&&steps++<100){
    advance();const next=hero();
    assert.ok(islandRouteWalkable([next,next],geometry.island,terrain),"the party keeps its clearance around the cottage");
    assert.ok(islandRouteWalkable([previous,next],geometry.island,{...terrain,obstacles:sceneBuildingObstacles(geometry,0)}),"no visible step cuts through a cottage wall");
    if(Math.abs(next.y-target.y)>10)detoured=true;previous=next;
  }
  assert.equal(canvas.dataset.travel,"arrived");assert.ok(detoured);assert.ok(Math.hypot(hero().x-target.x,hero().y-target.y)<1e-6,JSON.stringify({hero:hero(),target}));
  view.cancel();
});
