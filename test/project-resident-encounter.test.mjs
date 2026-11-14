import test from "node:test";
import assert from "node:assert/strict";
import { createResidents } from "../public/project-residents.js";
import { projectEncounterSightline, projectLeaderPose, projectConversationEncounter, projectConversationApproach } from "../public/project-world.js";
import { islandRouteWalkable, islandLandRoute } from "../public/world-island-travel.js";
import { projectDemo, projectDemoJourneys } from "../public/project-demo.js";
import { projectSceneGeometry } from "../public/project-scene.js";
import { sceneBuildingObstacles } from "../public/project-buildings.js";
import { placeDistricts, visibleWorldRoads } from "../public/world-geography.js";

test("A controlled agent keeps its identity and current facing in the map and conversation snapshot", () => {
  const owner = {id:"resident:owner",conversationId:"owner",seed:"owner-seed",name:"ミラ",
    kind:"agent",color:"#739cb6",x:100,y:100,heading:Math.PI};
  const leader = projectLeaderPose(owner,{x:20,y:20},Math.PI/2);
  const person = {id:"resident:neighbor",conversationId:"neighbor",name:"セリア",
    kind:"agent",seed:"neighbor-seed",x:60,y:20,heading:-Math.PI/2,color:"#cfaa5b"};
  const scene = {leader,people:[leader,person,{id:"occluder",x:40,y:20}]};
  const encounter = projectConversationEncounter(scene,"neighbor");
  assert.equal(leader.conversationId,"owner");
  assert.equal(leader.seed,"owner-seed");
  assert.equal(leader.color,owner.color);
  assert.deepEqual({x:leader.x,y:leader.y,heading:leader.heading},{x:20,y:20,heading:Math.PI/2});
  assert.equal(encounter.leader,encounter.scene.leader);
  assert.equal(encounter.person,encounter.scene.people.find(item=>item.id===person.id));
  assert.equal(encounter.leader.kind,"agent");
  assert.equal(encounter.name,"セリア");
  assert.deepEqual(encounter.scene.people.map(item=>item.id),["leader","resident:neighbor"]);
  assert.equal(scene.people.length,3);
  assert.equal(owner.heading,Math.PI);
  assert.equal(projectConversationEncounter(scene,"missing"),null);
});

test("The unassigned protagonist retains its own appearance in a conversation", () => {
  const leader = projectLeaderPose(null,{x:40,y:80},0);
  assert.equal(leader.id,"leader");
  assert.equal(leader.seed,"hero0");
  assert.equal(leader.color,"#e7be70");
  assert.notEqual(leader.kind,"agent");
});

test("Conversation eye contact keeps the selected resident and leader while clearing only nearby visual occluders", () => {
  const scene = {
    leader: { id: "leader", x: 10, y: 20 },
    people: [
      { id: "leader", x: 10, y: 20 },
      { id: "resident:c", x: 10, y: -20 },
      { id: "follower", x: 10, y: 20 },
      { id: "between", x: 15, y: 0 },
      { id: "side", x: 40, y: 0 },
      { id: "behind", x: 10, y: 45 },
      { id: "distant", x: 10, y: -80 },
    ],
  };
  const filtered = projectEncounterSightline(scene, "c");
  assert.deepEqual(filtered.people.map((person) => person.id),
    ["leader", "resident:c", "side", "behind", "distant"]);
  assert.equal(scene.people.length, 7, "the town's actors are not mutated");
  assert.equal(filtered.leader, scene.leader);
  assert.equal(filtered.people[1], scene.people[1]);
  assert.equal(projectEncounterSightline(scene, "missing"), scene);
});

test("A spoken-to project resident holds its exact identity and facing until released, then resumes its route", (t) => {
  const previousStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => { globalThis.localStorage = previousStorage; });
  const job = { id: "j", repoId: "r", status: "done", conversationId: "c" };
  const input = {
    projects: [{ id: "p", repositories: [{ id: "r", name: "Repo" }], jobs: [job] }],
    chats: [{ id: "c", characterName: "ミナ", title: "同じ会話", project: { id: "p", jobId: "j" } }],
    places: { p: { x: 0, y: 0 } },
    journeys: { c: { points: [{ x: 500, y: 610 }, { x: 1800, y: 610 }] } },
    clock: 100,
    moving: 1,
  };
  storage.set("resident-encounter-test", JSON.stringify({c:{
    signature:JSON.stringify(input.journeys.c.points),points:input.journeys.c.points,
    progress:100,position:{x:600,y:610},heading:Math.PI/2,
  }}));
  const residents = createResidents("resident-encounter-test");
  const person = residents.get(input)[0];
  const position = { x: person.x, y: person.y };
  residents.stop(person);
  person.x += 1000;
  residents.face("c", Math.PI);
  residents.face("missing", 0);
  residents.face("c", NaN);
  job.status = "running";
  for (const clock of [200, 10000]) {
    const held = residents.get({ ...input, clock, moving: 10 })[0];
    assert.equal(held.conversationId, "c");
    assert.equal(held.name, "ミナ");
    assert.equal(held.x, position.x);
    assert.equal(held.y, position.y);
    assert.equal(held.walking, false);
    assert.equal(held.heading, Math.PI);
    assert.equal(held.direction, "down");
  }
  residents.release("c");
  const resumed = residents.get({ ...input, clock: 10100 })[0];
  assert.equal(resumed.conversationId, "c");
  assert(resumed.x > position.x);
  assert.equal(resumed.walking, true);
  assert.equal(resumed.heading, Math.PI / 2);
  assert.equal(resumed.direction, "right");
});

