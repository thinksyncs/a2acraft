import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResidentPatrols,residentPatrolPosition} from '../public/village-resident-motion.js';
import {islandRouteWalkable} from '../public/world-island-travel.js';
import {buildConversationAffinity} from '../public/conversation-affinity.js';
import {buildVillageSemanticLayout} from '../public/village-semantic-layout.js';
import {villageDemoChats} from '../public/village-demo.js';
import {projectVillage} from '../public/village-model.js';
import {villageIsland,villageBiomes,village3DScene} from '../public/village-3d-scene.js';
import {sceneBuildingObstacles} from '../public/project-buildings.js';

const island={bounds:{left:-400,right:400,top:-400,bottom:400},gridSize:40,
  coast:[{x:-400,y:-400},{x:400,y:-400},{x:400,y:400},{x:-400,y:400}],
  landPatches:[{left:-400,right:400,top:-400,bottom:400}]};
const homes=new Map([['a',{x:0,y:0}],['b',{x:180,y:0}]]);

test('residents move around home in different directions with only brief rests',()=>{
  const plans=buildResidentPatrols({homes,island});
  assert.deepEqual(plans,buildResidentPatrols({homes,island}),'same world produces stable local walks');
  const plan=plans.get('a'),samples=Array.from({length:300},(_,i)=>residentPatrolPosition(plan,i*100));
  const moving=samples.filter(p=>p.walking);
  assert.ok(moving.length>samples.length*.8);
  assert.ok(Math.max(...samples.map(p=>Math.hypot(p.x,p.y)))>70,'walk visibly leaves the old44×18 doorstep rectangle');
  assert.ok(samples.every(p=>Math.hypot(p.x,p.y)<=110.001),'walk remains in the resident home area');
  assert.ok(new Set(moving.map(p=>p.direction)).size>=3);
  assert.notDeepEqual(plans.get('a').legs.map(l=>l.seconds),plans.get('b').legs.map(l=>l.seconds));
});

test('local walks do not cut through buildings, mountain rectangles, river or sea',()=>{
  const obstacles=[{left:-45,right:45,top:-120,bottom:-18},{left:38,right:95,top:20,bottom:95}];
  const water=[{left:-160,right:-50,top:-200,bottom:200}];
  const edgeHome=new Map([['shore',{x:355,y:80}],['courtyard',{x:0,y:0}]]);
  const plans=buildResidentPatrols({homes:edgeHome,island,obstacles,water});
  for(const plan of plans.values()){
    assert.ok(plan.legs.some(leg=>leg.walking),'safe local space still permits walking');
    assert.ok(islandRouteWalkable(plan.points,island,{obstacles,water}));
    for(let t=0;t<plan.duration*1000;t+=100){
      const p=residentPatrolPosition(plan,t);
      assert.ok(Math.hypot(p.x-plan.home.x,p.y-plan.home.y)<=110.001);
    }
  }
});

test('encounter-held time can be subtracted without a jump when the villager resumes',()=>{
  const plan=buildResidentPatrols({homes,island}).get('a');
  const before=residentPatrolPosition(plan,4700),heldFor=15000;
  const resumed=residentPatrolPosition(plan,4700+heldFor-heldFor);
  assert.deepEqual(resumed,before);
  const reduced=residentPatrolPosition(plan,4700,{motion:false});
  assert.equal(reduced.x,before.x);assert.equal(reduced.y,before.y);assert.equal(reduced.walking,false);
  const next=residentPatrolPosition(plan,4800);
  assert.ok(Math.hypot(next.x-before.x,next.y-before.y)<=plan.speed*.1+.001);
});

test('unreachable local space leaves the resident in place instead of fabricating a route',()=>{
  const obstacles=[{left:-15,right:15,top:-100,bottom:-10},{left:-15,right:15,top:10,bottom:100},
    {left:-100,right:-10,top:-15,bottom:15},{left:10,right:100,top:-15,bottom:15}];
  const plan=buildResidentPatrols({homes:new Map([['a',{x:0,y:0}]]),island,obstacles}).get('a');
  assert.equal(plan.legs.length,0);
  assert.deepEqual(residentPatrolPosition(plan,100000),{x:0,y:0,walking:false,direction:'down',motionLabel:'ひと休み'});
});

test('the full populated village uses safe local patrols in the same shared terrain',()=>{
  const chats=[{id:'demo1',title:'Main',messages:[{role:'user',text:'このUIをCodexの利用枠で使いたい。'},
    {role:'assistant',text:'ChatGPTアカウントを接続して、Codexの利用枠で会話を始められます。'}]},...villageDemoChats()];
  const projection=projectVillage(chats),affinity=buildConversationAffinity(chats);
  const island=villageIsland(),base=village3DScene({population:chats.length});
  const layout=buildVillageSemanticLayout({...projection,affinity,island,terrain:base,obstacles:sceneBuildingObstacles(base),biomes:villageBiomes()});
  const scene=village3DScene({projects:layout.projects,population:chats.length});
  const obstacles=[...sceneBuildingObstacles(scene),...layout.mountains];
  const patrols=buildResidentPatrols({homes:layout.homes,residents:projection.residents,island,obstacles,water:scene.water,bridges:scene.bridges});
  assert.equal(patrols.size,169);
  for(const [id,plan] of patrols){
    assert.ok(islandRouteWalkable(plan.points,island,{obstacles,water:scene.water,bridges:scene.bridges}),id);
    assert.ok(plan.legs.some(leg=>leg.walking),id+' has room to walk');
  }
});
