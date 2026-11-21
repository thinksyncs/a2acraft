import test from "node:test";
import assert from "node:assert/strict";
import { initVillage } from "../public/village.js";
import { villageIsland, village3DScene } from "../public/village-3d-scene.js";
import { villageRiverWater, villageBridge } from "../public/world-terrain.js";
import { VILLAGE_WORLD } from "../public/village-world.js";
import { islandRouteWalkable } from "../public/world-island-travel.js";
import { buildConversationAffinity } from "../public/conversation-affinity.js";
import { buildVillageSemanticLayout } from "../public/village-semantic-layout.js";
import { projectVillage } from "../public/village-model.js";
import { villageBiomes } from "../public/village-3d-scene.js";
import { sceneBuildingObstacles } from "../public/project-buildings.js";
import { villageDemoActivityState, villageDemoChats } from "../public/village-demo.js";

// Run the actual controller, animation and canvas drawing, without a browser,
// external services or WebGL. Character ground shadows locate the rendered
// party; real canvas transforms keep viewport culling meaningful in the fixture.
function fixture(t, { saved, demo = false, sampleWalk = false, building = false, visible = true, extraChats = [], withTeams = false, teamMessaging } = {}) {
  const frames = new Map(), storage = new Map(), navigations = [], openedChats = [];
  const documentListeners = new Map();
  let nextFrame = 0, now = 0, view, root;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag; this.dataset = {}; this.style = { setProperty() {} };
      this.children = []; this.listeners = new Map(); this.attributes = new Map();
      this.classList = { add() {}, toggle() {} }; this.value = ""; this.open = false;
      this.clientWidth = 1000; this.clientHeight = 640; this.shadows = [];
      let matrix={a:1,b:0,c:0,d:1,e:0,f:0};const states=[];
      this.context = new Proxy({canvas:this,
        measureText:text=>({width:String(text).length*6}),
        getTransform:()=>({...matrix}),
        setTransform:(a,b,c,d,e,f)=>{matrix=typeof a==='object'?{...a}:{a,b,c,d,e,f};},
        save:()=>states.push({matrix:{...matrix},fillStyle:this.context.fillStyle}),
        restore:()=>{const state=states.pop();if(state){matrix=state.matrix;this.context.fillStyle=state.fillStyle;}},
        translate:(x,y)=>{matrix.e+=matrix.a*x+matrix.c*y;matrix.f+=matrix.b*x+matrix.d*y;},
        scale:(x,y)=>{matrix.a*=x;matrix.b*=x;matrix.c*=y;matrix.d*=y;},
        ellipse:(x,y)=>{if(this.context.fillStyle==="#17382e60")this.shadows.push({x:x-1,y:y-1});},
        fillRect:(x,y,w,h)=>{if(x===0&&y===0&&w===1000&&h===640)this.shadows=[];},
      }, {get:(target,key)=>key in target ? target[key] : ()=>{}});
    }
    getContext() { return this.context; }
    hasPointerCapture() { return false; }
    get ownerDocument() { return document; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    getBoundingClientRect() { return {width:1000,height:640,left:0,top:0,right:1000,bottom:640}; }
    append(...items) { for (const item of items) { item.parentElement=this; this.children.push(item); } }
    add(item) { this.append(item); }
    replaceChildren(...items) { this.children=[]; this.append(...items); }
    setAttribute(key,value) { this.attributes.set(key,value); }
    getAttribute(key) { return this.attributes.get(key)??null; }
    addEventListener(type,listener) { const rows=this.listeners.get(type)||[];rows.push(listener);this.listeners.set(type,rows); }
    dispatch(type,properties={}) {
      const event={target:this,preventDefault(){},stopImmediatePropagation(){},...properties};
      this["on"+type]?.(event);for(const listener of this.listeners.get(type)||[])listener(event);
    }
    click() { this.dispatch("click"); }
    focus() { document.activeElement=this; }
    contains(node) { return node===this||this.children.some(child=>child.contains?.(node)); }
    matches(selector) { return selector[0]==="#" ? this.id===selector.slice(1) : selector===this.tagName; }
    querySelectorAll(selector) { return this.children.flatMap(child=>[...(child.matches?.(selector)?[child]:[]),...(child.querySelectorAll?.(selector)||[])]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this); }
    scrollIntoView() {}
  }
  const body = new Element("body");
  const globals = {
    location:{search:sampleWalk?'?demo=1&village=sample&walk=resident':''}, devicePixelRatio:1,
    document:{body,hidden:false,activeElement:null,createElement:tag=>new Element(tag),
      createDocumentFragment:()=>new Element('fragment'),createTextNode:text=>Object.assign(new Element('text'),{textContent:text}),
      createElementNS:(_,tag)=>new Element(tag),querySelector:selector=>body.querySelector(selector),
      addEventListener:(type,handler)=>documentListeners.set(type,handler),removeEventListener:type=>documentListeners.delete(type)},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    Option:class extends Element { constructor(label,value){super("option");this.textContent=label;this.value=value;} },
    ResizeObserver:class {observe(){}disconnect(){}}, MutationObserver:class {observe(){}disconnect(){}},
    addEventListener(){}, removeEventListener(){},
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame:id=>frames.delete(id),performance:{now:()=>now},
  };
  const originals = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{try{view?.dispose();}finally{for(const [key,descriptor] of originals){
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }}});
  const key=demo?"chat-ui-demo-village-view":"chat-ui-village-view";
  storage.set(key,JSON.stringify({camera:{x:500,y:320,zoom:1},insetVisible:false,...saved}));
  const members=["a","b","c"].map(id=>({id,title:id,characterName:id,messages:[]})),chats=[...members,...extraChats];
  const baseState={party:{party:{leaderId:"a",members:members.map(chat=>({conversationId:chat.id,role:"担当"}))}},
    village:{overrides:building?[{conversationId:"a",kind:"software",stage:"building"}]:[]}};
  const state=withTeams||sampleWalk?structuredClone(villageDemoActivityState(baseState)):baseState;
  const start=()=>{
    root=new Element();root.id="history-village";body.replaceChildren(root);
    view=initVillage({getChats:()=>chats,getState:()=>state,demo,teamMessaging,onNavigate:id=>navigations.push(id),
      onOpenChat:(id,encounter)=>openedChats.push({id,encounter})});
    if(visible)view.setVisible(true);return view;
  };
  start();
  return {storage,key,navigations,openedChats,state,chats,get view(){return view;},get root(){return root;},
    element:id=>body.querySelector("#"+id),
    hero:()=>({x:Number(root.dataset.heroX),y:Number(root.dataset.heroY)}),
    camera:()=>({x:root.dataset.cameraX,y:root.dataset.cameraY,zoom:root.dataset.zoom}),
    party:()=>body.querySelector("#village-canvas").shadows.slice(-3),
    advance(count=1, milliseconds=80) {for(let i=0;i<count;i++){now+=milliseconds;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);}},
    hide(value) { document.hidden=value;documentListeners.get('visibilitychange')?.(); },
    talk(id) { const find=node=>node.dataset?.villageTalk===id?node:node.children?.map(find).find(Boolean);const control=find(root);assert.ok(control);control.click(); },
    reload(record) {view.dispose();if(record)storage.set(key,JSON.stringify(record));return start();},
  };
}

