import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneryObjectMesh} from '../public/world-scenery-model.js';
import {biomeLandmarks,worldBiomes} from '../public/world-biomes.js';
import {createWorldIsland} from '../public/world-island.js';

const kinds=['tree','pine','rock','biome-tree','mountain','biome-mountain'];
const meshFor=item=>{const out=[];assert.equal(sceneryObjectMesh(out,item),true);return out;};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('trees and crags remain inside their shared ground footprint with bounded finite geometry',()=>{
  for(const kind of kinds)for(let seed=0;seed<8;seed++){
    const item={kind,id:`landmark-${seed}`,x:137,y:-83,width:96,depth:71,height:83};
    const mesh=meshFor(item);
    assert.equal(mesh.length%27,0);
    assert.ok(mesh.length/9<=600);
    let lowest=Infinity,highest=-Infinity;
    for(let i=0;i<mesh.length;i+=9){
      assert.ok(mesh.slice(i,i+9).every(Number.isFinite));
      assert.ok(Math.abs(mesh[i]-item.x)<=item.width/2);
      assert.ok(Math.abs(mesh[i+2]-item.y)<=item.depth/2);
      lowest=Math.min(lowest,mesh[i+1]);highest=Math.max(highest,mesh[i+1]);
      near(Math.hypot(...mesh.slice(i+3,i+6)),1);
      assert.ok(mesh.slice(i+6,i+9).every(channel=>channel>=0&&channel<=1));
    }
    near(lowest,0);near(highest,item.height);
  }
});

test('shared scenery anchors, scale and identity are deterministic in either view',()=>{
  for(const kind of kinds){
    const source={kind,id:'unchanged-landmark',tone:1};
    const original=meshFor(source),moved=meshFor({...source,x:213,y:-89,size:1.7});
    assert.deepEqual(original,meshFor(source));
    assert.equal(original.length,moved.length);
    for(let i=0;i<original.length;i+=9){
      near(moved[i],original[i]*1.7+213);near(moved[i+1],original[i+1]*1.7);
      near(moved[i+2],original[i+2]*1.7-89);
      for(let j=3;j<9;j++)near(moved[i+j],original[i+j]);
    }
  }
});

test('natural variations change the mesh, while unsupported scenery stays with its existing renderer',()=>{
  for(const kind of kinds)assert.notDeepEqual(meshFor({kind,id:'east'}),meshFor({kind,id:'west'}));
  const unchanged=[1,2,3];assert.equal(sceneryObjectMesh(unchanged,{kind:'field'}),false);
  assert.deepEqual(unchanged,[1,2,3]);
  const finiteFallback=meshFor({kind:'tree',x:NaN,y:Infinity,size:Infinity,height:NaN,width:NaN});
  assert.ok(finiteFallback.every(Number.isFinite));
});

test('forest stands and ridgelines vary by place and stay inside the dry patch',()=>{
  const counts=new Set(),species=new Set(),sizes=new Set();
  for(let cell=0;cell<18;cell++)for(const kind of ['woodland','mountain-range']){
    const patch={id:`patch-${cell}`,kind,x:cell*500,y:-260,width:500,depth:260};
    const markers=biomeLandmarks(patch);
    assert.deepEqual(markers,biomeLandmarks(patch));
    assert.ok(markers.every((p,i)=>i===0||p.y>=markers[i-1].y));
    for(const p of markers){
      assert.ok(p.x-p.width/2>=patch.x-1e-8&&p.x+p.width/2<=patch.x+patch.width+1e-8);
      assert.ok(p.y-p.depth/2>=patch.y-1e-8&&p.y+p.depth/2<=patch.y+patch.depth+1e-8);
    }
    if(kind==='woodland'){
      counts.add(markers.length);
      for(const p of markers){species.add(p.conifer);sizes.add(p.width);}
    }
  }
  assert.ok(counts.size>=3&&Math.max(...counts)<=5);
  assert.equal(species.size,2);assert.ok(sizes.size>20);
  const stand={id:'forest-tree',kind:'biome-tree'};
  assert.notDeepEqual(meshFor(stand),meshFor({...stand,conifer:true}));
});

test('island geography builds curving ridges across cells with shorter, lower spurs',()=>{
  const island=createWorldIsland({regions:[{left:0,top:0,right:1400,bottom:920}]});
  const world=worldBiomes(island);
  const peaks=world.scenery.filter(s=>s.kind==='mountain-range').flatMap(biomeLandmarks);
  const spurs=peaks.filter(p=>p.id.includes(':spur:')),crests=peaks.filter(p=>p.id.includes(':crest:'));
  assert.ok(spurs.length>2&&crests.length>spurs.length);
  assert.ok(Math.min(...crests.map(p=>p.heading))<-.5&&Math.max(...crests.map(p=>p.heading))>.5);
  const mean=markers=>markers.reduce((sum,p)=>sum+p.height,0)/markers.length;
  assert.ok(mean(spurs)<mean(crests)*.70);
  assert.ok(crests.some(a=>crests.some(b=>a!==b&&Math.floor(a.y/world.step)!==Math.floor(b.y/world.step)&&
    Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.depth+b.depth)/2)),
    'crest footprints overlap across the map cell boundary');
  const p=crests.find(peak=>peak.heading>.5);
  assert.notDeepEqual(meshFor(p),meshFor({...p,heading:0}));
});
