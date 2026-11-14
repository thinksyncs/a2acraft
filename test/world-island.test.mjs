import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldIsland,pointInIsland} from '../public/world-island.js';
import {staticMesh,color} from '../public/world-3d-mesh.js';
import {projectSceneGeometry} from '../public/project-scene.js';

const corners=rect=>[{x:rect.left,y:rect.top},{x:rect.right,y:rect.top},
  {x:rect.right,y:rect.bottom},{x:rect.left,y:rect.bottom}];
const region={left:0,right:1000,top:0,bottom:640};
const fixtures=()=>({regions:[region,{left:3200,right:4200,top:1800,bottom:2440}],
  roads:[{width:25,points:[{x:500,y:610},{x:500,y:1200},{x:3700,y:1200},{x:3700,y:2410}]},
    {width:25,points:[{x:500,y:610},{x:-4100,y:2200},{x:-4100,y:4000}]}],
  buildings:[{x:500,y:-620,width:140,depth:90},{x:-420,y:340,width:140,depth:90}]});

test('one coastline encloses districts, facilities and every saved travel segment without moving them',()=>{
  const input=fixtures(),before=structuredClone(input),island=createWorldIsland(input);
  for(const rect of input.regions)for(const point of corners(rect))assert.ok(pointInIsland(point,island));
  for(const road of input.roads)for(let i=1;i<road.points.length;i++)for(let step=0;step<=20;step++){
    const a=road.points[i-1],b=road.points[i],t=step/20;
    assert.ok(pointInIsland({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},island));
  }
  for(const b of input.buildings)for(const point of corners({left:b.x-b.width/2,right:b.x+b.width/2,
    top:b.y-b.depth/2,bottom:b.y+b.depth/2}))assert.ok(pointInIsland(point,island));
  assert.deepEqual(input,before,'projection cannot rewrite saved navigation data');
  for(const rect of input.regions)for(const point of corners(rect))for(const dx of [-9,9])for(const dy of [-9,9])
    assert.ok(pointInIsland({x:point.x+dx,y:point.y+dy},island),'beach leaves protected work on grass');
});

test('the island is deterministic, stepped and surrounded by sea independent of input order',()=>{
  const input=fixtures(),island=createWorldIsland(input);
  assert.deepEqual(island,createWorldIsland({...input,regions:[...input.regions].reverse(),
    roads:[...input.roads].reverse().map(road=>({...road,points:[...road.points].reverse()})),buildings:[...input.buildings].reverse()}));
  assert.ok(island.coast.length>8,'coast must not be the old rectangular map edge');
  assert.ok(island.seaBounds.left<island.bounds.left&&island.seaBounds.right>island.bounds.right);
  assert.ok(island.seaBounds.top<island.bounds.top&&island.seaBounds.bottom>island.bounds.bottom);
  for(const point of corners(island.seaBounds))assert.equal(pointInIsland(point,island),false);
  assert.equal(pointInIsland({x:NaN,y:0},island),false);
});

test('a protected rectangular world gains tiled capes and inlets without moving its contents',()=>{
  const bounds={left:-700,right:2100,top:-400,bottom:1700},island=createWorldIsland({regions:[bounds]});
  assert.ok(island.coast.length>24,'the coastline must have more than four rounded corners');
  assert.ok(island.bounds.right-island.bounds.left>=(bounds.right-bounds.left)*3);
  assert.ok(island.bounds.bottom-island.bounds.top>=(bounds.bottom-bounds.top)*3);
  for(const point of corners(bounds))assert.ok(pointInIsland(point,island),'the saved world remains fully protected');
  let inlets=0;
  for(let i=0;i<island.coast.length;i++){
    const a=island.coast[i],b=island.coast[(i+1)%island.coast.length],c=island.coast[(i+2)%island.coast.length];
    assert.ok(a.x===b.x||a.y===b.y,'every edge follows the shared tile grid');
    assert.ok(Number.isInteger(a.x/island.gridSize)&&Number.isInteger(a.y/island.gridSize));
    if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<0)inlets++;
  }
  assert.ok(inlets>=4,'real concave inlets must replace the former convex hull');
});