test("the village opens without the inset even when older automatic view state was stored",t=>{
  const f=fixture(t,{saved:{insetVisible:true}});
  assert.equal(f.element("village-leader-window").hidden,true);
  assert.equal(f.element("village-leader-toggle").getAttribute("aria-expanded"),"false");
  f.view.saveView();
  assert.equal(JSON.parse(f.storage.get(f.key)).showLeaderView,false);
});

test("an assigned waiting team can be inspected before anyone has chat history", t => {
  const f = fixture(t, {visible:false});
  const recipient = "b";
  const task = {id:"first-task", title:"合言葉を決める", status:"todo", assignee:{type:"chat", conversationId:recipient}, runs:[]};
  f.state.todos = {items:[task]};
  f.view.setVisible(true);
  assert.equal(f.root.dataset.population, "0");
  const flag = f.root.querySelectorAll("button").find(button => button.dataset.villageQuest === "todo:first-task");
  assert.ok(flag);
  assert.equal(f.element("village-empty").hidden, true);
  flag.click();
  assert.equal(f.element("village-quest-control").disabled, false);
  f.element("village-quest-peek-close").click();
  f.advance(2);
  assert.equal(f.element("village-empty").hidden, true);

  f.view.setVisible(false);
  f.state.todos = {items:[{...task, assignee:{type:"chat", conversationId:"missing"}}]};
  f.view.setVisible(true);
  assert.equal(f.element("village-empty").hidden, false, "an empty roster and decorative home party do not hide onboarding");
});

