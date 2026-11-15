import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSceneGeometry} from '../public/project-scene.js';
import {projectDemo,projectDemoJourneys} from '../public/project-demo.js';
import {placeDistricts,visibleWorldRoads} from '../public/world-geography.js';
import {projectBuildings} from '../public/project-buildings.js';
import {createResidents} from '../public/project-residents.js';
import {islandRouteWalkable} from '../public/world-island-travel.js';
import {riverBridges} from '../public/world-hydrology.js';
import {drawRoadNetwork} from '../public/world-road-art.js';
import {staticMesh} from '../public/world-3d-mesh.js';

function fixture(){
 const sample=projectDemo(),projects=sample.projects.items,chats=sample.chats;
 const layout=placeDistricts(projects,chats),journeys=projectDemoJourneys(projects,chats,layout);
 const scene=projectSceneGeometry(layout,projects,chats.map(c=>({projectId:c.project.id})),visibleWorldRoads(layout,journeys));
 return {projects,chats,layout,journeys,scene};
}
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

test('shared project roads retain affinity widths with bounded fallbacks in 2D and 3D',()=>{
 const widths=[12,40,undefined,NaN,Infinity,-10,1000],expected=[12,40,25,25,25,3,80];
 const input=widths.map((width,i)=>({from:'a',to:'b',width,strength:i===1?1:0,
  points:[{x:0,y:i*100},{x:400,y:i*100}]})),before=structuredClone(input);
 const scene=projectSceneGeometry({},[],[],input),roads=scene.roads.slice(0,input.length);
 assert.deepEqual(roads.map(road=>road.width),expected);
 assert.deepEqual(roads.map(road=>road.strength),input.map(road=>road.strength));
 assert.deepEqual(input,before);
 assert.ok(scene.roads.slice(input.length).every(road=>road.width===25),'fixed facility roads remain infrastructure');
 for(const road of roads){
  const surfaces=[],context={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},fillRect(){},
   stroke(){if(this.strokeStyle==='#cbb77b')surfaces.push(this.lineWidth);}};
  drawRoadNetwork(context,[road]);
  assert.deepEqual(surfaces,[road.width]);
  const mesh=staticMesh({roads:[road],buildings:[],scenery:[],bounds:scene.bounds}),across=[];
  for(let i=0;i<mesh.length;i+=9)if(Math.abs(mesh[i+6]-203/255)<1e-6&&
   Math.abs(mesh[i+7]-183/255)<1e-6&&Math.abs(mesh[i+8]-123/255)<1e-6)across.push(mesh[i+2]);
  assert.ok(across.length>0);
  assert.ok(Math.abs(Math.max(...across)-Math.min(...across)-road.width)<1e-4,'3D surface matches the 2D road width');
 }
});

test('the project map shares a world river and road crossings rather than stamped district rivers',()=>{
 const {scene,layout}=fixture();
 assert.equal(scene.hydrology.rivers.length,1);assert.equal(scene.water,scene.hydrology.water);
 assert.deepEqual(scene.bridges,riverBridges(scene.hydrology,scene.roads));
 assert.ok(scene.water.some(r=>!Object.values(layout).some(p=>r.top>=p.y&&r.bottom<=p.y+640)));
 assert.equal(scene.settlements.length,3);
 for(const town of scene.settlements){
  assert.ok(town.clearings[0].patches.length>1);
  for(const clearing of town.clearings){
   assert.ok(scene.scenery.includes(clearing));
   for(const patch of clearing.patches)assert.ok(!scene.water.some(w=>overlap(patch,w)));
  }
  for(const item of town.scenery)assert.ok(scene.scenery.includes(item));
 }
});

test('planned sprites, real doors and 3D buildings retain the same work identities on dry sites',()=>{
 const {projects,layout,scene}=fixture(),before=structuredClone(layout);
 for(const project of projects){
  const town=scene.settlements.find(s=>s.id===project.id),original=projectBuildings(project);
  assert.deepEqual(town.buildings.map(b=>[b.id,b.repoId,b.jobId,b.stage]),original.map(b=>[b.id,b.repoId,b.jobId,b.stage]));
  for(const building of town.buildings){
   const shape=scene.buildings.find(b=>b.id==='building:'+JSON.stringify([project.id,building.id]));
   assert.equal(shape.x,town.place.x+building.x);assert.equal(shape.y,town.place.y+building.y-26);
   const door={x:town.place.x+building.x,y:town.place.y+building.y+18};
   assert.ok(islandRouteWalkable([door,door],scene.island,scene),'the actual entrance is dry or on a bridge');
  }
 }
 assert.deepEqual(layout,before);
});

test('saved northern districts and expanding worlds retain usable river crossings and fixed facilities',()=>{
 for(const count of [1,5,12,30]){
  const projects=Array.from({length:count},(_,i)=>({id:'p'+i,
   repositories:Array.from({length:i===0?8:2},(_,j)=>({id:'r'+j,name:'repo'})),jobs:[]}));
  const layout=Object.fromEntries(projects.map((p,i)=>[p.id,{x:(i%6-2)*1400,y:(Math.floor(i/6)-1)*1000}]));
  const residents=projects.flatMap(p=>Array.from({length:28},()=>({projectId:p.id})));
  const scene=projectSceneGeometry(layout,projects,residents,visibleWorldRoads(layout,{}));
  const fixed=scene.buildings.filter(b=>b.id.startsWith('facility:')).map(b=>({left:b.x-b.width/2,
   right:b.x+b.width/2,top:b.y-b.depth/2,bottom:b.y+b.depth/2}));
  assert.equal(scene.settlements.length,count);
  for(const town of scene.settlements)for(const plot of town.plots)
   assert.ok(!fixed.some(facility=>overlap(plot,facility)),`${plot.id} overlaps an existing facility`);
  for(const road of scene.roads)assert.ok(islandRouteWalkable(road.points,scene.island,scene),
   `${count} districts: ${road.id||road.from||'facility road'} has water outside its visible bridge`);
 }
});

test('residents use planned work sites and stay dry when an old position is flooded',t=>{
 const {projects,chats,layout,journeys,scene}=fixture(),water=scene.water[Math.floor(scene.water.length/2)];
 const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map([['terrain',JSON.stringify({
  [chats[0].id]:{position:{x:(water.left+water.right)/2,y:(water.top+water.bottom)/2}},
 })]]);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 t.after(()=>prior?Object.defineProperty(globalThis,'localStorage',prior):delete globalThis.localStorage);
 const model=createResidents('terrain',{buildingsFor:p=>scene.settlements.find(s=>s.id===p.id).buildings,terrainFor:()=>scene});
 const people=model.get({projects,chats,places:layout,journeys,clock:2000,moving:.1});
 assert.equal(people.length,chats.length);
 for(const person of people)assert.ok(islandRouteWalkable([person,person],scene.island,scene),person.conversationId+' is on dry land');
 assert.doesNotThrow(()=>JSON.parse(values.get('terrain')));
});