test('work occupies a small part of a physically larger world with broad sea-connected bays',()=>{
  const island=createWorldIsland({regions:[region]}),bounds=island.bounds;
  const width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;
  assert.ok(width>=14000&&height>=11000,'zooming cannot substitute for a large world extent');
  assert.ok((region.right-region.left)*(region.bottom-region.top)<width*height*.01,
    'the first work settlement must not fill its surrounding world');
  const step=island.gridSize,rows=[];
  for(let y=bounds.top+step/2;y<bounds.bottom;y+=step){
    const intervals=[];let start=null;
    for(let x=bounds.left+step/2;x<=bounds.right+step/2;x+=step){
      const land=x<bounds.right&&pointInIsland({x,y},island);
      if(land&&start===null)start=x;
      if(!land&&start!==null){intervals.push([start,x]);start=null;}
    }
    rows.push(intervals);
  }
  assert.ok(rows.some(intervals=>intervals.length>=2&&intervals.some((interval,i)=>i&&interval[0]-intervals[i-1][1]>width*.18)),
    'a broad bay must separate large peninsulas rather than adding one-cell edge noise');
  assert.ok(island.coast.length>100,'the wider world retains detailed tile shores');
});

test('sparse large worlds retain finite bounded-complexity coastline geometry',()=>{
  const regions=Array.from({length:100},(_,index)=>({left:index*500000,right:index*500000+1000,
    top:(index%7)*900000,bottom:(index%7)*900000+640}));
  const island=createWorldIsland({regions});
  assert.ok(island.coast.length<1600&&island.landPatches.length<768,'cost is bounded by the coarse grid, not the intervening empty area');
  assert.ok(island.coast.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
  for(const rect of regions)for(const point of corners(rect))assert.ok(pointInIsland(point,island));
  const fallback=createWorldIsland({regions:[{left:NaN,right:Infinity,top:0,bottom:5}]});
  assert.ok(fallback.coast.length>3&&pointInIsland({x:500,y:320},fallback));
});

const closeColor=(actual,expected)=>actual.every((value,i)=>Math.abs(value-expected[i])<1e-6);
const triangles = mesh => Array.from({length:mesh.length/27},(_,index)=>{
  const start=index*27;
  return {points:[0,9,18].map(offset=>({x:mesh[start+offset],height:mesh[start+offset+1],y:mesh[start+offset+2]})),
    normal:[mesh[start+3],mesh[start+4],mesh[start+5]],color:[mesh[start+6],mesh[start+7],mesh[start+8]]};
});
const triangleContains=(p,t)=>{
  const edges=t.points.map((a,i)=>{const b=t.points[(i+1)%3];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);});
  return edges.every(c=>c>=-1e-5)||edges.every(c=>c<=1e-5);
};

test('3D uses the shared coastline and ocean while cutting rivers out of dry ground',()=>{
  const island=createWorldIsland({regions:[region]}),water={left:400,right:480,top:0,bottom:640};
  const mesh=staticMesh({island,bounds:island.seaBounds,roads:[],water:[water],buildings:[],scenery:[]});
  assert.ok(mesh.every(Number.isFinite));
  const all=triangles(mesh),grass=all.filter(t=>closeColor(t.color,color(island.landColor))),
    sea=all.filter(t=>closeColor(t.color,color(island.seaColor)));
  assert.ok(sea.length>2,'the upward ocean is split around land instead of continuing underneath it');
  assert.ok(grass.length>2);
  assert.ok([...grass,...sea].every(t=>t.normal[1]>.999),'every horizontal surface faces upward');
  for(const triangle of sea){
    const center={x:triangle.points.reduce((sum,p)=>sum+p.x,0)/3,y:triangle.points.reduce((sum,p)=>sum+p.y,0)/3};
    assert.equal(pointInIsland(center,island),false,'no ocean surface competes with the ground above it');
  }
  for(const triangle of grass)for(const point of triangle.points)
    assert.ok(pointInIsland(point,island),'no rectangular grass continues into the sea');
  for(const point of [{x:440,y:100},{x:440,y:400}])
    assert.ok(!grass.some(triangle=>triangleContains(point,triangle)),'river must not have coplanar grass');
  assert.ok(grass.some(triangle=>triangleContains({x:200,y:300},triangle)));
  assert.ok(!grass.some(triangle=>triangleContains({x:island.seaBounds.left+5,y:200},triangle)));
});

