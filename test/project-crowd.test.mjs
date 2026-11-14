import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDemo,projectDemoJourneys} from '../public/project-demo.js';
import {createResidents} from '../public/project-residents.js';
import {placeDistricts} from '../public/world-geography.js';

function fixture(){
 const demo=projectDemo(), projects=demo.projects.items, chats=demo.chats;
 const places=placeDistricts(projects,chats);
 return {projects,chats,places,journeys:projectDemoJourneys(projects,chats,places),clock:100,moving:0};
}
function storage(t,initial={}){
 const prior=globalThis.localStorage, values=new Map(Object.entries(initial));
 globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 t.after(()=>globalThis.localStorage=prior);
 return values;
}
test('Demo keeps every conversation but sends only two historical residents per district travelling',t=>{
 storage(t); const input=fixture();
 assert.equal(input.chats.length,87); assert.equal(Object.keys(input.journeys).length,6);
 for(const p of input.projects){
  assert.equal(Object.values(input.journeys).filter(j=>j.from===p.id).length,2);
  for(const j of p.jobs)assert(!input.journeys[j.conversationId]);
 }
 const people=createResidents('fresh').get(input);
 assert.equal(people.length,87); assert.equal(people.filter(p=>p.journey).length,6);
 assert.equal(new Set(people.filter(p=>!p.journey).map(p=>p.x+','+p.y)).size,81);
 const groups=new Map(); for(const person of people){const y=Math.round(person.y);groups.set(y,(groups.get(y)||0)+1);}
 assert(Math.max(...groups.values())<20,'no fifty-person line on one road');
});
test('Fresh journey phases depend on identity, not chat array order',t=>{
 storage(t); const input=fixture();
 const a=createResidents('a').get(input).filter(p=>p.journey);
 const b=createResidents('b').get({...input,chats:[...input.chats].reverse()});
 for(const person of a){const other=b.find(p=>p.conversationId===person.conversationId);assert.equal(person.x,other.x);assert.equal(person.y,other.y);}
});
test('A hundred new residents have distinct resting positions and a reload preserves them',t=>{
 const values=storage(t),input=fixture();
 input.chats=Array.from({length:100},(_,i)=>({id:'resident-'+i,project:{id:input.projects[0].id}}));
 input.journeys={};input.clock=2000;input.moving=1;
 const people=createResidents('capacity').get(input);
 assert.equal(new Set(people.map(p=>p.x+','+p.y)).size,100);
 assert(values.has('capacity'));
 const restored=createResidents('capacity').get({...input,chats:[...input.chats].reverse(),moving:0});
 for(const person of people){const again=restored.find(p=>p.conversationId===person.conversationId);assert.equal(again.x,person.x);assert.equal(again.y,person.y);}
});
test('An existing saved journey keeps its route, position and phase when motion is paused',t=>{
 const points=[{x:500,y:610},{x:1800,y:610}], record={signature:JSON.stringify(points),points,progress:300,position:{x:800,y:610},heading:Math.PI/2};
 storage(t,{saved:JSON.stringify({c:record})});
 const input={projects:[{id:'p',repositories:[{id:'r'}],jobs:[]}],chats:[{id:'c',project:{id:'p'}}],places:{p:{x:0,y:0}},journeys:{c:{from:'p',to:'q',points}},clock:100,moving:0};
 const person=createResidents('saved').get(input)[0];
 assert.equal(person.x,800);assert.equal(person.y,610);assert.equal(person.walking,false);assert.equal(person.journey.to,'q');
});
test('Releasing a controlled resident keeps its real final position and resumes its saved destination continuously',t=>{
 const points=[{x:500,y:610},{x:1800,y:610}];
 storage(t,{controlled:JSON.stringify({c:{signature:JSON.stringify(points),points,progress:300,position:{x:800,y:610}}})});
 const input={projects:[{id:'p',repositories:[{id:'r'}],jobs:[]}],chats:[{id:'c',project:{id:'p'}}],places:{p:{x:0,y:0}},journeys:{c:{from:'p',to:'q',points}},clock:100,moving:0};
 const residents=createResidents('controlled'), person=residents.get(input)[0];
 residents.stop(person);assert.equal(residents.get({...input,moving:10})[0].x,800);
 residents.relocate('c',{x:1100,y:800},Math.PI/2);
 const fresh=createResidents('controlled'), released=fresh.get(input)[0];
 assert.equal(released.x,1100);assert.equal(released.y,800);assert.equal(released.journey.to,'q');
 const resumed=fresh.get({...input,moving:1})[0];
 assert(Math.abs(Math.hypot(resumed.x-released.x,resumed.y-released.y)-34)<1e-6);
});