test("a castle map report opens the matching squad card without taking control, or the roster if the record expired", t => {
  const f = fixture(t, {visible:false});
  f.state.todos = {items:[{id:"castle-trail",title:"道を調べる",status:"todo",assignee:{type:"chat",conversationId:"b"},runs:[]}]};
  f.view.setVisible(true);
  const control = f.view.getControlledSquadId();
  f.view.openSquadRecord("todo:castle-trail");
  assert.equal(f.root.dataset.selectedSquad, "todo:castle-trail");
  assert.equal(f.element("village-quest-peek").hidden, false);
  assert.equal(f.view.getControlledSquadId(), control);
  f.state.todos = {items:[]};
  f.view.openSquadRecord("todo:castle-trail");
  assert.equal(f.element("village-quest-drawer").hidden, false);
  assert.equal(f.element("village-quest-peek").hidden, true);
});

test("Island overview changes the camera without cancelling the party walk",t=>{
  const f=fixture(t);f.element("village-canvas").dispatch("keydown",{key:"d"});f.advance(6);
  const before=f.party(),leader=f.hero();assert.equal(before.length,3);assert.ok(leader.x>510&&leader.x<550);
  f.element("village-fit").click();
  assert.deepEqual(f.party(),before,"overview must not redraw the party on its old trail");
  assert.deepEqual(f.hero(),leader);f.advance(8);assert.ok(f.hero().x>leader.x);
  assert.equal(f.root.dataset.cameraFollowing,'false');
});

const distantChat={id:'distant',title:'北の天文台の観測記録',characterName:'天文台の人',messages:[{id:'u1',role:'user',text:'星空の観測日時と望遠鏡の記録をまとめたい。'}]};

function teamFixture(t, teamMessaging) {
  const ids = new Set([2, 18, 30, 42, 54, 66, 78, 6].map(n => 'village-demo-' + n));
  const f = fixture(t, { withTeams: true, teamMessaging, extraChats: [...villageDemoChats().filter(chat => ids.has(chat.id)), distantChat] });
  function inspect(id) {
    const flag = f.root.querySelectorAll('button').find(button => button.dataset.villageQuest === id);
    assert.ok(flag, 'map flag for ' + id);
    flag.click();
    assert.equal(f.root.dataset.selectedSquad, id);
    return f.element('village-quest-control');
  }
  function clickGround(x, y) {
    const canvas = f.element('village-canvas');
    const camera = f.camera();
    const event = { target: canvas, button: 0, pointerId: 1,
      clientX: 500 + (x - Number(camera.x)) * Number(camera.zoom),
      clientY: 320 + (y - Number(camera.y)) * Number(camera.zoom) };
    canvas.parentElement.dispatch('pointerdown', event);
    canvas.parentElement.dispatch('pointerup', event);
  }
  return { f, inspect, clickGround };
}