test('3D ocean, beach, grass, geographic ground and river partition their footprints without hidden layers',()=>{
  const island={bounds:region,seaBounds:{left:-100,right:1100,top:-100,bottom:740},
    landPatches:[region],coast:corners(region),shoreWidth:18,
    seaColor:'#315e75',sandColor:'#c7bb83',landColor:'#78924f'};
  const water={left:400,right:480,top:-100,bottom:740,color:'#599ba0'};
  const biomes={ground:[
    {x:100,y:200,width:400,depth:400,color:'#456f45'},
    {x:0,y:0,width:200,depth:150,color:'#456f45'},
  ],scenery:[]};
  const mesh=staticMesh({island,bounds:island.seaBounds,water:[water],biomes,roads:[],buildings:[],scenery:[]});
  const surfaces=[];
  // Each horizontal rectangle consists of exactly two triangles.
  for(let i=0;i<mesh.length;i+=54){
    const vertices=[0,9,18,27,36,45].map(offset=>({x:mesh[i+offset],y:mesh[i+offset+2]}));
    surfaces.push({left:Math.min(...vertices.map(p=>p.x)),right:Math.max(...vertices.map(p=>p.x)),
      top:Math.min(...vertices.map(p=>p.y)),bottom:Math.max(...vertices.map(p=>p.y)),
      color:[mesh[i+6],mesh[i+7],mesh[i+8]]});
    for(const offset of [0,9,18,27,36,45])assert.ok(mesh[i+offset+4]>.999,'ground faces upward');
  }
  const area=rect=>(rect.right-rect.left)*(rect.bottom-rect.top);
  for(let i=0;i<surfaces.length;i++)for(let j=i+1;j<surfaces.length;j++){
    const a=surfaces[i],b=surfaces[j];
    assert.ok(Math.min(a.right,b.right)<=Math.max(a.left,b.left)||
      Math.min(a.bottom,b.bottom)<=Math.max(a.top,b.top),'no two ground surfaces share an interior footprint');
  }
  const coloredArea=shade=>surfaces.filter(p=>closeColor(p.color,color(shade))).reduce((sum,p)=>sum+area(p),0);
  assert.equal(coloredArea(water.color),80*640,'river meets the beach without sand below it');
  assert.equal(coloredArea('#456f45'),400*400-80*400+191*141,
    'geographic ground is clipped at both the river and the nine-unit beach');
  assert.equal(coloredArea(island.sandColor),1000*640-982*622-80*18,'sand only occupies the visible shoreline');
  const landArea=surfaces.filter(p=>!closeColor(p.color,color(island.seaColor))).reduce((sum,p)=>sum+area(p),0);
  assert.equal(landArea,1000*640,'partitioning leaves no inland gaps');
  const seaBounds={left:Math.min(...surfaces.map(p=>p.left)),right:Math.max(...surfaces.map(p=>p.right)),
    top:Math.min(...surfaces.map(p=>p.top)),bottom:Math.max(...surfaces.map(p=>p.bottom))};
  assert.equal(coloredArea(island.seaColor),area(seaBounds)-landArea,'the ocean ends at the coast instead of extending under land');
});

