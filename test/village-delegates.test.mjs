import test from 'node:test';
import assert from 'node:assert/strict';
import {projectVillage} from '../public/village-model.js';
import {village3DScene, villageEncounterActors, villageEncounterSightline} from '../public/village-3d-scene.js';
import {villageDelegation,delegationCacheKey,delegationSummary,villageDelegateActors,agentRoleLabel,
  addDelegatesToScene,worldDelegateLabels} from '../public/village-delegates.js';
import {peopleMesh,visiblePeople} from '../public/world-3d-mesh.js';
import {multiply,perspective,lookAt} from '../public/world-3d-math.js';

const agent = (threadId,status='running') => ({threadId,parentThreadId:'root',name:threadId,role:null,status});
const chat = () => ({id:'owner',threadId:'root',title:'家計簿アプリ',status:'running',messages:[
  {role:'user',text:'家計簿アプリの開発を相談したい。'}],delegation:{version:1,rootThreadId:'root',revision:1,
  agents:[agent('one','running'),agent('two','completed'),agent('three','unknown'),agent('four','waiting')],truncated:false}});

test('Native children attach to the parent without creating residents, party members, buildings or progress', () => {
  const input=chat();input.delegation.agents[1].returnedText='テストと公開が完了しました。バージョン1.0を公開しました。';
  input.delegation.agents[0].role='Not an inferred profession';
  const before=JSON.stringify(input),result=projectVillage([input]);
  assert.equal(result.stats.population,1);assert.equal(result.stats.projects,1);
  assert.equal(result.projects[0].stage,'planned');assert.equal(result.residents.length,1);
  assert.equal(result.residents[0].delegation.total,4);
  assert.equal(result.residents[0].delegation.agents[0].role,'Not an inferred profession');
  assert.equal(result.residents[0].delegation.agents[1].returnedText,undefined);
  assert.equal(JSON.stringify(input),before);
  assert.equal(villageDelegation({id:'independent',party:{members:[agent('one')]}}),null);
  assert.equal(villageDelegation({...input,threadId:'another-root'}),null);
  assert.equal(villageDelegation({...input,threadId:undefined}),null);
  assert.equal(villageDelegation({...input,threadId:null}),null);
  assert.equal(villageDelegation({...input,threadId:' root '}),null);
});

test('Delegation revision invalidates projection independently of chat messages and preserves unknown state', () => {
  const input=chat(),key=delegationCacheKey(input.delegation);
  input.delegation.revision++;input.delegation.agents[0].status='unexpected';
  assert.notEqual(delegationCacheKey(input.delegation),key);
  input.delegation.agents.push(agent('one','completed'));
  input.delegation.truncated=true;
  const projected=villageDelegation(input);
  assert.equal(projected.total,4);assert.equal(projected.completed,1);assert.equal(projected.unknown,2);
  assert.equal(projected.agents[0].status,'unknown');
  assert.match(delegationSummary(projected),/補助 4\+.*完了 1.*未確認 2/);
});

test('A maximum of three small helpers share the parent position and color while the badge retains the full count', () => {
  const parent={conversationId:'owner',seed:9,x:100,y:120,heading:0,color:'#aabbcc',delegation:villageDelegation(chat())};
  const before=JSON.stringify(parent),actors=villageDelegateActors([parent,parent]);
  assert.equal(actors.helpers.length,3);assert.equal(actors.badges.length,1);
  assert.equal(actors.badges[0].count,4);
  for(const helper of actors.helpers){
    assert.equal(helper.parentConversationId,'owner');assert.equal(helper.color,parent.color);
    assert.equal(helper.selectable,false);assert.equal(helper.conversationId,undefined);
    assert.ok(helper.scale<1);assert.ok(Math.hypot(helper.x-parent.x,helper.y-parent.y)<=22);
  }
  assert.match(actors.helpers.find(helper=>helper.status==='unknown').label,/^補 three.*\?$/);
  assert.deepEqual(actors.helpers.map(helper=>helper.threadId),['one','three','four']);
  const room=villageDelegateActors([{...parent,delegation:villageDelegation({...chat(),delegation:{...chat().delegation,
    agents:[agent('done','completed'),agent('working','running')]}})}]);
  assert.deepEqual(room.helpers.map(helper=>helper.threadId),['working','done']);
  assert.match(room.helpers.find(helper=>helper.status==='completed').label,/^補 done.*✓$/);
  const moved=villageDelegateActors([{...parent,x:parent.x+70}]);
  assert.deepEqual(moved.helpers.map(helper=>helper.x),actors.helpers.map(helper=>helper.x+70));
  assert.equal(JSON.stringify(parent),before);
});

