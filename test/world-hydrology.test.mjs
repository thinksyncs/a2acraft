import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldIsland,pointInIsland} from '../public/world-island.js';
import {worldHydrology,riverBridges} from '../public/world-hydrology.js';
import {islandRouteWalkable,islandWaterObstacles} from '../public/world-island-travel.js';
import {drawWorldHydrologyOutlets} from '../public/world-hydrology-art.js';
import {staticMesh,color} from '../public/world-3d-mesh.js';

const core={left:-650,right:2180,top:-800,bottom:1662};
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const inside=(p,r)=>p.x>=r.left-1e-6&&p.x<=r.right+1e-6&&p.y>=r.top-1e-6&&p.y<=r.bottom+1e-6;

test('one shared river runs continuously from an inland source to the actual coast',()=>{
 const island=createWorldIsland({regions:[core]}),before=structuredClone(island),h=worldHydrology(island),r=h.rivers[0];
 assert.equal(h.rivers.length,1);assert.deepEqual(worldHydrology(island),h);assert.deepEqual(island,before);
 assert.ok(h.water.length>50&&h.water.length<=760);assert.equal(r.points.length,h.water.length+1);
 assert.equal(r.widths.length,r.points.length);assert.equal(r.widths[0],0,'the spring tapers to a point rather than a severed square channel');
 assert.deepEqual(r.source,r.points[0]);assert.deepEqual(h.source,r.source);assert.deepEqual(h.mouth,r.mouth);
 assert.ok(pointInIsland(h.source,island));assert.ok(pointInIsland(h.mouth,island));
 const coastDistance=Math.min(...island.coast.map((a,i)=>{
  const b=island.coast[(i+1)%island.coast.length],dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((h.mouth.x-a.x)*dx+(h.mouth.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(h.mouth.x-a.x-dx*t,h.mouth.y-a.y-dy*t);
 }));
 assert.ok(coastDistance<1e-6,'the mouth meets the coastline itself');
 let exited=false;
 for(let i=0;i<r.points.length;i++){
  const p=r.points[i],dry=pointInIsland(p,island);
  assert.ok(p&&[p.x,p.y,r.widths[i]].every(Number.isFinite));
  assert.ok(h.water.some(rect=>inside(p,rect)),'the rectangle mesh covers every centerline point');
  if(!dry)exited=true;else assert.equal(exited,false,'water never disappears into the sea and resumes on another shore');
  if(i)assert.ok(r.widths[i]>=r.widths[i-1]&&r.widths[i]-r.widths[i-1]<r.width/8,'channel width changes gradually');
 }
 assert.equal(exited,true,'the terminal cap is buried into the sea');
 assert.equal(h.water.at(-1).color,island.seaColor,'the river mouth blends into the shared sea surface');
 for(let i=1;i<h.water.length;i++)assert.ok(overlap(h.water[i-1],h.water[i]),'adjacent water rectangles overlap without dry seams');
 for(const rect of h.water.slice(0,-20))for(const x of [rect.left,rect.right])for(const y of [rect.top,rect.bottom])
  assert.ok(pointInIsland({x,y},island),'the inland channel does not leak through a bay wall');
});

test('rivers stay bounded and do not reappear across bays on translated or enormous continents',()=>{
 for(const region of [
  {...core,left:core.left+25000,right:core.right+25000,top:core.top-7000,bottom:core.bottom-7000},
  {left:-1000000,right:1000000,top:-800000,bottom:800000},
  {left:-900,right:1900,top:-900,bottom:1150},
 ]){
  const island=createWorldIsland({regions:[region]}),h=worldHydrology(island),r=h.rivers[0];
  assert.ok(r);assert.ok(h.water.length<=760);
  let sea=false;
  for(const p of r.points){if(!pointInIsland(p,island))sea=true;else assert.equal(sea,false);}
  assert.ok(sea);assert.ok(h.water.every(rect=>[rect.left,rect.right,rect.top,rect.bottom].every(Number.isFinite)));
 }
 assert.deepEqual(worldHydrology(null),{water:[],rivers:[],outlets:[],source:null,mouth:null,bankWidth:10});
});

test('the shared outlet opens a nonzero channel through both sides of the coast and its outside sand rim',()=>{
 const island=createWorldIsland({regions:[core]}),h=worldHydrology(island),outlet=h.outlets[0];
 assert.ok(outlet);assert.deepEqual(outlet.mouth,h.mouth);assert.ok(outlet.water.length);
 const {mouth,normal,width}=outlet,tangent={x:-normal.y,y:normal.x};
 for(const along of [-20,-5,0,5,20,(island.shoreWidth||18)/2+5])for(const across of [-width*.3,0,width*.3]){
  const point={x:mouth.x+normal.x*along+tangent.x*across,y:mouth.y+normal.y*along+tangent.y*across};
  assert.ok(outlet.water.some(rect=>inside(point,rect)),'a wide channel covers the sand stroke rather than touching the sea at a point');
  if(along>0)assert.equal(pointInIsland(point,island),false,'the shared outlet surface reaches the sea outside the land clip');
 }
 assert.ok(outlet.normal.x>0||outlet.normal.y>0,'the mouth points downstream instead of turning back toward its northern source');
 assert.ok([outlet.bounds.left,outlet.bounds.right,outlet.bounds.top,outlet.bounds.bottom].every(Number.isFinite));
});

test('2D and 3D paint the identical outlet across the shore without a competing sea or beach surface',()=>{
 const island=createWorldIsland({regions:[core]}),h=worldHydrology(island),outlet=h.outlets[0],fills=[];
 const ctx={fillStyle:'',fillRect(...values){fills.push({color:this.fillStyle,values});}};
 drawWorldHydrologyOutlets(ctx,h);
 assert.deepEqual(fills,outlet.water.map(rect=>({color:rect.color,values:[rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top]})));
 const mesh=staticMesh({island,bounds:island.seaBounds,hydrology:h,water:h.water,roads:[],buildings:[],scenery:[]});
 const contains=(p,a,b,c)=>{
  const side=(u,v)=>(v.x-u.x)*(p.y-u.y)-(v.y-u.y)*(p.x-u.x),s=[side(a,b),side(b,c),side(c,a)];
  return s.every(v=>v>=-1e-4)||s.every(v=>v<=1e-4);
 };
 const n=outlet.normal,tangent={x:-n.y,y:n.x},sea=color(island.seaColor);
 for(const along of [-15,15,30])for(const across of [-outlet.width*.2,0,outlet.width*.2]){
  const p={x:outlet.mouth.x+n.x*along+tangent.x*across,y:outlet.mouth.y+n.y*along+tangent.y*across};
  let wet=0,dry=0;
  for(let at=0;at<mesh.length;at+=27){
   const vertices=[0,9,18].map(offset=>({x:mesh[at+offset],y:mesh[at+offset+2],height:mesh[at+offset+1]}));
   if(!contains(p,...vertices))continue;
   if(vertices.every(v=>Math.abs(v.height-.12)<1e-4))wet++;
   if(vertices.every(v=>v.height<.1))dry++;
  }
  assert.ok(wet>0,'the shared water footprint remains visible across the coast');
  assert.equal(dry,0,'sea, sand and grass are cut away under the outlet');
 }
 assert.ok(mesh.length>0&&sea.every(Number.isFinite));
 const offscreen=[];
 drawWorldHydrologyOutlets({fillRect:()=>offscreen.push(1)},h,{left:100000,right:100100,top:100000,bottom:100100});
 assert.deepEqual(offscreen,[]);
});

test('fixed world facilities are protected before new towns are planned around the water',()=>{
 const island=createWorldIsland({regions:[core]}),initial=worldHydrology(island),p=initial.rivers[0].points[250];
 const obstacles=[{left:p.x-100,right:p.x+100,top:p.y-90,bottom:p.y+90},
  {left:415,right:585,top:-740,bottom:-550},{left:-500,right:-340,top:240,bottom:355}];
 const before=structuredClone(obstacles),h=worldHydrology(island,{obstacles});
 assert.equal(h.rivers.length,1);assert.ok(h.water.every(rect=>obstacles.every(obstacle=>!overlap(rect,obstacle))));
 assert.deepEqual(obstacles,before);
 assert.deepEqual(worldHydrology(island,{roads:[{width:30,points:[{x:-500,y:200},{x:2400,y:200}]}]}),initial,
  'streets adapt to the river instead of generating their own geography');
});

test('road crossings produce shared horizontal and vertical bridge decks, leaving the rest of the river blocked',()=>{
 const island={gridSize:50,bounds:{left:0,right:800,top:0,bottom:800},
  coast:[{x:0,y:0},{x:800,y:0},{x:800,y:800},{x:0,y:800}],
  landPatches:[{left:0,right:800,top:0,bottom:800}]};
 for(const horizontal of [true,false]){
  const points=horizontal?[{x:400,y:0},{x:400,y:800}]:[{x:0,y:400},{x:800,y:400}];
  const water=horizontal?[{left:360,right:440,top:0,bottom:800}]:[{left:0,right:800,top:360,bottom:440}];
  const h={water,bankWidth:10,rivers:[{id:'main',points,width:80,widths:[80,80]}]};
  const road={width:30,points:horizontal?[{x:100,y:400},{x:700,y:400}]:[{x:400,y:100},{x:400,y:700}]};
  const before=structuredClone({h,road}),bridges=riverBridges(h,[road]),bridge=bridges[0];
  assert.equal(bridges.length,1);assert.equal(bridge.orientation,horizontal?'horizontal':'vertical');
  assert.ok([bridge.x,bridge.y,bridge.w,bridge.h].every(Number.isFinite));
  assert.equal(islandRouteWalkable(road.points,island,{water}),false);
  assert.equal(islandRouteWalkable(road.points,island,{water,bridges}),true,'the rendered deck and walking opening agree');
  assert.ok(islandWaterObstacles(water,bridges).length>0,'a bridge does not erase the entire river obstacle');
  assert.deepEqual({h,road},before);
  const parallel={width:30,points};assert.deepEqual(riverBridges(h,[parallel]),[]);
 }
 assert.deepEqual(riverBridges(null,[]),[]);
});

test('bridge decks span the rendered bank union and preserve nearby independent crossings',()=>{
 const island={gridSize:50,bounds:{left:0,right:800,top:0,bottom:800},
  coast:[{x:0,y:0},{x:800,y:0},{x:800,y:800},{x:0,y:800}],
  landPatches:[{left:0,right:800,top:0,bottom:800}]};
 const h={bankWidth:10,water:[{left:340,right:460,top:0,bottom:450},
  {left:355,right:510,top:350,bottom:800}],rivers:[{id:'main',width:80,
   points:[{x:400,y:0},{x:400,y:400},{x:445,y:800}],widths:[80,80,80]}]};
 const roads=[400,450].map(y=>({width:30,points:[{x:100,y},{x:700,y}]}));
 const bridges=riverBridges(h,roads);
 assert.equal(bridges.length,2,'separate streets cannot share a bridge just because their crossings are nearby');
 for(const road of roads){
  assert.ok(islandRouteWalkable(road.points,island,{water:h.water,bridges}),
   'the whole actual water union is covered, not merely the nominal centerline width');
  for(const offset of [-road.width/2,road.width/2])assert.ok(islandRouteWalkable(
   road.points.map(p=>({...p,y:p.y+offset})),island,{water:h.water,bridges}),'both road edges reach dry banks');
 }
});
