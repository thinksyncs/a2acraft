import test from 'node:test';
import assert from 'node:assert/strict';
import {drawRoadNetwork, drawVillageRoadNetwork, villageRoadRects} from '../public/world-road-art.js';

// Observe a few canvas pixels without a browser or a native graphics dependency.
// This catches visible verge/edge bars across crossings, not drawing-call counts.
function sampledCanvas(points) {
  const samples=points.map(([x,y])=>({x,y,color:null}));
  let paths=[],current=[],stack=[];
  return {samples,
    save(){stack.push({strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,lineCap:this.lineCap,lineJoin:this.lineJoin});},
    restore(){Object.assign(this,stack.pop());},
    beginPath(){paths=[];current=[];},
    moveTo(x,y){current=[{x,y}];paths.push(current);},
    lineTo(x,y){current.push({x,y});},
    stroke(){
      for(const p of samples)if(paths.some(path=>path.slice(1).some((b,i)=>{
        const a=path[i],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
        const t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)):0;
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=this.lineWidth/2;
      })))p.color=this.strokeStyle;
    },
    fillRect(x,y,w,h){for(const p of samples)if(p.x>=x&&p.x<x+w&&p.y>=y&&p.y<y+h)p.color=this.fillStyle;},
  };
}
const horizontal={points:[{x:-80,y:0},{x:80,y:0}]};

for(const [name,vertical]of[
  ['T',{points:[{x:0,y:0},{x:0,y:80}]}],
  ['X',{points:[{x:0,y:-80},{x:0,y:80}]}],
])test(`${name} junction keeps the entire crossing walkable in either paint order`,()=>{
  for(const roads of [[horizontal,vertical],[vertical,horizontal]]){
    const ctx=sampledCanvas([[-15,0],[15,0],[0,0],[0,16],[0,40],[60,16],[60,21]]);
    drawRoadNetwork(ctx,roads);
    assert.deepEqual(ctx.samples.map(p=>p.color),[
      '#cbb77b','#cbb77b','#cbb77b','#cbb77b','#cbb77b','#526d3e',null,
    ]);
  }
});

test('a bend has a continuous road surface and saved routes do not gain outlines inside it',()=>{
  const ctx=sampledCanvas([[0,0],[8,-8],[35,0],[0,35]]);
  drawRoadNetwork(ctx,[
    {points:[{x:-80,y:0},{x:0,y:0},{x:0,y:80}]},
    {points:[{x:0,y:0},{x:80,y:0}]},
  ]);
  assert.deepEqual(ctx.samples.map(p=>p.color),Array(4).fill('#cbb77b'));
});

test('village cross streets have no bright or dark boundary across the junction',()=>{
  const ctx=sampledCanvas([[295,400],[324,400],[310,385],[310,414],[295,450]]);
  drawVillageRoadNetwork(ctx,villageRoadRects());
  assert.deepEqual(ctx.samples.map(p=>p.color),[
    '#d0bd86','#d0bd86','#d0bd86','#d0bd86','#e2cc8f',
  ]);
});

test('south exit joins the travel hub and clearing boundary without drawing over the bridge',()=>{
  const south=Array.from({length:70},(_,i)=>[500,570+i]);
  const ctx=sampledCanvas([...south,[885,400]]);
  drawVillageRoadNetwork(ctx,villageRoadRects());
  assert.ok(ctx.samples.slice(0,-1).every(p=>p.color==='#d0bd86'));
  assert.equal(ctx.samples.at(-1).color,null,'river gap belongs to the timber bridge renderer');
});

test('road drawing does not change recorded geometry',()=>{
  const roads=[horizontal,{points:[{x:0,y:0},{x:0,y:80}]}];
  const before=structuredClone(roads);
  drawRoadNetwork(sampledCanvas([]),roads);
  assert.deepEqual(roads,before);
});

test('wide town entrances and narrow lanes keep their shared widths at a junction',()=>{
  const wide={width:40,points:[{x:-80,y:0},{x:80,y:0}]};
  const narrow={width:12,points:[{x:0,y:0},{x:0,y:80}]};
  for(const roads of [[wide,narrow],[narrow,wide]]){
    const ctx=sampledCanvas([[60,19],[60,23],[60,27],[5,60],[8,60],[13,60],[9,3],[-98,0]]);
    drawRoadNetwork(ctx,roads);
    assert.deepEqual(ctx.samples.map(p=>p.color),[
      '#cbb77b','#526d3e',null,'#cbb77b','#526d3e',null,'#cbb77b','#cbb77b',
    ]);
  }
});
