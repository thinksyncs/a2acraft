import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConversationAffinity} from '../public/conversation-affinity.js';
import {buildVillageSemanticLayout,conversationCoordinates,affinityRoadWidth,VILLAGE_ROAD_MIN_AFFINITY,roadRouteIsSafe} from '../public/village-semantic-layout.js';
import {villageDemoChats} from '../public/village-demo.js';
import {projectVillage} from '../public/village-model.js';
import {villageIsland,villageBiomes,village3DScene} from '../public/village-3d-scene.js';
import {sceneBuildingObstacles} from '../public/project-buildings.js';
import {islandLandRoute,islandRouteWalkable} from '../public/world-island-travel.js';

const separation=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const samples=[
  ['compiler-a','compiler parser syntax optimizer bytecode compiler parser'],
  ['compiler-b','compiler parser syntax optimizer bytecode compiler parser'],
  ['orchard-a','orchard apple harvest irrigation blossom fruit orchard apple'],
  ['orchard-b','orchard apple harvest irrigation blossom fruit orchard apple'],
  ['galaxy-a','galaxy telescope astronomy orbit nebula spectrum galaxy telescope'],
  ['galaxy-b','galaxy telescope astronomy orbit nebula spectrum galaxy telescope'],
].map(([id,text])=>({id,title:id,messages:[{role:'user',text}]}));

test('actual vector distances place related conversations near and unrelated topics across the world',()=>{
  const affinity=buildConversationAffinity(samples),positions=conversationCoordinates(samples.map(c=>c.id),affinity);
  for(const topic of ['compiler','orchard','galaxy']){
    const a=positions.get(topic+'-a'),b=positions.get(topic+'-b');
    const distant=positions.get((topic==='compiler'?'orchard':'compiler')+'-a');
    assert.ok(separation(a,b)<separation(a,distant)/3);
  }
  assert.ok(Math.min(...[...positions.values()].map(p=>p.x))<0);
  assert.ok(Math.max(...[...positions.values()].map(p=>p.x))>1000);
  assert.deepEqual(conversationCoordinates([...samples].reverse().map(c=>c.id),affinity),positions);
});

test('road width follows affinity and weak relationships have no decorative road',()=>{
  assert.equal(affinityRoadWidth(0),3);assert.equal(affinityRoadWidth(1),28);
  assert.ok(affinityRoadWidth(.8)>affinityRoadWidth(.4));
  const island={bounds:{left:-8000,right:8000,top:-8000,bottom:8000},gridSize:160,coast:[{x:-8000,y:-8000},{x:8000,y:-8000},{x:8000,y:8000},{x:-8000,y:8000}],landPatches:[{left:-8000,right:8000,top:-8000,bottom:8000}]};
  const affinity=buildConversationAffinity(samples),residents=samples.map(c=>({conversationId:c.id}));
  const result=buildVillageSemanticLayout({residents,affinity,island});
  assert.equal(result.homes.size,6);
  assert.ok(result.roads.length>0&&result.roads.length<5);
  for(const road of result.roads){
    assert.ok(road.similarity>=VILLAGE_ROAD_MIN_AFFINITY);
    assert.equal(road.width,affinityRoadWidth(affinity.similarity(road.from,road.to)));
    assert.equal(road.from.split('-')[0],road.to.split('-')[0]);
  }
});

test('fictional villages use reachable dry homes and one full-width road geometry in both projections',()=>{
  const chats=villageDemoChats().slice(0,26),projection=projectVillage(chats),affinity=buildConversationAffinity(chats);
  const island=villageIsland(),base=village3DScene({population:chats.length});
  const layout=buildVillageSemanticLayout({...projection,affinity,island,terrain:base,obstacles:sceneBuildingObstacles(base),biomes:villageBiomes()});
  assert.equal(layout.homes.size,projection.residents.length);assert.deepEqual(layout.unplaced,[]);
  assert.equal(new Set([...layout.homes.values()].map(p=>p.x+':'+p.y)).size,layout.homes.size);
  const scene=village3DScene({projects:layout.projects,population:chats.length,roads:layout.roads,clearings:layout.clearings});
  const obstacles=[...sceneBuildingObstacles(scene),...layout.mountains],terrain={obstacles,water:scene.water,bridges:scene.bridges};
  for(const home of layout.homes.values()){
    assert.ok(islandLandRoute({x:490,y:430},home,island,terrain).length,home.conversationId+' must be reachable from the village');
    assert.ok(islandRouteWalkable([...home.patrol,home.patrol[0]],island,terrain));
  }
  assert.ok([...layout.homes.values()].some(p=>p.x>2000));
  assert.ok([...layout.homes.values()].some(p=>p.x<-2000));
  for(const road of layout.roads){
    assert.deepEqual(scene.roads.find(r=>r.id===road.id),road);
    assert.ok(roadRouteIsSafe(road.points,road.width,island,terrain));
  }
  for(const clearing of layout.clearings)assert.deepEqual(scene.scenery.find(s=>s.id===clearing.id),clearing);
  const distant=[...layout.homes.values()].sort((a,b)=>separation(b,{x:490,y:430})-separation(a,{x:490,y:430}))[0];
  assert.ok(islandLandRoute(distant,{x:-420,y:400},island,terrain).length,'a distant resident can walk back to the tavern');
});

for(const count of [26,168])test(`${count} fictional conversations keep repeated topics close after terrain placement`,()=>{
  const chats=count===26?villageDemoChats().slice(16,42):villageDemoChats();
  const projection=projectVillage(chats),affinity=buildConversationAffinity(chats),base=village3DScene({population:chats.length});
  const layout=buildVillageSemanticLayout({...projection,affinity,island:villageIsland(),terrain:base,obstacles:sceneBuildingObstacles(base),biomes:villageBiomes()});
  const daily=chats.map(chat=>({id:chat.id,topic:chat.title.match(/^(.+) · \d+$/u)?.[1]})).filter(chat=>chat.topic);
  const related=[],unrelated=[];
  for(let i=0;i<daily.length;i++)for(let j=0;j<i;j++){
    const a=daily[i],b=daily[j],distance=separation(layout.homes.get(a.id),layout.homes.get(b.id));
    (a.topic===b.topic?related:unrelated).push(distance);
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  assert.equal(layout.homes.size,chats.length);
  assert.ok(related.length>0&&unrelated.length>0,'compare both repeated topics and different topics');
  assert.ok(median(related)<median(unrelated)/3,'terrain snapping must preserve the visible relationship between topic and distance');
});
