import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneryObjectMesh} from '../public/world-scenery-model.js';

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
