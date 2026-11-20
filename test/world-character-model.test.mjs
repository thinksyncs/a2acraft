import test from 'node:test';
import assert from 'node:assert/strict';
import {personMesh} from '../public/world-character-model.js';

const meshFor=(person={},hero=false)=>{const out=[];personMesh(out,person,hero);return out;};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const roles=['hero','mage','priest','martial-artist'];

test('all character silhouettes and walking poses stay finite, bounded and within the crowd budget',()=>{
  for(const appearance of roles)for(const kind of ['resident','agent','subagent'])for(const gait of [-1,0,1]){
    const mesh=meshFor({id:'crowd-sample',appearance,kind,gait});
    assert.equal(mesh.length%27,0);
    assert.ok(mesh.length/9<=1800,`${appearance}/${kind} exceeds the per-person vertex budget`);
    for(let i=0;i<mesh.length;i+=9){
      assert.ok(mesh.slice(i,i+9).every(Number.isFinite));
      assert.ok(Math.abs(mesh[i])<=10.1);
      assert.ok(mesh[i+1]>=0&&mesh[i+1]<=32.2);
      assert.ok(Math.abs(mesh[i+2])<=6);
      near(Math.hypot(...mesh.slice(i+3,i+6)),1);
      assert.ok(mesh.slice(i+6,i+9).every(channel=>channel>=0&&channel<=1));
    }
  }
});

test('heading, world position and scale transform the same model exactly once',()=>{
  const person={id:'scaled-mage',appearance:'mage',kind:'agent',gait:.6,color:'#478cb5'};
  const reference=meshFor(person),heading=Math.PI*.5,size=.58,x=193,y=-71;
  const transformed=meshFor({...person,heading,scale:size,x,y});
  assert.equal(transformed.length,reference.length);
  for(let i=0;i<reference.length;i+=9){
    near(transformed[i],x-reference[i+2]*size);
    near(transformed[i+1],reference[i+1]*size);
    near(transformed[i+2],y+reference[i]*size);
    near(transformed[i+3],-reference[i+5]);
    near(transformed[i+4],reference[i+4]);
    near(transformed[i+5],reference[i+3]);
    assert.deepEqual(transformed.slice(i+6,i+9),reference.slice(i+6,i+9));
  }
});

test('roles have distinct deterministic shapes and subagents retain their parent color at a smaller scale',()=>{
  const person={conversationId:'fixed-session',color:'#478cb5',kind:'agent'};
  const meshes=roles.map(appearance=>meshFor({...person,appearance}));
  for(let i=0;i<roles.length;i++){
    assert.deepEqual(meshes[i],meshFor({...person,appearance:{id:roles[i]}}));
    for(let j=i+1;j<roles.length;j++)assert.notDeepEqual(meshes[i],meshes[j]);
  }
  assert.deepEqual(meshFor({...person,role:'調査'}),meshFor({...person,appearance:'mage'}));
  const helper=meshFor({...person,kind:'subagent',scale:.58});
  const exactColor=[0x47,0x8c,0xb5].map(value=>value/255);
  assert.ok(helper.some((_,i)=>i%9===6&&helper.slice(i,i+3).every((channel,j)=>channel===exactColor[j])));
  const height=mesh=>Math.max(...mesh.filter((_,i)=>i%9===1));
  assert.ok(height(helper)<height(meshes[0])*.7);
  assert.notDeepEqual(helper,meshFor({...person,scale:.58}));
});

test('eyes face the walking heading, and gait changes limbs without changing character identity',()=>{
  const person={id:'direction-check',appearance:'hero',kind:'agent',color:'#478cb5'};
  const north=meshFor(person),walking=meshFor({...person,gait:1});
  const eye=[0x29,0x3b,0x37].map(value=>value/255);
  let eyeVertices=0;
  for(let i=0;i<north.length;i+=9){
    if(!north.slice(i+6,i+9).every((channel,j)=>channel===eye[j]))continue;
    eyeVertices++;near(north[i+3],0);near(north[i+4],0);near(north[i+5],-1);
  }
  assert.equal(eyeVertices,12);
  assert.equal(walking.length,north.length);
  assert.notDeepEqual(walking,north);
  for(let i=0;i<north.length;i+=9)assert.deepEqual(walking.slice(i+6,i+9),north.slice(i+6,i+9));
  assert.deepEqual(meshFor({...person,gait:NaN,heading:Infinity,scale:Infinity,x:NaN}),north);
});