test('Helpers stay clustered around a moving and turning parent without blocking their gaze', () => {
  const parent={conversationId:'owner',seed:9,x:100,y:120,color:'#aabbcc',delegation:villageDelegation(chat())};
  for (const heading of [0,Math.PI/2,Math.PI,-Math.PI/2,.73]) {
    const helpers=villageDelegateActors([{...parent,heading}]).helpers;
    const moved=villageDelegateActors([{...parent,heading,x:173,y:-42}]).helpers;
    for (const [index,helper] of helpers.entries()) {
      const dx=helper.x-parent.x,dy=helper.y-parent.y;
      assert.ok(Math.hypot(dx,dy)>=18 && Math.hypot(dx,dy)<=22.000001);
      assert.ok(dx*-Math.sin(heading)+dy*Math.cos(heading)>=0, 'keep the front clear');
      assert.ok(Math.abs(moved[index].x-helper.x-73)<1e-10);
      assert.ok(Math.abs(moved[index].y-helper.y+162)<1e-10);
      for (const other of helpers.slice(index+1)) assert.ok(Math.hypot(helper.x-other.x,helper.y-other.y)>16);
    }
  }
});

test('A parent displayed as resident and party member has one cluster with the same 2D and 3D color', () => {
  const first={id:'resident:owner',conversationId:'owner',x:100,y:120,color:'#aabbcc',delegation:villageDelegation(chat())};
  const duplicate={...first,id:'party:squad:0',x:300,y:400,color:'#ddaa77'};
  const delegates=villageDelegateActors([first,duplicate]);
  const before=JSON.stringify([first,duplicate]);
  const scene=addDelegatesToScene({people:[first,duplicate]},delegates);
  assert.equal(scene.people.filter(person=>person.delegationCount).length,1);
  assert.equal(scene.people[0].delegationCount,4);
  assert.equal(scene.people[1].delegationCount,undefined);
  assert.deepEqual(scene.people.filter(person=>person.kind==='subagent'),delegates.helpers);
  assert.equal(JSON.stringify([first,duplicate]),before);
});

test('Both map projections retain encounter identity; helpers never become conversation targets or leaders', () => {
  const owner={conversationId:'owner',x:0,y:-42,seed:1,delegation:villageDelegation(chat())};
  const actors=villageEncounterActors({residents:[owner],hero:{id:'hero',isProtagonist:true,
    members:[{conversationId:'viewer',x:0,y:0}]},encounter:{conversationId:'owner',person:owner,status:'talking'}});
  const delegates=villageDelegateActors(actors.residents);
  const scene=village3DScene({...actors,delegates});
  assert.equal(scene.people.filter(person=>person.conversationId==='owner').length,1);
  assert.equal(scene.people.filter(person=>person.kind==='subagent').length,3);
  const parent=scene.people.find(person=>person.conversationId==='owner');
  assert.equal(parent.delegationCount,4);
  for(const helper of scene.people.filter(person=>person.kind==='subagent')) assert.equal(helper.color,parent.color);
  assert.equal(scene.leader.id,'party:hero:0');
  const visible=villageEncounterSightline(scene,'owner');
  assert.equal(visible.people.find(person=>person.conversationId==='owner'),parent);
  assert.equal(visible.leader,scene.leader);
});

