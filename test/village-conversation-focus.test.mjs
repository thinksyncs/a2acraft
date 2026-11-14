import test from 'node:test';
import assert from 'node:assert/strict';
import {villageConversationMarkers,drawVillageConversationFocus} from '../public/village-art.js';
import {villageSpeechPlacement} from '../public/village-3d-scene.js';

const person={id:'resident:village-demo-17',conversationId:'village-demo-17',name:'トア',x:522.5402352941177,y:228},
 leader={id:'party:protagonist:0',x:501.410353842755,y:264.29777003965063};
const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
function options(width=1304,height=628,scale=1){return {person,leader,name:person.name,width,height,
 transform:{x:width/2-person.x*scale,y:height/2-person.y*scale,scale},measureText:text=>text.length*12};}

test('conversation markers track the real pair without changing any actor identity or position',()=>{
 const input=options(),before=structuredClone({person,leader}),markers=villageConversationMarkers(input);
 assert.equal(markers.length,2);
 assert.equal(markers[0].actor,person);assert.equal(markers[1].actor,leader);
 assert.deepEqual(markers.map(marker=>marker.role),['resident','leader']);
 assert.equal(markers[0].text,'話し相手 · トア');assert.equal(markers[1].text,'リーダー');
 for(const marker of markers){
  assert.equal(marker.x,input.transform.x+marker.actor.x*input.transform.scale);
  assert.equal(marker.y,input.transform.y+marker.actor.y*input.transform.scale);
  for(const other of markers)assert.equal(overlap(marker.label,other.body),0,'names must not cover either face');
 }
 assert.equal(overlap(markers[0].label,markers[1].label),0);
 assert.deepEqual({person,leader},before);
});

test('speech avoids both actual body bounds and names on wide, portrait and short views',()=>{
 for(const [width,height,scale] of [[1304,628,1],[320,568,.8],[690,640,1],[390,300,.8]]){
  const markers=villageConversationMarkers(options(width,height,scale)),bubbleWidth=Math.min(288,width-24);
  const protectedAreas=markers.flatMap(marker=>[marker.body,marker.label]);
  const avoid=width>1000?[{left:width-350,right:width-12,top:70,bottom:350}]:[];
  const result=villageSpeechPlacement({width,height,bubbleWidth,bubbleHeight:220,people:markers,protectedAreas,avoid});
  const box={...result,right:result.left+bubbleWidth,bottom:result.top+result.maxHeight};
  assert.ok(box.left>=8&&box.top>=8&&box.right<=width-8&&box.bottom<=height-8,'card stays in the map');
  for(const actor of protectedAreas)assert.equal(overlap(box,actor),0,`${width}×${height}: card must not cover the pair or their names`);
  for(const inset of avoid)assert.equal(overlap(box,inset),0,'leader eye remains visible');
  if(height===300)assert.ok(result.maxHeight<220,'a short card scrolls instead of covering the pair');
 }
});

test('long resident names remain bounded and separate from the leader label',()=>{
 const input={...options(320,568,.8),name:'とても長い名前を持っている会話相手の住民'};
 const markers=villageConversationMarkers(input);
 assert.ok(markers[0].text.endsWith('…'));
 for(const marker of markers){assert.ok(marker.label.left>=8&&marker.label.right<=312);assert.ok(marker.label.right-marker.label.left<=168);}
 assert.equal(overlap(markers[0].label,markers[1].label),0);
});

test('focus paint adds named markers after the crowd while leaving all world data untouched',()=>{
 const input=options(),before=structuredClone({...input,measureText:undefined}),calls=[];
 const ctx=new Proxy({measureText:text=>({width:text.length*12})},{get:(object,key)=>key in object?object[key]:(...args)=>calls.push({key,args})});
 const markers=drawVillageConversationFocus(ctx,input);
 assert.equal(markers.length,2);
 assert.deepEqual(calls.filter(call=>call.key==='fillText').map(call=>call.args[0]),['話し相手 · トア','リーダー']);
 assert.ok(calls.some(call=>call.key==='ellipse'),'resident has a round marker');
 assert.ok(calls.some(call=>call.key==='closePath'),'leader has a diamond marker');
 assert.equal(calls.filter(call=>call.key==='clearRect').length,0,'the crowd is never erased');
 assert.deepEqual({...input,measureText:undefined},{...before,measureText:undefined});
});
