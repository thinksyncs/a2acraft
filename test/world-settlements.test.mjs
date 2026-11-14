import test from 'node:test';
import assert from 'node:assert/strict';
import {planWorldSettlements} from '../public/world-settlements.js';
import {pointInIsland} from '../public/world-island.js';
import {islandSegmentOnLand} from '../public/world-island-travel.js';

const rectangleIsland=(bounds={left:-1500,right:5000,top:-1800,bottom:4000})=>({bounds,gridSize:100,
 landPatches:[bounds],coast:[{x:bounds.left,y:bounds.top},{x:bounds.right,y:bounds.top},
  {x:bounds.right,y:bounds.bottom},{x:bounds.left,y:bounds.bottom}]});
const buildings=()=>[{id:'repo',repoId:'repo',name:'成果',stage:'building',x:240,y:220},
 {id:'feature',repoId:'repo',jobId:'task',name:'機能',stage:'finished',x:715,y:480}];
const districts=()=>[{id:'alpha',place:{x:0,y:0},buildings:buildings(),population:29},
 {id:'beta',place:{x:1180,y:0},buildings:buildings(),population:29}];
const water=[{left:800,right:920,top:-1800,bottom:4000,color:'#599ba0'}];
const crossing=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const options=()=>({districts:districts(),island:rectangleIsland(),hydrology:{water}});
const area=r=>(r.right-r.left)*(r.bottom-r.top);
const fits=(rect,island)=>[{x:rect.left,y:rect.top},{x:rect.right,y:rect.top},
 {x:rect.right,y:rect.bottom},{x:rect.left,y:rect.bottom}].every(point=>pointInIsland(point,island));

test('terrain planning retains every work identity and anchor while placing dry, non-overlapping sites',()=>{
 const input=options(),before=structuredClone(input),result=planWorldSettlements(input);
 assert.deepEqual(input,before,'display planning never edits projects, statuses or saved district anchors');
 assert.equal(result.settlements.length,2);
 const occupied=[];
 for(const plan of result.settlements){
  const source=input.districts.find(d=>d.id===plan.id);
  assert.deepEqual(plan.place,source.place);
  assert.deepEqual(plan.buildings.map(({x,y,...rest})=>rest),[...source.buildings].sort((a,b)=>a.id.localeCompare(b.id)).map(({x,y,...rest})=>rest));
  for(const plot of plan.plots){
   assert.ok(fits(plot,input.island));
   assert.ok(!water.some(r=>crossing(plot,r)),'water determines the available plot sites');
   assert.ok(!occupied.some(r=>crossing(plot,r)),'sites do not stack on top of other buildings');occupied.push(plot);
  }
 }
});

test('moving the river changes the town footprint rather than copying a fixed village stamp',()=>{
 const base=options(),left=planWorldSettlements(base),right=planWorldSettlements({...base,
  hydrology:{water:[{left:200,right:340,top:-1800,bottom:4000}]}});
 assert.notDeepEqual(left.settlements[0].buildings.map(b=>[b.x,b.y]),right.settlements[0].buildings.map(b=>[b.x,b.y]));
 assert.notDeepEqual(left.settlements[0].roads.map(r=>r.points),right.settlements[0].roads.map(r=>r.points));
 assert.ok(left.settlements.every(plan=>plan.roads.length<15),'only actual streets and access paths are created');
 const normalized=left.settlements.map(plan=>plan.roads.map(road=>road.points.map(p=>[p.x-plan.place.x,p.y-plan.place.y])));
 assert.notDeepEqual(normalized[0],normalized[1],'different terrain and work sites produce different street networks');
});

test('the natural town clearing has a shared dry, non-overlapping footprint instead of a painted rectangle',()=>{
 const input=options(),result=planWorldSettlements(input),patches=result.clearings.flatMap(c=>c.patches);
 assert.ok(patches.length>10);
 for(let i=0;i<patches.length;i++){
  assert.ok(fits(patches[i],input.island));
  assert.ok(!water.some(r=>crossing(patches[i],r)));
  for(let j=0;j<i;j++)assert.ok(!crossing(patches[i],patches[j]),'one shared ground footprint owns each piece of town');
 }
 for(const clearing of result.clearings){
  const bounds={left:Math.min(...clearing.patches.map(p=>p.left)),right:Math.max(...clearing.patches.map(p=>p.right)),
   top:Math.min(...clearing.patches.map(p=>p.top)),bottom:Math.max(...clearing.patches.map(p=>p.bottom))};
  assert.ok(clearing.patches.reduce((sum,p)=>sum+area(p),0)<area(bounds)*.8,'clearings follow small settlement clusters, not the district box');
 }
});