test('Native helpers are smaller in 3D and do not displace real residents at the renderer limit', () => {
  const normal=peopleMesh([{id:'parent',kind:'agent',x:0,y:0}]),small=peopleMesh([{id:'child',kind:'subagent',x:0,y:0,scale:.58}]);
  const maxY=mesh=>Math.max(...Array.from({length:mesh.length/9},(_,index)=>mesh[index*9+1]));
  assert.ok(maxY(small)<maxY(normal)*.75);
  const people=[{id:'far-parent',x:500,y:500},...Array.from({length:20},(_,index)=>({id:'child'+index,kind:'subagent',x:index,y:0}))];
  assert.ok(visiblePeople({people,leader:{id:'viewer',x:0,y:0}},[0,20,0],'overview',3).some(person=>person.id==='far-parent'));
});

test('3D parent badges and helper labels project within the view and hide behind the camera', () => {
  const matrix=multiply(perspective(Math.PI/3,2,.7,1000),lookAt([0,60,100],[0,0,0]));
  const labels=worldDelegateLabels([{x:0,y:0,delegationLabel:'補助 4'},
    {x:20,y:0,kind:'subagent',scale:.58,label:'補助 ?'},
    {x:0,y:300,kind:'subagent',scale:.58,label:'hidden'}],matrix,400,200);
  assert.deepEqual(labels.map(label=>label.text),['補助 4','補助 ?']);
  assert.ok(labels.every(label=>label.x>=0&&label.x<=400&&label.y>=0&&label.y<=200));
  assert.equal(addDelegatesToScene({people:[]},{helpers:[],badges:[]}).people.length,0);
});

test('Identity badges carry actual names, concise roles and owner tethers without adding agents',()=>{
  const input=chat();input.delegation.agents[0].role='画面の使い方を調べる（サンプル）';
  const parent={id:'parent',conversationId:'owner',name:'アルト',x:10,y:20,color:'#aabbcc',delegation:villageDelegation(input)};
  const actors=villageDelegateActors([parent]);
  assert.match(actors.badges[0].label,/主 アルト.*補助 4/);
  assert.match(actors.helpers[0].label,/補 one.*調査/);
  assert.equal(actors.helpers[0].parentX,parent.x);assert.equal(actors.helpers[0].parentY,parent.y);
  assert.equal(actors.helpers[0].parentName,'アルト');
  assert.equal(actors.helpers[0].role,input.delegation.agents[0].role);
  assert.equal(actors.helpers[0].scale,.58);assert.equal(actors.helpers.length,3);
  assert.equal(agentRoleLabel('検証する'),'検証');assert.equal(agentRoleLabel(null),'');
  const scene=addDelegatesToScene({people:[parent]},actors);
  assert.equal(scene.people[0].kind,'agent');
  const matrix=multiply(perspective(Math.PI/3,2,.7,1000),lookAt([0,60,100],[0,0,0]));
  const labels=worldDelegateLabels(scene.people,matrix,400,200);
  assert.equal(labels.find(label=>label.parent).glyph,'shield');
  assert.ok(labels.filter(label=>!label.parent).every(label=>label.glyph==='diamond'&&label.owner));
});

test('Ordinary main agents use a shield alone while focused agents retain their name',()=>{
  const matrix=multiply(perspective(Math.PI/3,2,.7,1000),lookAt([0,60,100],[0,0,0]));
  const main={id:'parent',kind:'agent',x:0,y:0,name:'アルト'};
  const ordinary=worldDelegateLabels([main],matrix,400,200);
  assert.equal(ordinary[0].glyph,'shield');assert.equal(ordinary[0].text,'');
  const focused=worldDelegateLabels([{...main,identityFocused:true}],matrix,400,200);
  assert.equal(focused[0].text,'主 アルト');
});