test("Releasing an agent at a new location rechecks its return journey against the river", t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {configurable:true,value:{
    getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),
  }});
  t.after(()=>previousStorage ? Object.defineProperty(globalThis,"localStorage",previousStorage) : delete globalThis.localStorage);
  const island = {bounds:{left:0,right:500,top:0,bottom:800},gridSize:40,
    coast:[{x:0,y:0},{x:500,y:0},{x:500,y:800},{x:0,y:800}],
    landPatches:[{left:0,right:500,top:0,bottom:800}]};
  const terrain = {island,water:[{left:200,right:240,top:0,bottom:800}],
    bridges:[{left:190,right:250,top:80,bottom:120}]};
  const points = [{x:350,y:100},{x:400,y:100}];
  const input = {projects:[{id:"p",jobs:[]}],chats:[{id:"c",project:{id:"p"}}],
    places:{p:{x:0,y:0}},journeys:{c:{points}},clock:100,moving:0};
  storage.set("relocated",JSON.stringify({c:{signature:JSON.stringify(points),points,
    progress:0,position:points[0]}}));
  const model = createResidents("relocated",{buildingsFor:()=>[],terrainFor:()=>terrain});
  model.get(input); // Cache validation before the user moves this agent.
  let previous={x:50,y:600};
  model.relocate("c",previous);
  let wentAcross=false;
  for(let i=1;i<=50;i++){
    const person=model.get({...input,clock:100+i*1100,moving:1})[0];
    assert.ok(islandRouteWalkable([previous,person],island,terrain),
      "every resumed movement must use the real bridge, without a water-side teleport");
    if(person.x>240)wentAcross=true;
    previous=person;
  }
  assert.ok(wentAcross,"the resident resumes its cross-district journey");
});

test("An impossible resident journey waits on dry ground until a real crossing is available", t => {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),storage=new Map();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{
    getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),
  }});
  t.after(()=>previousStorage?Object.defineProperty(globalThis,"localStorage",previousStorage):delete globalThis.localStorage);
  const island={bounds:{left:0,right:500,top:0,bottom:800},gridSize:40,
    coast:[{x:0,y:0},{x:500,y:0},{x:500,y:800},{x:0,y:800}],
    landPatches:[{left:0,right:500,top:0,bottom:800}]};
  let terrain={island,water:[{left:200,right:240,top:0,bottom:800}],bridges:[]};
  const origin={x:180,y:100},points=[origin,{x:400,y:100}];
  const input={projects:[{id:"p",jobs:[]}],chats:[{id:"c",project:{id:"p"}}],
    places:{p:{x:0,y:0}},journeys:{c:{points}},clock:100,moving:1};
  storage.set("blocked",JSON.stringify({c:{signature:JSON.stringify(points),points,
    progress:0,position:origin}}));
  const model=createResidents("blocked",{buildingsFor:()=>[],terrainFor:()=>terrain});
  for(let i=0;i<5;i++){
    const person=model.get({...input,clock:100+i*1100})[0];
    assert.deepEqual({x:person.x,y:person.y},origin,"no crossing must not teleport the resident away");
    assert.equal(person.walking,false);
  }
  terrain={...terrain,bridges:[{left:190,right:250,top:80,bottom:120}]};
  const resumed=model.get({...input,clock:10000})[0];
  assert.equal(resumed.walking,true);
  assert.ok(resumed.x>origin.x);
  assert.ok(islandRouteWalkable([origin,resumed],island,terrain));
});