test('streets join the existing district entrance to each building door, with bridge-compatible water crossings',()=>{
 const input=options(),result=planWorldSettlements(input);
 for(const plan of result.settlements){
  const joined=[plan.entrance];
  for(const road of plan.roads){
   assert.ok(joined.some(p=>Math.hypot(p.x-road.points[0].x,p.y-road.points[0].y)<.001),'each street joins the existing town network');
   joined.push(road.points.at(-1));
   for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i];assert.ok(islandSegmentOnLand(a,b,input.island));
    const span={left:Math.min(a.x,b.x),right:Math.max(a.x,b.x),top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)};
    if(water.some(r=>crossing(span,r)))assert.ok(Math.abs(a.x-b.x)<.001||Math.abs(a.y-b.y)<.001,'river crossings have an actual straight bridge axis');
   }
  }
  for(const building of plan.buildings)assert.ok(joined.some(p=>Math.hypot(p.x-plan.place.x-building.x,p.y-plan.place.y-building.y-40)<.001));
 }
});

test('the layout is deterministic and independent of district and work registration order',()=>{
 const input=options(),first=planWorldSettlements(input);
 const reversed={...input,districts:[...input.districts].reverse().map(d=>({...d,buildings:[...d.buildings].reverse()}))};
 assert.deepEqual(planWorldSettlements(reversed),first);
});

test('coastal and flooded anchors move display sites onto adjoining land without losing work',()=>{
 const island=rectangleIsland({left:0,right:3200,top:0,bottom:2000}),district={id:'flooded',place:{x:0,y:0},buildings:buildings(),population:0};
 const water=[{left:0,right:1250,top:0,bottom:2000}],result=planWorldSettlements({districts:[district],island,hydrology:{water}});
 assert.equal(result.settlements[0].buildings.length,district.buildings.length);
 for(const plot of result.settlements[0].plots){assert.ok(fits(plot,island));assert.ok(!water.some(r=>crossing(plot,r)));}
});

test('sparse worlds keep one bounded local plan per district and avoid preserved arterial roads',()=>{
 const districts=Array.from({length:30},(_,i)=>({id:'district-'+String(i).padStart(2,'0'),place:{x:(i%10)*1800,y:Math.floor(i/10)*1300},
  buildings:buildings(),population:8}));
 const island=rectangleIsland({left:-1000,right:20000,top:-1000,bottom:6000});
 const connectingRoads=districts.map(d=>({width:28,points:[{x:d.place.x+100,y:d.place.y+610},{x:d.place.x+1000,y:d.place.y+610}]}));
 const result=planWorldSettlements({districts,island,connectingRoads});
 assert.equal(result.settlements.length,30);assert.equal(result.settlements.reduce((n,p)=>n+p.buildings.length,0),60);
 assert.ok(result.clearings.flatMap(c=>c.patches).length<3000);
 for(const plan of result.settlements)for(const plot of plan.plots)assert.ok(!crossing(plot,{left:plan.place.x+100,right:plan.place.x+1000,
  top:plan.place.y+596,bottom:plan.place.y+624}),'new sites do not block existing arterial streets');
});

test('settlements reserve existing facility sites and separate overlapping saved district plazas',()=>{
 const island=rectangleIsland(),districts=[...['alpha','beta'].map(id=>({id,place:{x:0,y:0},
  buildings:buildings(),population:12}))],obstacles=[{left:400,right:640,top:230,bottom:430}];
 const result=planWorldSettlements({districts,island,obstacles}),plots=result.settlements.flatMap(p=>p.plots);
 for(const [index,plot] of plots.entries()){
  assert.ok(!obstacles.some(facility=>crossing(plot,facility)),'fixed castles, taverns and their doors retain their sites');
  assert.ok(!plots.slice(0,index).some(other=>crossing(plot,other)),'even plaza placement considers earlier settlements');
 }
 for(const plan of result.settlements){
  assert.equal(plan.buildings.length,2);assert.ok(plan.roads.length>0);
  for(const road of plan.roads)for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i];
   for(let n=0;n<=100;n++)assert.ok(!obstacles.some(r=>{
    const x=a.x+(b.x-a.x)*n/100,y=a.y+(b.y-a.y)*n/100;
    return x>r.left&&x<r.right&&y>r.top&&y<r.bottom;
   }),'new streets route around existing facilities');
  }
 }
});
