import test from 'node:test';
import assert from 'node:assert/strict';
import {meanderRoad} from '../public/world-road-shape.js';

const route=[{x:0,y:0},{x:1200,y:0}];
const options={seed:'related-conversations',amplitude:32,step:32};

test('roads gain seeded gentle bends while retaining endpoints and input data',()=>{
 const before=structuredClone(route),first=meanderRoad(route,options);
 assert.deepEqual(first,meanderRoad(route,options));
 assert.notDeepEqual(first,meanderRoad(route,{...options,seed:'another-pair'}));
 assert.deepEqual(first[0],route[0]);assert.deepEqual(first.at(-1),route.at(-1));
 assert.ok(first.some(p=>Math.abs(p.y)>2),'the resulting street visibly bends');
 assert.ok(first.every(p=>Math.abs(p.y)<=options.amplitude));
 assert.deepEqual(route,before);
 assert.deepEqual(meanderRoad([...route].reverse(),options),[...first].reverse());
});

test('new bends are smooth and cannot reverse forward progress',()=>{
 const shaped=meanderRoad(route,options),angles=[];
 for(let i=1;i<shaped.length;i++){
  const dx=shaped[i].x-shaped[i-1].x,dy=shaped[i].y-shaped[i-1].y;
  assert.ok(dx>0);assert.ok(Math.abs(dy/dx)<.4,'a gentle local slope');
  angles.push(Math.atan2(dy,dx));
 }
 for(let i=1;i<angles.length;i++)assert.ok(Math.abs(angles[i]-angles[i-1])<.3,'no sharp new corners');
});

test('existing route corners and duplicate points remain exact',()=>{
 const base=[{x:10,y:20},{x:10,y:620},{x:10,y:620},{x:610,y:620}],shaped=meanderRoad(base,options);
 let at=-1;
 for(const vertex of base){at=shaped.findIndex((p,i)=>i>at&&p.x===vertex.x&&p.y===vertex.y);assert.ok(at>=0);}
 assert.ok(shaped.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

test('terrain validation reduces the bend until the whole road fits its corridor',()=>{
 let attempts=0;
 const safe=points=>points.every(p=>Math.abs(p.y)<=2);
 const shaped=meanderRoad(route,{...options,amplitude:60,isSafe:points=>{attempts++;return safe(points);}});
 assert.ok(attempts>1&&attempts<=5);assert.ok(safe(shaped));
 assert.ok(shaped.some(p=>p.y!==0),'a smaller safe bend is retained');
});

test('a route that cannot bend keeps its original safe path after bounded retries',()=>{
 let attempts=0;
 const shaped=meanderRoad(route,{...options,isSafe:points=>{attempts++;return points.every(p=>p.y===0);}});
 assert.equal(attempts,5);assert.deepEqual(shaped,route);assert.notEqual(shaped,route);
});

test('point growth and malformed options remain bounded for long routes',()=>{
 const long=meanderRoad([{x:-1e6,y:0},{x:1e6,y:0}],{seed:'long',amplitude:1e6,step:.001});
 assert.ok(long.length<=256);assert.ok(long.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.y)<=64));
 const oversized=Array.from({length:300},(_,i)=>({x:i,y:i%2}));
 assert.deepEqual(meanderRoad(oversized,options),oversized);
 assert.deepEqual(meanderRoad(route,{amplitude:0}),route);
 assert.deepEqual(meanderRoad([{x:Infinity,y:0},route[0]],options),[]);
 assert.deepEqual(meanderRoad(null,options),[]);
 assert.deepEqual(meanderRoad([route[0]],options),[route[0]]);
 assert.ok(meanderRoad(route,{amplitude:NaN,step:Infinity}).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