test('switching at a map flag gives the selected leader the walk and encounter and parks the original party', t => {
  const { f, inspect, clickGround } = teamFixture(t);
  const workBefore = structuredClone(f.state);
  const home = f.hero(), id = 'todo:village-sample-pause';
  const control = inspect(id);
  assert.equal(f.view.getControlledSquadId(), 'protagonist', 'opening the card is inspection only');
  assert.ok(control && !control.disabled && !control.hidden);
  control.click();
  assert.equal(f.root.dataset.controlledSquad, id);
  assert.equal(f.view.getControlledParty().leaderId, 'village-demo-6');

  const camp = f.hero();
  assert.notDeepEqual(camp, home);
  clickGround(500, 400);
  assert.ok(Math.abs(Number(f.root.dataset.heroGoalX) - 500) < 2, 'ground click sets the selected team’s goal');
  f.advance(8);
  assert.notDeepEqual(f.hero(), camp, 'the selected party leaves its camp');

  const onRoad = f.hero();
  f.element('village-canvas').dispatch('keydown', { key: 'd' });
  f.advance(6);
  assert.ok(f.hero().x > onRoad.x, 'keyboard moves the same party');

  f.talk(distantChat.id);
  for (let i = 0; i < 240 && f.root.dataset.encounterStatus === 'approaching'; i++) f.advance(1, 300);
  const meeting = f.view.getEncounter();
  assert.equal(meeting?.status, 'talking');
  assert.equal(meeting.conversationId, distantChat.id);
  assert.equal(meeting.leader.conversationId, 'village-demo-6', 'the borrowed leader faces the resident');
  f.element('village-speech-chat').click();
  assert.equal(f.openedChats.at(-1).id, distantChat.id);
  assert.equal(f.openedChats.at(-1).encounter.leader.conversationId, 'village-demo-6');
  const parked = f.hero();

  inspect('protagonist').click();
  assert.equal(f.view.getControlledSquadId(), 'protagonist');
  assert.equal(f.view.getControlledParty().leaderId, 'a');
  assert.deepEqual(f.hero(), home, 'the original party stayed where the player left it');
  assert.equal(f.view.getEncounter(), null, 'the old meeting does not move with control');
  inspect(id).click();
  assert.deepEqual(f.hero(), parked, 'taking control again resumes at the team’s last position');
  assert.deepEqual(f.state, workBefore, 'map control leaves the saved roster, task and run unchanged');
});

test('the map rejects a working team and rechecks changed permissions on use and refresh', t => {
  const { f, inspect } = teamFixture(t);
  const work = 'todo:village-sample-work', paused = 'todo:village-sample-pause';
  const home = f.hero();
  const denied = inspect(work);
  assert.ok(denied && (denied.hidden || denied.disabled));
  assert.equal(f.view.setControlledSquad(work), false, 'direct selection enforces the same permission');
  assert.equal(f.view.setControlledSquad('todo:not-in-this-profile'), false);
  assert.equal(f.root.dataset.controlledSquad, 'protagonist');
  assert.deepEqual(f.hero(), home);

  const oldControl = inspect(paused);
  assert.ok(!oldControl.hidden && !oldControl.disabled);
  const originalTodos = f.state.todos;
  f.state.todos = { ...originalTodos, items: originalTodos.items.filter(todo => 'todo:' + todo.id !== paused) };
  oldControl.click();
  assert.equal(f.view.getControlledSquadId(), 'protagonist', 'a stale card cannot claim a removed team');
  f.state.todos = originalTodos;
  f.view.render();
  assert.equal(f.view.setControlledSquad(paused), true);
  const leaderIndex = f.chats.findIndex(chat => chat.id === 'village-demo-6');
  assert.ok(leaderIndex >= 0);
  f.chats.splice(leaderIndex, 1);
  f.advance(1, 300);
  f.view.render();
  assert.equal(f.root.dataset.controlledSquad, 'protagonist', 'a removed leader revokes control');
  assert.deepEqual(f.hero(), home);
});

