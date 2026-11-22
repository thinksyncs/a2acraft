import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDemo,projectDemoJourneys} from '../public/project-demo.js';
import {placeDistricts,visibleWorldRoads} from '../public/world-geography.js';
import {projectSceneGeometry} from '../public/project-scene.js';
import {facilityArrival,repairProjectPose} from '../public/project-world.js';
import {facilities,sceneBuildingObstacles} from '../public/project-buildings.js';
import {islandRouteWalkable} from '../public/world-island-travel.js';
import {groundRanges,tileInView,distantTile,createWorld3D} from '../public/world-3d.js';
import {staticMesh,naturalTiles,naturalTileMesh} from '../public/world-3d-mesh.js';
import {lookAt,multiply,perspective} from '../public/world-3d-math.js';

const demo=projectDemo(),projects=demo.projects.items,layout=placeDistricts(projects,demo.chats);
const geometry=projectSceneGeometry(layout,projects,demo.chats.map(c=>({projectId:c.project.id})),
  visibleWorldRoads(layout,projectDemoJourneys(projects,demo.chats,layout)));

test('legacy room exits lead onto a dry street facing the building with room to walk and see',()=>{
  const terrain={...geometry,obstacles:sceneBuildingObstacles(geometry)};
  for(const facility of facilities){
    const old={x:facility.x,y:facility.y+30},pose=repairProjectPose(old,geometry);
    assert.deepEqual(pose.point,facilityArrival(facility));
    const dx=Math.sin(pose.heading),dy=-Math.cos(pose.heading);
    assert.ok(islandRouteWalkable([pose.point,{x:pose.point.x+dx*48,y:pose.point.y+dy*48}],geometry.island,terrain));
    assert.equal(repairProjectPose(pose.point,geometry),null);
    assert.ok(repairProjectPose({x:facility.x,y:facility.y-30},geometry),'inside the wall can reach a lane');
  }
  assert.equal(repairProjectPose({x:500,y:610},geometry),null);
});

test('the sample Forge view draws a fraction of the island and keeps nearby models identical',()=>{
  const pose=repairProjectPose({x:-420,y:-210},geometry),eye=[pose.point.x,20,pose.point.y],fov=Math.PI/3;
  const target=[eye[0]+Math.sin(pose.heading),20,eye[2]-Math.cos(pose.heading)];
  const matrix=multiply(perspective(fov,539/404,.7,75000),lookAt(eye,target));
  const base=staticMesh(geometry,{separateNature:true}),parts=groundRanges(base);
  assert.equal(parts.reduce((sum,p)=>sum+p.count,0),base.length/9);
  const visible=parts.filter(p=>tileInView(p,matrix));
  let drawn=visible.reduce((sum,p)=>sum+p.count,0);
  const tiles=naturalTiles(geometry);
  for(const tile of tiles.filter(p=>tileInView(p,matrix)))drawn+=naturalTileMesh(tile,distantTile(tile,eye,404,fov)).length/9;
  const total=staticMesh(geometry).length/9;
  assert.ok(drawn>0&&drawn<total*.45);
  const empty={bounds:geometry.bounds,roads:[],scenery:[],buildings:[]};
  const tile=tiles.find(t=>t.items.some(p=>p.kind==='woodland'));
  const groundOnly=staticMesh(empty);
  assert.deepEqual(naturalTileMesh(tile),staticMesh({...empty,scenery:tile.items}).slice(groundOnly.length));
  assert.ok(naturalTileMesh(tile,true).length<naturalTileMesh(tile).length);
});

test('a reversible WebGL context loss restores the visible leader inset and the latest scene',()=>{
  const listeners=new Map(),states=[],errors=[],frames=new Set(),uploads=[];
  const raf=globalThis.requestAnimationFrame,caf=globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame=fn=>{frames.add(fn);return fn;};
  globalThis.cancelAnimationFrame=fn=>frames.delete(fn);
  const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,
    createBuffer:()=>({}),bufferData:(_kind,data)=>uploads.push(data.byteLength)},
    {get:(target,key)=>key in target?target[key]:typeof key==='string'&&key===key.toUpperCase()?1:()=>({})});
  const canvas={dataset:{},tabIndex:0,clientWidth:180,clientHeight:120,getContext:()=>gl,
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  let renderer;
  try{
    renderer=createWorld3D({canvas,onContextChange:v=>states.push(v),onFailure:e=>errors.push(e)});
    renderer.setMode('leader');renderer.update({scenery:[],buildings:[],roads:[]});renderer.setVisible(true);
    let prevented=false;listeners.get('webglcontextlost')({preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(renderer.supported,false);assert.equal(frames.size,0);
    renderer.update({scenery:[],buildings:[{kind:'house',x:20,y:30}],roads:[]});
    listeners.get('webglcontextrestored')();
    assert.equal(renderer.supported,true);assert.deepEqual(states,[false,true]);
    assert.ok(frames.size);assert.ok(uploads.at(-1)>uploads[0]);assert.equal(errors.length,0);
  }finally{
    renderer?.destroy();
    if(raf===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=raf;
    if(caf===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=caf;
  }
});
