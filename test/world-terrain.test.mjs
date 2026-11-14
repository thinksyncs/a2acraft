import test from 'node:test';
import assert from 'node:assert/strict';
import {districtTerrainGeometry,districtScenery,villageRoadRects,villageRiverBanks,villageBridge,homesAt,developmentScenery,villageOutskirtsGeometry,villageSurroundingsScenery,villageOutskirtsLandmarks} from '../public/world-terrain.js';
import {village3DScene} from '../public/village-3d-scene.js';
import {drawDevelopmentLandscape} from '../public/village-art.js';
import {VILLAGE_PLACES,VILLAGE_WORLD} from '../public/village-world.js';

test('both map road formats describe exactly the same rectangles',()=>{
  const rects=villageRoadRects(),scene=districtTerrainGeometry();
  assert.equal(scene.roads.length,rects.length+2,'square and bridge supplement the ordinary lanes');
  rects.forEach((rect,index)=>{
    const road=scene.roads[index],[a,b]=road.points;
    if(rect.vertical){
      assert.equal(a.x-road.width/2,rect.x);assert.equal(a.y,rect.y);
      assert.equal(road.width,rect.w);assert.equal(b.y-a.y,rect.h);
    }else{
      assert.equal(a.x,rect.x);assert.equal(a.y-road.width/2,rect.y);
      assert.equal(b.x-a.x,rect.w);assert.equal(road.width,rect.h);
    }
  });
  assert.equal(rects.filter(rect=>rect.w===16).length,12,'all building approach spurs remain visible');
});

test('3D timber deck has the same bounds as the 2D bridge, with water underneath',()=>{
  const terrain=districtTerrainGeometry(),deck=terrain.roads.find(road=>road.kind==='bridge');
  assert.deepEqual(deck.points,[{x:villageBridge.x,y:villageBridge.y+villageBridge.h/2},
    {x:villageBridge.x+villageBridge.w,y:villageBridge.y+villageBridge.h/2}]);
  assert.equal(deck.width,villageBridge.h);
  assert.ok(deck.height>1);
  assert.ok(terrain.water.some(water=>water.top<=400&&water.bottom>400));
});

test('river strips follow the shared 2D bank polygon within one world unit',()=>{
  const banks=villageRiverBanks(),right=[...banks.right].reverse();
  const at=(points,y)=>{
    const pair=points.findIndex((p,i)=>i<points.length-1&&p[1]<=y&&points[i+1][1]>=y);
    const [a,b]=[points[pair],points[pair+1]];
    return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]);
  };
  const water=districtTerrainGeometry().water;
  assert.equal(water[0].top,0);assert.equal(water.at(-1).bottom,640);
  water.forEach((strip,index)=>{
    if(index)assert.equal(water[index-1].bottom,strip.top);
    for(const y of [strip.top,strip.bottom]){
      assert.ok(Math.abs(strip.left-at(banks.left,y))<1);
      assert.ok(Math.abs(strip.right-at(right,y))<1);
    }
  });
  assert.ok(new Set(water.map(strip=>Math.round(strip.left))).size>20,'the river must curve');
});

test('homes, well, gardens and trees are deterministic shared landmarks',()=>{
  const one=districtScenery(4),two=districtScenery(4);
  assert.deepEqual(one,two);
  assert.deepEqual(one.filter(item=>item.kind==='cottage').map(({x,y})=>[x,y]),homesAt.slice(0,4));
  assert.deepEqual(one.find(item=>item.kind==='well'),{kind:'well',x:489,y:414,id:'terrain:0'});
  assert.equal(one.filter(item=>item.kind==='field').length,3);
  assert.ok(one.filter(item=>['tree','pine'].includes(item.kind)).length>60);
  assert.equal(districtScenery(99).filter(item=>item.kind==='cottage').length,12);
});

test('moving a district translates every road, river and landmark consistently',()=>{
  const zero=districtTerrainGeometry({x:0,y:0},{population:29});
  const moved=districtTerrainGeometry({x:1234,y:-567},{population:29});
  assert.equal(moved.scenery.filter(item=>item.kind==='cottage').length,4);
  moved.roads.forEach((road,index)=>road.points.forEach((point,n)=>{
    assert.equal(point.x-zero.roads[index].points[n].x,1234);
    assert.equal(point.y-zero.roads[index].points[n].y,-567);
  }));
  moved.water.forEach((strip,index)=>{
    assert.ok(Math.abs(strip.left-zero.water[index].left-1234)<1e-9);
    assert.equal(strip.top-zero.water[index].top,-567);
  });
  moved.scenery.forEach((item,index)=>{
    assert.ok(Math.abs(item.x-zero.scenery[index].x-1234)<1e-9);
    assert.ok(Math.abs(item.y-zero.scenery[index].y+567)<1e-9);
  });
});

test('conversation-village 3D uses the same core, including offscreen residents in population',()=>{
  const expected=districtTerrainGeometry({x:0,y:0},{population:29});
  const scene=village3DScene({residents:[{conversationId:'one',x:400,y:400}],population:29});
  assert.deepEqual(scene.roads.slice(0,expected.roads.length),expected.roads);
  assert.deepEqual(scene.water.slice(0,expected.water.length),expected.water);
  assert.deepEqual(scene.scenery.slice(0,expected.scenery.length),expected.scenery);
  assert.deepEqual(scene.bridges,[expected.bridge]);
  assert.equal(scene.people[0].kind,'agent');
});

