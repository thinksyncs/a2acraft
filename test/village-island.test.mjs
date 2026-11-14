import test from 'node:test';
import assert from 'node:assert/strict';
import {villageIsland,villageBiomes,villageOverviewCamera,villageResidentCamera,village3DScene,readVillageView,VILLAGE_MIN_ZOOM} from '../public/village-3d-scene.js';
import {pointInIsland} from '../public/world-island.js';
import {VILLAGE_WORLD,VILLAGE_PLACES} from '../public/village-world.js';
import {villageOutskirtsGeometry,villageSurroundingsScenery} from '../public/world-terrain.js';

test('both village views reuse one island around the original world and facility entrances',()=>{
  const island=villageIsland(),first=village3DScene({});
  const second=village3DScene({population:168,residents:[{conversationId:'one',x:400,y:400}]});
  assert.equal(first.island,island);assert.equal(second.island,island);
  assert.deepEqual(first.bounds,island.seaBounds);
  for(const x of [VILLAGE_WORLD.left,VILLAGE_WORLD.right])
    for(const y of [VILLAGE_WORLD.top,VILLAGE_WORLD.bottom])assert.ok(pointInIsland({x,y},island));
  for(const place of VILLAGE_PLACES){
    assert.ok(pointInIsland(place,island));assert.ok(pointInIsland(place.entrance,island));
  }
  for(const road of first.roads)for(const point of road.points)assert.ok(pointInIsland(point,island));
  assert.ok(island.seaBounds.left<island.bounds.left&&island.seaBounds.right>island.bounds.right);
  assert.ok(island.seaBounds.top<island.bounds.top&&island.seaBounds.bottom>island.bounds.bottom);
});

test('island overview fits sea and coast in wide, portrait and short windows',()=>{
  const island=villageIsland(),bounds=island.seaBounds;
  for(const [width,height] of [[320,568],[690,640],[1280,480],[390,300]]){
    const camera=villageOverviewCamera(width,height),scale=Math.min(width/1000,height/640)*camera.zoom;
    const left=(bounds.left-camera.x)*scale+width/2,right=(bounds.right-camera.x)*scale+width/2;
    const top=(bounds.top-camera.y)*scale+height/2,bottom=(bounds.bottom-camera.y)*scale+height/2;
    assert.ok(left>=23.99&&right<=width-23.99,`${width}×${height} horizontal sea margin`);
    assert.ok(top>=49.99&&bottom<=height-49.99,`${width}×${height} vertical sea margin`);
    assert.ok(camera.zoom>=VILLAGE_MIN_ZOOM&&camera.zoom<.8,'overview must go beyond the old minimum');
    assert.deepEqual(readVillageView({camera}).camera,camera,'a reload preserves the overview camera');
  }
});

test('saved village cameras retain their close view and the newly available ocean positions',()=>{
  const close={x:456,y:321,zoom:1.22},bounds=villageIsland().seaBounds;
  assert.deepEqual(readVillageView({camera:close}).camera,close);
  const sea={x:bounds.right-20,y:bounds.top+20,zoom:.12};
  assert.deepEqual(readVillageView({camera:sea}).camera,sea);
  assert.equal(readVillageView({camera:{x:0,y:0,zoom:-2}}).camera.zoom,VILLAGE_MIN_ZOOM);
  assert.equal(readVillageView({camera:{x:Infinity,y:0,zoom:1}}).camera,null);
});

test('finding a resident zooms in from the continent without moving either person',()=>{
  const person={x:516.48,y:228},leader={x:498.61,y:266.01},before=structuredClone({person,leader});
  for(const [width,height] of [[320,568],[690,640],[1280,480],[390,300]]){
    const overview=villageOverviewCamera(width,height);
    const focused=villageResidentCamera(width,height,person,overview.zoom);
    const scale=Math.min(width/1000,height/640)*focused.zoom;
    assert.ok(scale>=.8,'people must be visible at conversational scale');
    for(const point of [person,leader]){
      const x=(point.x-focused.x)*scale+width/2,y=(point.y-focused.y)*scale+height/2;
      assert.ok(x>20&&x<width-20&&y>35&&y<height-35,'both people stay inside the view');
    }
    assert.equal(villageResidentCamera(width,height,person,2.5).zoom,2.5,'retain an existing closer view');
  }
  assert.deepEqual({person,leader},before);
});

test('the extended village river reaches the island bounds without moving existing roads or people',()=>{
  const residents=[{conversationId:'one',x:400,y:400}],before=structuredClone(residents);
  const scene=village3DScene({residents}),strips=[...scene.water].sort((a,b)=>a.top-b.top);
  assert.equal(strips[0].top,scene.island.bounds.top);
  assert.equal(strips.at(-1).bottom,scene.island.bounds.bottom);
  for(let i=1;i<strips.length;i++)assert.ok(Math.abs(strips[i-1].bottom-strips[i].top)<1e-7,'river must have no overlap or gap');
  assert.deepEqual(scene.roads.slice(-villageOutskirtsGeometry().roads.length),villageOutskirtsGeometry().roads);
  assert.deepEqual(residents,before);assert.equal(scene.people[0].x,400);assert.equal(scene.people[0].y,400);
});

test('the large village world retains local scenery and shares bounded outer biomes',()=>{
  const scene=village3DScene({}),ids=new Set(scene.scenery.map(item=>item.id));
  assert.equal(ids.size,scene.scenery.length);
  const expected=villageSurroundingsScenery(VILLAGE_WORLD).filter(item=>pointInIsland(item,scene.island));
  const actual=new Map(scene.scenery.map(item=>[item.id,item]));
  for(const item of expected)assert.deepEqual(actual.get(item.id),item);
  assert.equal(scene.biomes,villageBiomes());
  for(const item of scene.biomes.scenery)assert.deepEqual(actual.get(item.id),item);
  assert.ok(scene.biomes.scenery.length>0&&scene.biomes.scenery.length<2400);
  assert.ok(scene.biomes.scenery.some(item=>item.x<VILLAGE_WORLD.left||item.x>VILLAGE_WORLD.right||item.y<VILLAGE_WORLD.top||item.y>VILLAGE_WORLD.bottom));
});

test('replacing a coastline on the same island refreshes the outer 3D scenery',()=>{
  const island=villageIsland(),original=island.coast,originalPatches=island.landPatches,
    initial=village3DScene({}).scenery.length;
  const baseCount=villageOutskirtsGeometry().scenery.length+village3DScene({}).scenery.filter(item=>item.id?.startsWith('terrain:')).length;
  try{
    island.coast=[{x:VILLAGE_WORLD.left,y:VILLAGE_WORLD.top},{x:VILLAGE_WORLD.right,y:VILLAGE_WORLD.top},
      {x:VILLAGE_WORLD.right,y:VILLAGE_WORLD.bottom},{x:VILLAGE_WORLD.left,y:VILLAGE_WORLD.bottom}];
    island.landPatches=[{left:VILLAGE_WORLD.left,right:VILLAGE_WORLD.right,top:VILLAGE_WORLD.top,bottom:VILLAGE_WORLD.bottom}];
    const narrowed=village3DScene({});
    assert.equal(narrowed.scenery.length,baseCount,'outer trees that now fall in the sea are removed');
    assert.ok(narrowed.scenery.length<initial);
  }finally{island.coast=original;island.landPatches=originalPatches;}
  assert.equal(village3DScene({}).scenery.length,initial,'restoring the coast refreshes the scenery again');
});
