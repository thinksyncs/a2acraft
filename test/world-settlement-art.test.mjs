import test from 'node:test';
import assert from 'node:assert/strict';
import {drawWorldHydrology,drawWorldBridges,drawWorldSettlement,drawVillageWorld} from '../public/village-art.js';
import {staticMesh,color} from '../public/world-3d-mesh.js';
import {sceneBuildingObstacles} from '../public/project-buildings.js';

function context(){
 const fills=[],paints=[];let path=[];
 return new Proxy({fills,paints,fillStyle:'',
  beginPath(){path=[];},rect(x,y,width,height){path.push({x,y,width,height});},
  fill(rule='nonzero'){
   const rects=path.map(rect=>({...rect,color:this.fillStyle}));
   paints.push({rule,rects});fills.push(...rects);
  },
  fillRect(x,y,width,height){
   const rect={color:this.fillStyle,x,y,width,height};fills.push(rect);paints.push({rule:'nonzero',rects:[rect]});
  }},
  {get:(target,key)=>key in target?target[key]:()=>{}});
}
const pixel=(ctx,x,y)=>ctx.fills.filter(fill=>x>=fill.x&&x<fill.x+fill.width&&y>=fill.y&&y<fill.y+fill.height).at(-1)?.color;
const island={coast:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}],
 landPatches:[{left:0,right:1000,top:0,bottom:1000}],bounds:{left:0,right:1000,top:0,bottom:1000},
 seaBounds:{left:-100,right:1100,top:-100,bottom:1100},landColor:'#78924f',seaColor:'#315e75',sandColor:'#c7bb83'};
const close=(a,b)=>Math.abs(a-b)<1e-4;
function triangles(mesh,shade,height){
 const wanted=color(shade),result=[];
 for(let i=0;i<mesh.length;i+=27)if([0,1,2].every(n=>close(mesh[i+6+n],wanted[n]))&&
  [0,9,18].every(offset=>height===undefined||close(mesh[i+offset+1],height)))
  result.push([0,9,18].map(offset=>({x:mesh[i+offset],y:mesh[i+offset+2]})));
 return result;
}
const covers=(triangle,p)=>{
 const sides=triangle.map((a,i)=>{const b=triangle[(i+1)%3];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);});
 return sides.every(side=>side>=-1e-6)||sides.every(side=>side<=1e-6);
};

test('decorative cottage collision bounds match the walls drawn by the 3D renderer',()=>{
 const cottage={kind:'cottage',id:'home',x:450,y:350,tone:1},
  scene={island,bounds:island.seaBounds,roads:[],water:[],buildings:[],scenery:[cottage]},
  mesh=staticMesh(scene),walls=triangles(mesh,'#d5c18a').flat();
 assert.ok(walls.length);
 const [obstacle]=sceneBuildingObstacles(scene,0);
 assert.deepEqual(obstacle,{left:Math.min(...walls.map(p=>p.x)),right:Math.max(...walls.map(p=>p.x)),
  top:Math.min(...walls.map(p=>p.y)),bottom:Math.max(...walls.map(p=>p.y))});
});

test('one shared river crosses district boundaries without a rim or grass bar across its water',()=>{
 const ctx=context(),water=Array.from({length:75},(_,i)=>({left:200+i*.3,right:300+i*.3,
  top:i*16,bottom:(i+1)*16,color:'#599ba0'}));
 const model={water,bankWidth:10},before=structuredClone(model);
 drawWorldHydrology(ctx,model,{zoom:.2});
 for(const y of [638,639,640,641,642,1022,1023])assert.equal(pixel(ctx,260,y),'#599ba0');
 assert.equal(pixel(ctx,194,8),'#92a27b','the bank is outside the wet footprint');
 assert.deepEqual(model,before);
});

test('hydrology culls distant strips and uses the shared mouth color',()=>{
 const ctx=context();
 drawWorldHydrology(ctx,{bankWidth:0,water:[{left:0,right:50,top:0,bottom:30,color:'#599ba0'},
  {left:0,right:50,top:30,bottom:50,color:'#315e75'},
  {left:4000,right:4100,top:4000,bottom:4200,color:'#123456'}]},
  {left:-10,right:100,top:-10,bottom:100,zoom:.05});
 assert.equal(pixel(ctx,25,45),'#315e75');
 assert.ok(!ctx.fills.some(fill=>fill.color==='#123456'));
});

test('fractional overlapping river strips paint a uniform surface without internal composite edges',()=>{
 const water=[
  {left:20.25,right:100.75,top:0.4,bottom:50.6},
  {left:25.7,right:105.3,top:20.2,bottom:70.8},
  {left:31.1,right:110.9,top:40.3,bottom:90.5},
 ];
 const model={water,bankWidth:8},before=structuredClone(model),ctx=context();
 drawWorldHydrology(ctx,model,{left:0,right:150,top:0,bottom:100,zoom:.1});
 const layersAt=(x,y)=>ctx.paints.flatMap(paint=>{
  const hits=paint.rects.filter(rect=>x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height);
  return hits.length&&(paint.rule==='nonzero'||hits.length%2)?[hits[0].color]:[];
 });
 // One, two and three overlapping wet footprints must have identical paint
 // coverage, including at their fractional internal edges. Otherwise Canvas
 // compositing can reveal the source rectangles through the water surface.
 for(const y of [10,20.2,30,40.3,45,60,80])assert.deepEqual(layersAt(60,y),['#92a27b','#599ba0']);
 assert.deepEqual(layersAt(16,10),['#92a27b']);
 assert.deepEqual(layersAt(3,10),[]);
 assert.deepEqual(layersAt(115,45),['#92a27b']);
 assert.deepEqual(model,before,'rendering does not change shared 2D/3D water geometry');
});