test('team card chat stays on the map, preserves drafts by recipient, and revalidates before sending', async t => {
  const drafts = new Map(), sent = [];
  let reason = '';
  const { f, inspect } = teamFixture(t, {
    read: id => ({draft: drafts.get(id) || '', reason}),
    write: (id, text) => drafts.set(id, text),
    send: (id,squadId) => { sent.push({id,squadId,text:drafts.get(id)}); drafts.delete(id); },
  });
  const paused = 'todo:village-sample-pause', leader = 'village-demo-6';
  const chat = f.chats.find(item => item.id === leader);
  chat.messages.push({role:'assistant', text:'次は小さい画面で確認します。'});
  inspect(paused);
  const form = f.element('village-team-chat'), input = f.element('village-team-message');
  const submit = () => form.onsubmit({preventDefault() {}});
  assert.equal(form.hidden, false);
  assert.match(form.querySelector('label').textContent, new RegExp(chat.characterName));
  assert.ok(form.querySelectorAll('span').some(span => span.textContent === '次は小さい画面で確認します。'));
  input.value = '画面の幅は？'; input.dispatch('input');
  f.element('village-quest-control').click();
  assert.equal(f.root.dataset.controlledSquad, paused);
  assert.equal(f.root.dataset.selectedSquad, paused);
  assert.equal(f.element('village-quest-peek').hidden, false);
  assert.equal(input.value, '画面の幅は？');
  assert.equal(sent.length, 0);
  inspect('protagonist');
  assert.equal(input.value, '');
  input.value = 'こちらは別の下書き'; input.dispatch('input');
  inspect(paused);
  assert.equal(input.value, '画面の幅は？');
  reason = 'Codex 未接続';
  await submit();
  assert.equal(sent.length, 0);
  assert.equal(input.value, '画面の幅は？');
  reason = '';
  f.view.render();
  await submit();
  assert.deepEqual(sent, [{id:leader, squadId:paused, text:'画面の幅は？'}]);
  assert.equal(drafts.get('a'), 'こちらは別の下書き');
  assert.equal(f.root.dataset.selectedSquad, paused);
  assert.equal(f.openedChats.length, 0, 'sending leaves the team card on screen');

  input.value = 'まだ送らない'; input.dispatch('input');
  const items = f.state.todos.items.filter(todo => 'todo:' + todo.id !== paused);
  f.state.todos = {...f.state.todos, items};
  await submit();
  assert.equal(sent.length, 1, 'a removed team cannot be addressed through a stale card');
  assert.equal(drafts.get(leader), 'まだ送らない');
});

test('refreshing a quota block keeps the team and its draft until a separate explicit send', async t=>{
  const drafts=new Map(),sent=[];
  let blocked=true, refreshCount=0, resume;
  const refreshing=new Promise(resolve=>{resume=resolve;});
  const {f,inspect}=teamFixture(t,{
    read:id=>({draft:drafts.get(id)||'',reason:blocked?'残量を取得できません。':'',refreshQuota:blocked}),
    write:(id,text)=>drafts.set(id,text),
    send:(id,squadId)=>sent.push({id,squadId,text:drafts.get(id)}),
    refreshQuota:async()=>{refreshCount++;await refreshing;blocked=false;},
  });
  const paused='todo:village-sample-pause';
  inspect(paused);
  const form=f.element('village-team-chat'),input=f.element('village-team-message'),refresh=f.element('village-team-quota-refresh');
  input.value='枠が回復したら聞く';input.dispatch('input');
  assert.equal(refresh.hidden,false);
  assert.equal(refresh.type,'button');
  await form.onsubmit({preventDefault(){}});
  assert.deepEqual(sent,[]);
  const update=refresh.onclick();
  assert.equal(refresh.disabled,true);
  await refresh.onclick();
  assert.equal(refreshCount,1);
  resume();await update;
  assert.equal(refresh.hidden,true);
  assert.equal(f.root.dataset.selectedSquad,paused);
  assert.equal(input.value,'枠が回復したら聞く');
  assert.deepEqual(sent,[]);
  await form.onsubmit({preventDefault(){}});
  assert.deepEqual(sent,[{id:'village-demo-6',squadId:paused,text:'枠が回復したら聞く'}]);
});

