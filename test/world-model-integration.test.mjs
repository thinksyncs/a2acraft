import test from 'node:test';
import assert from 'node:assert/strict';
import {projectModel,facilityModel,characterPose} from '../public/world-model-descriptors.js';
import {buildingMesh} from '../public/world-building-model.js';
import {projectModelPoint,projectedModelFaces,mapBuildingBounds,drawMapPerson} from '../public/world-map-models.js';
import {village3DScene} from '../public/village-3d-scene.js';
import {peopleInView} from '../public/world-3d.js';
import {perspective,lookAt,multiply} from '../public/world-3d-math.js';

const mesh=model=>{const out=[];buildingMesh(out,model);return out;};
test('ground coordinates stay fixed while model height exposes roof and side volume',()=>{
  assert.deepEqual(projectModelPoint([120,0,-80]),[120,-80]);
  const raised=projectModelPoint([120,20,-80]);
  assert.ok(raised[0]<120&&raised[1]<-80);
  const model=projectModel({id:'house',x:110,y:230,seed:'house',stage:'complete'});
  const faces=projectedModelFaces(mesh(model)),bounds=mapBuildingBounds(model);
  assert.ok(faces.length>100);
  for(const face of faces)for(const [x,y] of face.points){
    assert.ok(x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom,'the entire visible roof and walls remain clickable');
  }
});
test('picking IDs cannot change a building appearance between views',()=>{
  for(const model of [projectModel({id:'repo',seed:'project-repo',x:180,y:240,stage:'finished'},{district:true}),
    facilityModel({id:'tavern',x:120,y:240},{district:true})]){
    assert.deepEqual(mesh(model),mesh({...model,id:'different-selection-id'}));
  }
});
test('village scene preserves role, identity, gait and default facing in both projections',()=>{
  const resident={conversationId:'test-chat',x:240,y:340,appearance:'mage',seed:42,walking:true};
  const pose=characterPose(resident,{time:850,motion:true});
  const scene=village3DScene({residents:[resident],time:850,motion:true});
  const actual=scene.people.find(person=>person.conversationId===resident.conversationId);
  for(const key of ['appearance','seed','heading','gait'])assert.equal(actual[key],pose[key]);
  assert.equal(village3DScene({residents:[resident],time:850,motion:false}).people[0].gait,0);
});
test('offscreen people do not allocate or paint model sprites',()=>{
  const ctx={canvas:{width:1200,height:800},getTransform:()=>({a:2,b:0,c:0,d:2,e:0,f:0}),save:()=>assert.fail('offscreen actor painted')};
  drawMapPerson(ctx,{x:10000,y:10000,heading:0,kind:'agent'});
});
test('eye view omits crowds behind the camera while preserving edge-crossing actors',()=>{
  const matrix=multiply(perspective(Math.PI/2,1,1,1000),lookAt([0,20,0],[0,20,-100]));
  const front={id:'front',x:0,y:-100},behind={id:'behind',x:0,y:100},edge={id:'edge',x:110,y:-100},far={id:'far',x:1000,y:-100};
  assert.deepEqual(peopleInView([front,behind,edge,far],matrix).map(p=>p.id),['front','edge']);
});