test('river color transitions preserve the shared downstream surface order',()=>{
 const ctx=context(),colors=['#599ba0','#315e75','#599ba0'];
 const water=colors.map((color,index)=>({left:10.3,right:90.7,top:index*20+.2,bottom:index*20+40.8,color}));
 drawWorldHydrology(ctx,{water,bankWidth:0},{zoom:.1});
 assert.equal(pixel(ctx,50,30),'#315e75');
 assert.equal(pixel(ctx,50,50),'#599ba0');
});

test('new city sprites never add the legacy rectangular terrain or fixed river shimmer',()=>{
 const ctx=context();
 drawVillageWorld(ctx,{terrainVisible:false,outskirtsVisible:false,motion:true,population:87,projects:[],residents:[]});
 assert.deepEqual(ctx.fills,[]);
});

test('2D and 3D clearings share dry footprints without a competing ground layer',()=>{
 const clearing={id:'dry-town',kind:'clearing',color:'#889955',x:250,y:180,patches:[
  {left:100,right:250,top:100,bottom:250},{left:300,right:400,top:140,bottom:260}]};
 const water=[{left:210,right:230,top:0,bottom:1000,color:'#599ba0'}],ctx=context();
 drawWorldSettlement(ctx,{clearings:[clearing],scenery:[]},{layer:'ground'});
 drawWorldHydrology(ctx,{water,bankWidth:0},{zoom:.05});
 assert.equal(pixel(ctx,120,120),clearing.color);assert.equal(pixel(ctx,220,120),'#599ba0');
 assert.equal(pixel(ctx,275,180),undefined,'no rectangle joins distinct dry patches');
 const mesh=staticMesh({island,bounds:island.seaBounds,roads:[],water,scenery:[clearing],buildings:[],
  biomes:{ground:[{x:80,y:80,width:370,depth:220,color:'#456f45'}],scenery:[]}});
 const ground=triangles(mesh,clearing.color,.035);
 const area=ground.reduce((sum,[a,b,c])=>sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2,0);
 assert.ok(close(area,31500));
 assert.ok(ground.some(triangle=>covers(triangle,{x:120,y:120})));
 assert.ok(!ground.some(triangle=>covers(triangle,{x:220,y:120})));
 for(const shade of [island.landColor,'#456f45'])assert.ok(!triangles(mesh,shade).some(triangle=>covers(triangle,{x:120,y:120})),
  'a dry town clearing replaces grass and biome ground instead of covering them');
});

for(const orientation of ['horizontal','vertical'])test(`the ${orientation} timber bridge has the same 2D and 3D deck footprint`,()=>{
 const bridge={x:450,y:350,w:orientation==='vertical'?36:180,h:orientation==='vertical'?180:36,orientation};
 const ctx=context();drawWorldBridges(ctx,[bridge]);
 assert.ok(ctx.fills.some(fill=>fill.color==='#907549'&&fill.x===bridge.x&&fill.y===bridge.y&&fill.width===bridge.w&&fill.height===bridge.h));
 const mesh=staticMesh({island,bounds:island.seaBounds,roads:[],water:[],scenery:[],buildings:[],bridges:[bridge]});
 const deck=triangles(mesh,'#a58a61').flat();
 assert.equal(Math.min(...deck.map(p=>p.x)),bridge.x);assert.equal(Math.max(...deck.map(p=>p.x)),bridge.x+bridge.w);
 assert.equal(Math.min(...deck.map(p=>p.y)),bridge.y);assert.equal(Math.max(...deck.map(p=>p.y)),bridge.y+bridge.h);
});

test('3D town streets preserve lane widths and the round atlas corners and ends',()=>{
 const road={rounded:true,width:25,points:[{x:200,y:200},{x:300,y:200},{x:300,y:300}]};
 const lane={rounded:true,width:12,points:[{x:600,y:200},{x:600,y:300}]};
 const mesh=staticMesh({island,bounds:island.seaBounds,roads:[road,lane],scenery:[],water:[],buildings:[]});
 const surfaces=triangles(mesh,'#cbb77b',.36),contains=point=>surfaces.some(triangle=>covers(triangle,point));
 assert.ok(contains({x:308,y:192}),'outside of a 90-degree bend is round, not a missing grass wedge');
 assert.ok(contains({x:190,y:200}),'round cap extends half the shared width past the endpoint');
 assert.ok(!contains({x:187,y:200}));
 assert.ok(contains({x:605,y:250}),'the narrow lane is six units wide on each side');
 assert.ok(!contains({x:607,y:250}));
 for(let i=0;i<mesh.length;i+=9)if(close(mesh[i+6],color('#cbb77b')[0]))
  assert.ok(mesh[i+4]>.99,'only upward road surfaces are emitted');
});