test('sample outing follows the main footpath and reaches a resident through the normal encounter',async t=>{
  const f=fixture(t,{demo:true,sampleWalk:true,extraChats:villageDemoChats()});
  f.element('village-walk-sample').click();
  const lanePositions=[];
  for(let i=0;i<100&&f.root.dataset.encounterStatus!=='talking';i++){
    f.advance(1,300);await Promise.resolve();
    const hero=f.hero();
    if(Math.abs(hero.y-400.5)<2)lanePositions.push(hero.x);
  }
  assert.ok(Math.max(...lanePositions)-Math.min(...lanePositions)>80,'a continuous part of the trip traverses the visible lane');
  assert.equal(f.root.dataset.encounterStatus,'talking');
  assert.match(f.root.dataset.speechResident,/^village-demo-\d+$/);
});
test("A distant resident walk follows the party, survives overview, resumes following and arrives",t=>{
  const f=fixture(t,{extraChats:[distantChat],saved:{hero:{point:{x:-2635,y:2224}}}});const start=f.hero();f.talk(distantChat.id);
  assert.equal(f.root.dataset.encounterStatus,'approaching');assert.equal(f.root.dataset.cameraFollowing,'true');
  const goal={x:Number(f.root.dataset.heroGoalX),y:Number(f.root.dataset.heroGoalY)};
  assert.ok(Math.hypot(goal.x-start.x,goal.y-start.y)>1500,'fixture must exercise a long walk');
  assert.ok(Math.abs(Number(f.camera().x)-start.x)<1,'selection focuses the party rather than the distant resident');
  f.advance(10);assert.ok(Math.abs(Number(f.camera().x)-f.hero().x)<1);
  const before=f.hero(),eta=Number(f.root.dataset.travelRemainingSeconds);f.element('village-fit').click();const overview=f.camera();f.advance(10);
  assert.notDeepEqual(f.hero(),before);assert.deepEqual(f.camera(),overview);assert.equal(f.root.dataset.encounterStatus,'approaching');
  assert.ok(Number(f.root.dataset.travelRemainingSeconds)<eta);assert.equal(f.element('village-follow').hidden,false);
  f.element('village-follow').click();f.advance(2);assert.equal(f.root.dataset.cameraFollowing,'true');assert.ok(Math.abs(Number(f.camera().x)-f.hero().x)<1);
  for(let i=0;i<180&&f.root.dataset.encounterStatus==='approaching';i++)f.advance(1,1000);
  assert.equal(f.root.dataset.encounterStatus,'talking');assert.ok(Math.hypot(f.hero().x-goal.x,f.hero().y-goal.y)<.2);
  assert.equal(f.element('village-speech').hidden,false);assert.equal(f.element('village-journey').hidden,true);
});

test("Visible slow frames keep walking speed while hidden and paused time never jumps forward",t=>{
  const f=fixture(t,{extraChats:[distantChat]});f.talk(distantChat.id);f.advance(2);
  const before=f.hero();f.advance(1,1000);const moved=f.hero();
  assert.ok(Math.hypot(moved.x-before.x,moved.y-before.y)>80,'a one-second visible frame must not be truncated to 80 milliseconds');
  f.hide(true);f.advance(30,1000);assert.deepEqual(f.hero(),moved);f.hide(false);f.advance();assert.deepEqual(f.hero(),moved,'first visible frame resets the clock');f.advance();
  const paused=f.hero();f.element('village-motion').click();assert.deepEqual(f.hero(),paused,'pause must not instantly complete the route');
  f.advance(30,1000);assert.deepEqual(f.hero(),paused);assert.equal(f.root.dataset.encounterStatus,'approaching');
  f.element('village-motion').click();f.advance();assert.deepEqual(f.hero(),paused);f.advance();assert.notDeepEqual(f.hero(),paused);
});

test("Leaving a village mid-journey keeps the party on return and cancels stale arrivals",async t=>{
  const f=fixture(t);f.element("village-tavern").click();f.advance(6);
  const before=f.party(),leader=f.hero();assert.equal(f.root.dataset.travelling,"tavern");
  f.view.setVisible(false);f.advance(100);f.view.setVisible(true);f.advance(2);
  assert.deepEqual(f.party(),before);assert.deepEqual(f.hero(),leader);
  assert.equal(f.root.dataset.travelling,"");await Promise.resolve();assert.deepEqual(f.navigations,[]);
});

test("Reload restores the party and camera together, including a journey stopped by closing",t=>{
  const f=fixture(t);f.element("village-tavern").click();f.advance(6);
  const party=f.party(),hero=f.hero(),camera=f.camera();f.reload();
  assert.deepEqual(f.hero(),hero);assert.deepEqual(f.party(),party);assert.deepEqual(f.camera(),camera);
  f.advance(6);assert.deepEqual(f.party(),party,"restoring does not resume an obsolete route or ambient patrol");
  assert.equal(f.root.dataset.travelling,undefined);
});

test("Old camera-only village records remain usable and demo progress stays separate",t=>{
  const f=fixture(t,{demo:true,saved:{camera:{x:620,y:510,zoom:1.25}}});
  assert.deepEqual(f.hero(),{x:490,y:430});assert.deepEqual(f.camera(),{x:"620.0",y:"510.0",zoom:"1.25"});
  f.element("village-canvas").dispatch("keydown",{key:"d"});f.advance(6);f.view.setVisible(false);
  assert.ok(JSON.parse(f.storage.get(f.key)).hero.point.x>510);
  assert.equal(f.storage.has("chat-ui-village-view"),false);
});

