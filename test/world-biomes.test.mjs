import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldIsland,pointInIsland} from '../public/world-island.js';
import {worldBiomes,biomeLandmarks,BIOME_COLORS} from '../public/world-biomes.js';
import {drawWorldBiomes,drawDevelopmentLandscape,drawVillageIslandBackground} from '../public/village-art.js';
import {staticMesh,color} from '../public/world-3d-mesh.js';
import {sceneryObjectMesh} from '../public/world-scenery-model.js';
import {projectedModelFaces} from '../public/world-map-models.js';

const core={left:-500,right:1000,top:-300,bottom:800};
const options={regions:[core],roads:[{width:35,points:[{x:-4500,y:-1000},{x:4800,y:1600}]}],
  facilities:[{x:2400,y:1900,width:180,depth:160}],water:[{left:2800,right:2920,top:-6000,bottom:6000}]};
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const rectangle=item=>({left:item.x,right:item.x+item.width,top:item.y,bottom:item.y+item.depth});

test('a wide world has repeatable forests, mountain ranges and open moor patches',()=>{
  const island=createWorldIsland(options),one=worldBiomes(island,options),two=worldBiomes(island,options);
  assert.deepEqual(one,two);
  assert.ok(one.scenery.some(item=>item.kind==='woodland'));
  assert.ok(one.scenery.some(item=>item.kind==='mountain-range'));
  assert.ok(one.ground.some(item=>item.kind==='moor'));
  assert.ok(one.ground.length>20,'land outside the work area has readable geographic regions');
  assert.ok(one.scenery.length<2500&&one.ground.length<2500);
  assert.equal(new Set(one.scenery.map(item=>item.id)).size,one.scenery.length);
});

test('natural geography stays on land and leaves work, facilities, roads and rivers clear',()=>{
  const island=createWorldIsland(options),biomes=worldBiomes(island,options);
  const facility={left:2310,right:2490,top:1820,bottom:1980};
  for(const item of [...biomes.ground,...biomes.scenery]){
    const rect=rectangle(item);
    assert.equal(overlap(rect,core),false);assert.equal(overlap(rect,facility),false);
    assert.ok(!options.water.some(river=>overlap(rect,river)));
    for(const x of [rect.left,(rect.left+rect.right)/2,rect.right])
      for(const y of [rect.top,(rect.top+rect.bottom)/2,rect.bottom])assert.ok(pointInIsland({x,y},island));
    const [a,b]=options.roads[0].points;
    for(let n=0;n<=200;n++){
      const p={x:a.x+(b.x-a.x)*n/200,y:a.y+(b.y-a.y)*n/200};
      assert.ok(!(p.x>rect.left&&p.x<rect.right&&p.y>rect.top&&p.y<rect.bottom),'landmarks do not cover the walking route');
    }
  }
});

test('enormous saved worlds keep natural scenery bounded instead of filling every small world cell',()=>{
  const island=createWorldIsland({regions:[core,{left:1000000,right:1001000,top:800000,bottom:800640}]});
  const biomes=worldBiomes(island);
  assert.ok(biomes.step>10000);
  assert.ok(biomes.scenery.length<2500&&biomes.ground.length<2500);
  assert.ok(biomes.scenery.every(item=>[item.x,item.y,item.width,item.depth,item.height].every(Number.isFinite)));
  assert.deepEqual(worldBiomes(null),{ground:[],scenery:[],step:0});
});

