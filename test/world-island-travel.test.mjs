import test from 'node:test';
import assert from 'node:assert/strict';
import {islandLandRoute,islandSegmentOnLand,islandRouteWalkable} from '../public/world-island-travel.js';
import {createWorldIsland,pointInIsland} from '../public/world-island.js';
import {routeLength,PartyTravel} from '../public/world-travel.js';
import {villageIsland} from '../public/village-3d-scene.js';
import {villageRiverWater,villageBridge} from '../public/world-terrain.js';

const bay=()=>({gridSize:100,bounds:{left:0,right:500,top:0,bottom:500},
  coast:[{x:0,y:0},{x:500,y:0},{x:500,y:100},{x:100,y:100},
    {x:100,y:400},{x:500,y:400},{x:500,y:500},{x:0,y:500}],
  landPatches:[{left:0,right:500,top:0,bottom:100},{left:0,right:100,top:100,bottom:400},
    {left:0,right:500,top:400,bottom:500}]});
const onLand=(route,island)=>route.slice(1).every((point,index)=>islandSegmentOnLand(route[index],point,island));

test('free exploration goes around an ocean bay instead of crossing it',()=>{
  const island=bay(),start={x:450,y:50},target={x:450,y:450},before=structuredClone(island);
  assert.equal(islandSegmentOnLand(start,target,island),false);
  const route=islandLandRoute(start,target,island);
  assert.deepEqual(route[0],start);assert.deepEqual(route.at(-1),target);
  assert.ok(onLand(route,island));assert.ok(routeLength(route)>900);
  assert.ok(route.some(point=>point.x<=100),'the only land connection lies west of the bay');
  assert.deepEqual(island,before);
});

test('local building detours remain dry and keep exact valid destinations',()=>{
  const island=bay(),obstacle={left:200,right:300,top:5,bottom:95};
  const route=islandLandRoute({x:50,y:50},{x:450,y:50},island,{obstacles:[obstacle]});
  assert.deepEqual(route.at(-1),{x:450,y:50});assert.ok(onLand(route,island));
  assert.ok(route.length>2,'a building cannot be crossed by a direct segment');
  const insideStart={x:50,y:50},insideTarget={x:60,y:50};
  assert.deepEqual(islandLandRoute(insideStart,insideTarget,island,
    {obstacles:[{left:5,right:95,top:5,bottom:95}]}).at(-1),{x:95,y:50},
    'a restored leader inside a building still exits to its edge');
  for(let index=1;index<route.length;index++)for(let n=1;n<20;n++){
    const a=route[index-1],b=route[index],x=a.x+(b.x-a.x)*n/20,y=a.y+(b.y-a.y)*n/20;
    assert.ok(!(x>obstacle.left&&x<obstacle.right&&y>obstacle.top&&y<obstacle.bottom));
  }
});

test('sea targets and disconnected land return no route',()=>{
  const island=bay();
  assert.deepEqual(islandLandRoute({x:50,y:50},{x:300,y:250},island),[]);
  assert.deepEqual(islandLandRoute({x:NaN,y:50},{x:50,y:50},island),[]);
  const separated={...island,landPatches:[{left:0,right:100,top:0,bottom:100},{left:400,right:500,top:400,bottom:500}]};
  assert.deepEqual(islandLandRoute({x:50,y:50},{x:450,y:450},separated),[]);
});

test('new continent destinations outside the old village remain reachable at the normal walking speed',()=>{
  const island=createWorldIsland({regions:[{left:-900,right:1900,top:-900,bottom:1150}]}),start={x:500,y:320};
  const destinations=island.landPatches.map(rect=>({x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}))
    .filter(point=>Math.hypot(point.x-start.x,point.y-start.y)>4000)
    .sort((a,b)=>Math.hypot(a.x-start.x,a.y-start.y)-Math.hypot(b.x-start.x,b.y-start.y));
  assert.ok(destinations.length);
  const target=destinations[0],route=islandLandRoute(start,target,island);
  assert.deepEqual(route.at(-1),target);assert.ok(pointInIsland(target,island));assert.ok(onLand(route,island));
  const travel=new PartyTravel(start);travel.go(route);travel.advance(1);
  assert.ok(Math.abs(Math.hypot(travel.position.x-start.x,travel.position.y-start.y)-90)<1e-6);
  travel.advance(Infinity);assert.deepEqual(travel.position,target);
});

test('boundary points are supported and new land data invalidates cached routes',()=>{
  const island=bay();
  const route=islandLandRoute({x:500,y:0},{x:500,y:500},island);
  assert.ok(route.length&&onLand(route,island));
  island.landPatches=[{left:0,right:500,top:0,bottom:100},{left:0,right:500,top:400,bottom:500}];
  assert.deepEqual(islandLandRoute({x:450,y:50},{x:450,y:450},island),[]);
});

test('a bridge narrower than a land cell connects both river banks without crossing water',()=>{
  const island={gridSize:100,bounds:{left:0,right:500,top:0,bottom:500},
    coast:[{x:0,y:0},{x:500,y:0},{x:500,y:500},{x:0,y:500}],
    landPatches:[{left:0,right:500,top:0,bottom:500}]};
  const water=Array.from({length:10},(_,i)=>({left:190,right:310,top:i*50,bottom:(i+1)*50}));
  const bridge={x:180,y:213,w:140,h:24},start={x:50,y:50},target={x:450,y:450};
  assert.deepEqual(islandLandRoute(start,target,island,{water}),[]);
  const options={water,bridges:[bridge],obstacles:[{left:340,right:380,top:240,bottom:400}]};
  const route=islandLandRoute(start,target,island,options);
  assert.deepEqual(route[0],start);assert.deepEqual(route.at(-1),target);
  assert.ok(islandRouteWalkable(route,island,options));
  assert.ok(route.some(point=>point.y>=bridge.y&&point.y<=bridge.y+bridge.h));
  assert.deepEqual(islandLandRoute(start,{x:250,y:100},island,options),[],'river clicks do not become walks on water');
});

test('the extended village river still requires the original bridge outside the old map',()=>{
  const island=villageIsland(),water=[...villageRiverWater(island.bounds.top,-900,{x:0,y:0},20),
    ...villageRiverWater(-900,1150),...villageRiverWater(1150,island.bounds.bottom,{x:0,y:0},20)];
  const y=[-1500,-1800,-2100,-2400].find(y=>pointInIsland({x:500,y},island)&&pointInIsland({x:1300,y},island));
  assert.ok(y<-900);
  const start={x:500,y},target={x:1300,y},options={water,bridges:[villageBridge]};
  const route=islandLandRoute(start,target,island,options);
  assert.deepEqual(route.at(-1),target);assert.ok(islandRouteWalkable(route,island,options));
  assert.ok(routeLength(route)>Math.abs(y)*2,'travel returns to the timber bridge instead of cutting the extended river');
});