test("Closing another screen before first visiting the village preserves its saved party",t=>{
  const point={x:580,y:430};
  const f=fixture(t,{visible:false,saved:{hero:{point,heading:1}}});
  f.reload();f.view.setVisible(true);
  assert.deepEqual(f.hero(),point);assert.deepEqual(f.party(),Array(3).fill(point));
});

const island=villageIsland(),terrain={water:[
  ...villageRiverWater(island.bounds.top,VILLAGE_WORLD.top,{x:0,y:0},20),
  ...villageRiverWater(VILLAGE_WORLD.top,VILLAGE_WORLD.bottom),
  ...villageRiverWater(VILLAGE_WORLD.bottom,island.bounds.bottom,{x:0,y:0},20)],bridges:[villageBridge]};

test("Reload can restore a dry position on the distant continent",t=>{
  const point=island.landPatches.map(r=>({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2})).find(point=>
    Math.hypot(point.x,point.y)>3000&&islandRouteWalkable([point,point],island,terrain));
  // A restored party is only painted when its saved camera covers that part of
  // the continent; the renderer now correctly culls offscreen character models.
  assert.ok(point);const f=fixture(t,{saved:{camera:{...point,zoom:1},hero:{point,heading:1.2}}});
  assert.deepEqual(f.hero(),{x:Number(point.x.toFixed(1)),y:Number(point.y.toFixed(1))});
  f.advance(4);assert.deepEqual(f.party(),Array(3).fill({x:Math.round(point.x),y:Math.round(point.y)}));
});

const water=terrain.water.find(r=>r.top>100&&r.top<250);
const cottage=village3DScene({population:3}).scenery.find(item=>item.kind==='cottage');
const buildingChats=["a","b","c"].map(id=>({id,title:id,characterName:id,messages:[]}));
const buildingProjection=projectVillage(buildingChats,[{conversationId:"a",kind:"software",stage:"building"}]);
const buildingBase=village3DScene({population:3});
const actualBuilding=buildVillageSemanticLayout({...buildingProjection,affinity:buildConversationAffinity(buildingChats),island:villageIsland(),terrain:buildingBase,obstacles:sceneBuildingObstacles(buildingBase),biomes:villageBiomes()}).projects[0];
for(const [label,point] of [["sea",{x:1e6,y:1e6}],["river",{x:(water.left+water.right)/2,y:(water.top+water.bottom)/2}],
  ["building",{x:actualBuilding.x,y:actualBuilding.y-24}],["cottage",{x:cottage.x,y:cottage.y-10}],["malformed",{x:"490",y:430}],["missing",null]])
  test(`Reload rejects a saved party position in ${label}`,t=>{
    const f=fixture(t,{building:true,saved:{hero:{point}}});assert.deepEqual(f.hero(),{x:490,y:430});
    assert.deepEqual(f.party(),Array(3).fill({x:490,y:430}));
  });

test('a companion speaks to a nearby villager after the encounter closes and the player can silence it', t => {
  const f = fixture(t, {extraChats:[distantChat]});
  f.talk(distantChat.id);
  for (let i = 0; i < 180 && f.root.dataset.encounterStatus === 'approaching'; i++) f.advance(1, 1000);
  assert.equal(f.root.dataset.encounterStatus, 'talking');
  const notice = f.element('village-ambient');
  assert.equal(notice.hidden, true);
  f.element('village-speech-close').click();
  for (let i = 0; i < 12 && notice.hidden; i++) f.advance(1, 1000);
  assert.equal(notice.hidden, false);
  assert.match(notice.children[0].textContent, /^[bc]　.*北の天文台/);
  assert.match(notice.children[1].textContent, /天文台の人.*星空の観測日時/);
  f.element('village-ambient-toggle').click();
  assert.equal(notice.hidden, true);
  assert.equal(f.storage.get('chat-ui-village-ambient'), 'off');
  assert.equal(f.root.dataset.encounterStatus, undefined);
});