test('the 3D land patches and general 2D coastline cover exactly the same tiled island without overlaps',()=>{
  const island=createWorldIsland({regions:[region]}),step=island.gridSize;
  for(let y=island.bounds.top-step/2;y<=island.bounds.bottom+step/2;y+=step)
    for(let x=island.bounds.left-step/2;x<=island.bounds.right+step/2;x+=step)
      assert.equal(pointInIsland({x,y},island),pointInIsland({x,y},{coast:island.coast}),JSON.stringify({x,y}));
  for(let i=0;i<island.landPatches.length;i++)for(let j=i+1;j<island.landPatches.length;j++){
    const a=island.landPatches[i],b=island.landPatches[j];
    assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'no coplanar patch interiors overlap');
  }
});

test('a river mouth clips to the same coastline rather than projecting a rectangle into the ocean',()=>{
  const island=createWorldIsland({regions:[region]}),water={left:800,right:900,
    top:island.seaBounds.top,bottom:island.seaBounds.bottom,color:'#457e9c'};
  const mesh=staticMesh({island,bounds:island.seaBounds,roads:[],water:[water],buildings:[],scenery:[]});
  const river=triangles(mesh).filter(t=>closeColor(t.color,color(water.color)));
  assert.ok(river.length>=2);
  const points=river.flatMap(t=>t.points);
  assert.ok(Math.min(...points.map(p=>p.y))>water.top+1);
  assert.ok(Math.max(...points.map(p=>p.y))<water.bottom-1);
  for(const point of points)assert.ok(pointInIsland(point,island),JSON.stringify(point));
});

test('3D grass, beach and river surfaces do not fill a concave ocean inlet',()=>{
  const island=createWorldIsland({regions:[region]}),step=island.gridSize;
  let inlet;
  for(let i=0;i<island.coast.length;i++){
    const a=island.coast[i],b=island.coast[(i+1)%island.coast.length],c=island.coast[(i+2)%island.coast.length];
    const ab={x:Math.sign(b.x-a.x),y:Math.sign(b.y-a.y)},bc={x:Math.sign(c.x-b.x),y:Math.sign(c.y-b.y)};
    if(ab.x*bc.y-ab.y*bc.x<0){
      const point={x:b.x+(-ab.x+bc.x)*step/4,y:b.y+(-ab.y+bc.y)*step/4};
      if(!pointInIsland(point,island)){inlet=point;break;}
    }
  }
  assert.ok(inlet,'fixture must contain a true inlet');
  const scene={island,bounds:island.seaBounds,roads:[],buildings:[],scenery:[],
    water:[{left:inlet.x-step,right:inlet.x+step,top:island.bounds.top,bottom:island.bounds.bottom}]};
  const surfaces=triangles(staticMesh(scene)).filter(t=>!closeColor(t.color,color(island.seaColor)));
  assert.ok(surfaces.length>0);
  assert.ok(!surfaces.some(triangle=>triangleContains(inlet,triangle)),'a concave bay must stay ocean in 3D, including its beach and river mouth');
});

test('project overview and 3D share one sea-framed island around the same roads and districts',()=>{
  const place={x:1200,y:900},project={id:'p',repositories:[{id:'r',name:'Repo'}],jobs:[]};
  const roads=[{points:[{x:-7200,y:-3200},{x:1700,y:1510}]}],before=structuredClone({place,roads});
  const scene=projectSceneGeometry({p:place},[project],[],roads);
  assert.deepEqual(scene.bounds,scene.island.seaBounds);
  assert.ok(pointInIsland({x:place.x,y:place.y},scene.island));
  for(const route of scene.roads)for(const point of route.points)assert.ok(pointInIsland(point,scene.island));
  for(const building of scene.buildings)assert.ok(pointInIsland(building,scene.island));
  assert.deepEqual({place,roads},before);
});
