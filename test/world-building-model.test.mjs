import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingMesh,buildingShape} from '../public/world-building-model.js';

const kinds=['house','cottage','tavern','weapon','castle'];
const stages=['planned','building','testing','complete'];
const descriptor={id:'shared-building',x:80,y:-30,width:100,depth:72,height:64};
const mesh=building=>{const out=[];buildingMesh(out,building);return out;};
function bounds(vertices){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=9)for(let axis=0;axis<3;axis++){
    min[axis]=Math.min(min[axis],vertices[i+axis]);
    max[axis]=Math.max(max[axis],vertices[i+axis]);
  }
  return {min,max};
}

test('every facility and build stage produces finite lit triangle geometry',()=>{
  for(const kind of kinds)for(const stage of stages){
    const vertices=mesh({...descriptor,kind,stage});
    assert.ok(vertices.length>0,`${kind}/${stage} is visible`);
    assert.equal(vertices.length%27,0,`${kind}/${stage} triangle stride`);
    for(let i=0;i<vertices.length;i+=9){
      assert.ok(vertices.slice(i,i+9).every(Number.isFinite),`${kind}/${stage} finite attributes`);
      assert.ok(Math.abs(Math.hypot(...vertices.slice(i+3,i+6))-1)<1e-8,`${kind}/${stage} unit normal`);
      assert.ok(vertices.slice(i+6,i+9).every(value=>value>=0&&value<=1),`${kind}/${stage} valid color`);
    }
  }
});

test('the same building preserves its shape, colors and normals when moved on the map',()=>{
  for(const kind of kinds){
    const original=mesh({...descriptor,kind}),translated=mesh({...descriptor,kind,x:descriptor.x+173,y:descriptor.y-121});
    assert.equal(original.length,translated.length);
    for(let i=0;i<original.length;i+=9){
      assert.ok(Math.abs(translated[i]-original[i]-173)<1e-8);
      assert.ok(Math.abs(translated[i+2]-original[i+2]+121)<1e-8);
      assert.ok(Math.abs(translated[i+1]-original[i+1])<1e-8);
      for(let attribute=3;attribute<9;attribute++)assert.ok(Math.abs(translated[i+attribute]-original[i+attribute])<1e-8);
    }
    assert.deepEqual(original,mesh({...descriptor,kind}));
  }
});

test('architectural detail stays close to its world footprint and above ground',()=>{
  for(const kind of kinds)for(const stage of stages){
    const {min,max}=bounds(mesh({...descriptor,kind,stage}));
    assert.ok(min[0]>=descriptor.x-descriptor.width/2-10,`${kind}/${stage} left`);
    assert.ok(max[0]<=descriptor.x+descriptor.width/2+10,`${kind}/${stage} right`);
    assert.ok(min[2]>=descriptor.y-descriptor.depth/2-10,`${kind}/${stage} rear`);
    assert.ok(max[2]<=descriptor.y+descriptor.depth/2+10,`${kind}/${stage} front`);
    assert.ok(min[1]>=0);
    assert.ok(max[1]<=descriptor.height*1.7+8);
  }
});

test('planned lots remain low, construction exposes a frame, and facilities have different silhouettes',()=>{
  const planned=mesh({...descriptor,stage:'planned'}),construction=mesh({...descriptor,stage:'building'}),complete=mesh({...descriptor,stage:'complete'});
  assert.ok(bounds(planned).max[1]<20);
  assert.ok(bounds(construction).max[1]>descriptor.height);
  assert.ok(construction.length<complete.length);
  const completed=kinds.map(kind=>mesh({...descriptor,kind,stage:'complete'}));
  assert.equal(new Set(completed.map(vertices=>vertices.length)).size,kinds.length);
  assert.ok(bounds(completed[2]).max[2]>bounds(completed[0]).max[2],'inn has an entrance canopy');
});

test('invalid dimensions normalize into usable geometry without changing the descriptor contract',()=>{
  assert.deepEqual(buildingShape({x:NaN,y:Infinity,width:0,depth:-1,height:0}),{
    x:0,y:0,width:12,depth:12,height:10,stage:'finished',kind:'house',
  });
  for(const kind of kinds)for(const stage of stages){
    const vertices=mesh({kind,stage,width:0,depth:-1,height:0,color:'invalid'});
    assert.ok(vertices.every(Number.isFinite));
    assert.equal(vertices.length%27,0);
  }
});