function context(){
  const fills=[],paths=[],images=[],stack=[];let points=[],matrix={a:1,b:0,c:0,d:1,e:0,f:0};
  const point=(x,y)=>({x:x*matrix.a+matrix.e,y:y*matrix.d+matrix.f});
  return {fills,paths,images,fillStyle:'',fillRect(...values){fills.push({color:this.fillStyle,values});},
    beginPath(){points=[];},moveTo(x,y){points.push(point(x,y));},lineTo(x,y){points.push(point(x,y));},closePath(){},
    fill(){paths.push(points);},save(){stack.push({...matrix});},restore(){matrix=stack.pop()||matrix;},
    setTransform(a,b,c,d,e,f){matrix={a,b,c,d,e,f};},
    translate(x,y){matrix.e+=x*matrix.a;matrix.f+=y*matrix.d;},scale(x,y){matrix.a*=x;matrix.d*=y;},
    getTransform(){return {...matrix};},drawImage(canvas,...args){images.push({canvas,args,matrix:{...matrix}});}};
}
const close=(a,b)=>Math.abs(a-b)<1e-4;

test('2D and 3D use the same ground footprints and forest/mountain landmark coordinates',()=>{
  const biomes={ground:[{id:'wood-ground',kind:'woodland',x:100,y:200,width:400,depth:400,color:BIOME_COLORS.woodland}],
    scenery:[{id:'forest',kind:'woodland',x:100,y:200,width:400,depth:400,tone:1},
      {id:'ridge',kind:'mountain-range',x:700,y:300,width:400,depth:400,tone:0}]};
  const ctx=context();drawWorldBiomes(ctx,biomes);
  assert.ok(ctx.fills.some(fill=>fill.color===BIOME_COLORS.woodland&&
    JSON.stringify(fill.values)===JSON.stringify([100,200,400,400])));
  const mesh=staticMesh({bounds:{left:0,right:1400,top:0,bottom:1000},roads:[],water:[],
    buildings:[],scenery:biomes.scenery,biomes});
  const vertices=Array.from({length:mesh.length/9},(_,i)=>({x:mesh[i*9],h:mesh[i*9+1],z:mesh[i*9+2],
    color:[mesh[i*9+6],mesh[i*9+7],mesh[i*9+8]]}));
  const groundColor=color(BIOME_COLORS.woodland),ground=vertices.filter(p=>close(p.h,.035)&&p.color.every((v,i)=>close(v,groundColor[i])));
  assert.equal(Math.min(...ground.map(p=>p.x)),100);assert.equal(Math.max(...ground.map(p=>p.x)),500);
  assert.equal(Math.min(...ground.map(p=>p.z)),200);assert.equal(Math.max(...ground.map(p=>p.z)),600);
  for(const patch of biomes.scenery)for(const marker of biomeLandmarks(patch)){
    const expected=[];sceneryObjectMesh(expected,marker);
    const faces=projectedModelFaces(expected);
    assert.ok(faces.length>0);
    for(const face of faces)assert.ok(ctx.paths.some(path=>path.length===3&&path.every((p,i)=>
      close(p.x,face.points[i][0])&&close(p.y,face.points[i][1]))),'map places every visible model face at the shared anchor');
    for(let i=0;i<expected.length;i+=9)assert.ok(vertices.some(p=>close(p.x,expected[i])&&
      close(p.h,expected[i+1])&&close(p.z,expected[i+2])),'eye view uses the same complete landmark geometry');
    assert.equal(Math.max(...expected.filter((_,i)=>i%9===1)),marker.height);
  }
});

test('3D geographic ground replaces the grass below it instead of stacking far-camera surfaces',()=>{
  const island=createWorldIsland({regions:[core]}),biomes=worldBiomes(island,{regions:[core]});
  const mesh=staticMesh({island,bounds:island.seaBounds,roads:[],water:[],buildings:[],scenery:[],biomes});
  const grass=color(island.landColor),triangles=[];
  for(let i=0;i<mesh.length;i+=27)if([0,1,2].every(n=>close(mesh[i+6+n],grass[n])))
    triangles.push([0,9,18].map(offset=>({x:mesh[i+offset],y:mesh[i+offset+2]})));
  for(const patch of biomes.ground){
    const point={x:patch.x+patch.width*.41,y:patch.y+patch.depth*.57};
    assert.ok(!triangles.some(points=>{
      const sides=points.map((a,i)=>{const b=points[(i+1)%3];return (b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);});
      return sides.every(side=>side>=0)||sides.every(side=>side<=0);
    }),'biome interiors do not retain competing grass triangles');
  }
});