function projectBuildingFixture(t, saved = {}) {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),storage=new Map([["building-patrol",JSON.stringify(saved)]]);
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{
    getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),
  }});
  t.after(()=>previousStorage?Object.defineProperty(globalThis,"localStorage",previousStorage):delete globalThis.localStorage);
  const demo=projectDemo(),projects=demo.projects.items,places=placeDistricts(projects,demo.chats,{});
  const roads=visibleWorldRoads(places,projectDemoJourneys(projects,demo.chats,places));
  const scene=projectSceneGeometry(places,projects,demo.chats.map(chat=>({projectId:chat.project.id})),roads);
  const terrain={...scene,obstacles:sceneBuildingObstacles(scene)};
  const residents=createResidents("building-patrol",{terrainFor:()=>scene,
    buildingsFor:project=>scene.settlements.find(plan=>plan.id===project.id).buildings});
  const input={projects:[projects[0]],chats:demo.chats.filter(chat=>chat.id==="project-chat-0"),
    places,journeys:{},clock:0,moving:0};
  return {scene,terrain,residents,input};
}

test("The recorded wall-hidden resident is repaired once and keeps that actual position in map and chat",t=>{
  // Actual failed 3D screenshot: Alto was inside task-1's front wall.
  const hidden={x:138.56598508539287,y:472.56215522284157};
  const {scene,terrain,residents,input}=projectBuildingFixture(t,{"project-chat-0":{position:hidden}});
  assert.equal(islandRouteWalkable([hidden,hidden],scene.island,terrain),false);
  const originalLeader={x:167.60836870911976,y:500.0674265985666};
  const routeTo=target=>islandLandRoute(originalLeader,target,scene.island,terrain);
  assert.equal(projectConversationApproach(hidden,originalLeader,scene,routeTo),null,
    "a resident inside a wall must not pass the eye-contact check");
  const repaired=residents.get(input)[0],position={x:repaired.x,y:repaired.y};
  assert.notDeepEqual(position,hidden);
  assert.ok(islandRouteWalkable([repaired,repaired],scene.island,terrain));
  const approach=projectConversationApproach(repaired,originalLeader,scene,routeTo);
  assert.ok(approach,"a real dry, wall-free approach remains reachable");
  assert.ok(islandRouteWalkable([repaired,approach.target],scene.island,terrain));
  residents.stop(repaired);
  residents.face(repaired.conversationId,Math.atan2(approach.target.x-repaired.x,-(approach.target.y-repaired.y)));
  const held=residents.get({...input,clock:20000,moving:10})[0];
  assert.deepEqual({x:held.x,y:held.y},position);
  const leader=projectLeaderPose(null,approach.target,Math.atan2(held.x-approach.target.x,-(held.y-approach.target.y))),
    person={...held,id:"resident:"+held.conversationId},world={...scene,leader,people:[leader,person]};
  const encounter=projectConversationEncounter(world,held.conversationId);
  assert.equal(encounter.person,person);
  assert.equal(encounter.scene.leader,leader);
  assert.equal(encounter.scene.buildings,scene.buildings,"buildings remain present and unchanged");
});

test("Working residents patrol in front of the shared building without crossing its walls",t=>{
  const {scene,terrain,residents,input}=projectBuildingFixture(t);
  let previous=null;const positions=new Set();
  for(let tick=0;tick<120;tick++){
    const person=residents.get({...input,clock:tick*350,moving:.35})[0];
    assert.equal(person.conversationId,"project-chat-0");
    assert.ok(islandRouteWalkable([person,person],scene.island,terrain),"every frame stays outside the building and scaffold");
    if(previous)assert.ok(islandRouteWalkable([previous,person],scene.island,terrain),"no patrol segment cuts through a wall");
    positions.add(person.x.toFixed(2)+","+person.y.toFixed(2));previous=person;
  }
  assert.ok(positions.size>100,"the worker still patrols instead of being permanently frozen");
});

test("Conversation chooses a reachable side with a clear sightline instead of looking through a wall",()=>{
  const island={bounds:{left:0,right:500,top:0,bottom:500},gridSize:40,
    coast:[{x:0,y:0},{x:500,y:0},{x:500,y:500},{x:0,y:500}],
    landPatches:[{left:0,right:500,top:0,bottom:500}]};
  const scene={island,buildings:[{x:110,y:200,width:10,depth:40}],water:[],bridges:[]},
    terrain={...scene,obstacles:sceneBuildingObstacles(scene)},person={x:90,y:200},origin={x:220,y:200};
  const nearest={x:130,y:200};
  assert.ok(islandLandRoute(origin,nearest,island,terrain).length,"the near-side destination itself is reachable");
  assert.equal(islandRouteWalkable([person,nearest],island,terrain),false,"the wall still blocks eye contact");
  const approach=projectConversationApproach(person,origin,scene,target=>islandLandRoute(origin,target,island,terrain));
  assert.ok(approach);
  assert.notDeepEqual(approach.target,nearest);
  assert.ok(islandRouteWalkable([person,approach.target],island,terrain));
  assert.deepEqual(approach.route.at(-1),approach.target);
});