test('outside scenery retains identity and placement across viewport and zoom changes',()=>{
  const large=developmentScenery({left:-1500,right:1500,top:-1500,bottom:1500});
  const smallBounds={left:-240,right:620,top:-170,bottom:730};
  const near=developmentScenery(smallBounds,{zoom:1});
  const far=developmentScenery(smallBounds,{zoom:.04});
  assert.ok(near.length>0);
  assert.deepEqual(near,far);
  const byId=new Map(large.map(item=>[item.id,item]));
  for(const item of near)assert.deepEqual(item,byId.get(item.id));
  assert.equal(new Set(large.map(item=>item.id)).size,large.length);
});

test('outside scenery avoids district clearings, roads and facility entrances',()=>{
  const bounds={left:-1000,right:1000,top:-1000,bottom:1000};
  const base=developmentScenery(bounds),target=base.find(item=>item.kind==='tree');
  assert.ok(target);
  const roads=[{width:25,points:[{x:target.x-100,y:target.y},{x:target.x+100,y:target.y}]}];
  assert.ok(!developmentScenery(bounds,{roads}).some(item=>item.id===target.id));
  assert.ok(!developmentScenery(bounds,{facilities:[{x:target.x,y:target.y}]}).some(item=>item.id===target.id));
  const district={x:target.x-500,y:target.y-320};
  const outside=developmentScenery(bounds,{districts:[district]});
  assert.ok(!outside.some(item=>item.id===target.id));
  assert.ok(outside.every(item=>item.x<district.x||item.x>district.x+1000||item.y<district.y||item.y>district.y+640));
  assert.ok(outside.length>0,'clearing exclusion must not delete the whole world');
});

test('an explicit empty scenery list never invents trees at another zoom',()=>{
  for(const zoom of [1,.04]){
    const fills=[];
    const ctx={fillStyle:null,fillRect(){fills.push(this.fillStyle);}};
    drawDevelopmentLandscape(ctx,{left:-1000,right:1000,top:-1000,bottom:1000,zoom,scenery:[]});
    assert.ok(fills.length>1);
    assert.ok(fills.every(color=>['#6e8a48','#819b5544'].includes(color)));
  }
});

test('village outskirts use one road, river and landmark model in the 3D scene',()=>{
  const core=districtTerrainGeometry(),outskirts=villageOutskirtsGeometry(),scene=village3DScene({});
  assert.deepEqual(scene.roads,[...core.roads,...outskirts.roads]);
  assert.deepEqual(scene.water.slice(0,core.water.length+outskirts.water.length),[...core.water,...outskirts.water]);
  assert.deepEqual(scene.scenery.slice(0,core.scenery.length+outskirts.scenery.length),[...core.scenery,...outskirts.scenery]);
  assert.equal(new Set(scene.scenery.map(item=>item.id)).size,scene.scenery.length);
  for(const place of VILLAGE_PLACES)assert.ok(outskirts.roads.some(road=>road.points.some(point=>
    Math.abs(point.x-place.entrance.x)<1&&Math.abs(point.y-place.entrance.y)<1)),place.name+' entrance remains connected');
  assert.deepEqual(outskirts.landmarks,villageOutskirtsLandmarks());
  assert.ok(outskirts.landmarks.some(item=>item.kind==='well'&&item.x===-267&&item.y===480));
  assert.equal(outskirts.landmarks.filter(item=>item.kind==='signpost').length,3);
});

test('outskirts river follows the same curved banks above and below the core without overlaps',()=>{
  const strips=[...districtTerrainGeometry().water,...villageOutskirtsGeometry().water].sort((a,b)=>a.top-b.top);
  const banks=villageRiverBanks(VILLAGE_WORLD.top,VILLAGE_WORLD.bottom),right=[...banks.right].reverse();
  const at=(bank,y)=>{
    const index=bank.findIndex((p,i)=>i<bank.length-1&&p[1]<=y&&bank[i+1][1]>=y);
    const [a,b]=[bank[index],bank[index+1]];
    return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]);
  };
  assert.equal(strips[0].top,VILLAGE_WORLD.top);assert.equal(strips.at(-1).bottom,VILLAGE_WORLD.bottom);
  strips.forEach((strip,index)=>{
    if(index)assert.equal(strips[index-1].bottom,strip.top);
    for(const y of [strip.top,strip.bottom]){
      assert.ok(Math.abs(strip.left-at(banks.left,y))<1);
      assert.ok(Math.abs(strip.right-at(right,y))<1);
    }
  });
});

test('surrounding tiles select the same trees as 3D and never duplicate core scenery',()=>{
  const all=villageSurroundingsScenery(VILLAGE_WORLD),byId=new Map(all.map(item=>[item.id,item]));
  assert.ok(all.length>100);
  for(const bounds of [{left:-256,right:0,top:0,bottom:256},{left:768,right:1024,top:-256,bottom:0},
    {left:256,right:512,top:512,bottom:768},{left:1280,right:1536,top:768,bottom:1024}]){
    for(const item of villageSurroundingsScenery(bounds))assert.deepEqual(item,byId.get(item.id));
  }
  for(const item of all){
    const radius=20*item.size,up=(item.kind==='rock'?16:52)*item.size,down=8*item.size;
    assert.ok(item.x+radius<=0||item.x-radius>=1000||item.y+down<=0||item.y-up>=640);
  }
});