test('development map paints geographic ground and culled landmarks without replacing its display data',()=>{
  const biomes={ground:[{id:'visible',x:0,y:0,width:200,depth:200,color:'#123456'},
    {id:'offscreen',x:4000,y:4000,width:200,depth:200,color:'#654321'}],scenery:[]};
  const before=structuredClone(biomes),ctx=context();
  drawDevelopmentLandscape(ctx,{left:-10,right:500,top:-10,bottom:500,zoom:.1,scenery:[],biomes});
  assert.ok(ctx.fills.some(fill=>fill.color==='#123456'));
  assert.ok(!ctx.fills.some(fill=>fill.color==='#654321'));
  assert.deepEqual(biomes,before);
});

test('close village travel repaints shared biome detail without rebuilding its overview bitmap',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas'),allocated=[];
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;this.context=new Proxy(context(),{
      get:(target,key)=>key in target?target[key]:()=>{},
    });allocated.push(this);}
    getContext(){return this.context;}
  }
  Object.defineProperty(globalThis,'OffscreenCanvas',{value:Canvas,writable:true,configurable:true});
  t.after(()=>original?Object.defineProperty(globalThis,'OffscreenCanvas',original):delete globalThis.OffscreenCanvas);
  const island=createWorldIsland({regions:[core]}),biomes={ground:[
    {id:'near',x:4000,y:-1600,width:400,depth:400,color:'#123456'},
    {id:'far',x:-4000,y:1600,width:400,depth:400,color:'#654321'},
  ],scenery:[{id:'near-forest',kind:'woodland',x:4000,y:-1600,width:400,depth:400}]};
  const screen=new Proxy(context(),{get:(target,key)=>key in target?target[key]:()=>{}});
  const viewport={left:3950,right:4500,top:-1700,bottom:-1100,zoom:.08};
  drawVillageIslandBackground(screen,island,{biomes,viewport});
  const count=allocated.length,operations=allocated.map(c=>c.context.fills.length+c.context.paths.length);
  const overview=screen.images[0]?.canvas;
  assert.ok(overview,'the distant terrain has one overview bitmap');
  assert.equal(screen.fills.length,0,'distant terrain uses only the overview bitmap');
  drawVillageIslandBackground(screen,island,{biomes,viewport:{...viewport,zoom:1}});
  assert.ok(screen.fills.some(fill=>fill.color==='#123456'));
  assert.ok(!screen.fills.some(fill=>fill.color==='#654321'),'near terrain remains viewport culled');
  const landmarks=biomeLandmarks(biomes.scenery[0]),detail=screen.images.filter(image=>image.canvas!==overview);
  assert.equal(detail.length,landmarks.length,'close travel draws each visible shared landmark separately');
  for(const marker of landmarks)assert.ok(detail.some(image=>image.matrix.e===marker.x&&image.matrix.f===marker.y),
    'detail sprites retain their shared ground anchors');
  for(const image of detail){
    assert.ok(image.canvas.width>=image.args[2]&&image.canvas.height>=image.args[3],
      'close detail has at least one source pixel per world unit at this camera scale');
    assert.ok(image.canvas.width<=768&&image.canvas.height<=768,'individual detail sprites stay bounded');
  }
  assert.ok(allocated.length-count<=landmarks.length,'only the visible detail models can allocate new sprites');
  assert.deepEqual(allocated.slice(0,count).map(c=>c.context.fills.length+c.context.paths.length),operations,
    'the distant artwork remains cached while close detail is painted separately');
  const closeCount=allocated.length;
  drawVillageIslandBackground(screen,island,{biomes,viewport:{...viewport,zoom:1}});
  assert.equal(allocated.length,closeCount,'repeated close frames reuse their model sprites');
  assert.deepEqual(screen.images.slice(-landmarks.length).map(image=>image.canvas),detail.map(image=>image.canvas));
});
