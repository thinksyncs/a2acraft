import test from 'node:test';
import assert from 'node:assert/strict';
import {drawRoadNetwork, drawVillageRoadNetwork, villageRoadRects} from '../public/world-road-art.js';
import {ROAD_SURFACE,ROAD_WEAR,ROAD_EARTH,ROAD_VERGE,ROAD_FEATHER,ROAD_GRAVEL} from '../public/road-material.js';
const earth=new Set([ROAD_SURFACE,ROAD_WEAR,ROAD_EARTH,...ROAD_GRAVEL]);

// Observe a few canvas pixels without a browser or a native graphics dependency.
// This catches visible verge/edge bars across crossings, not drawing-call counts.
function sampledCanvas(points,scale=.2) {
  const samples=points.map(([x,y])=>({x,y,color:null}));
  let paths=[],current=[],stack=[];
  return {samples,strokes:0,stones:0,
    getTransform:()=>({a:scale,b:0,c:0,d:scale,e:0,f:0}),
    save(){stack.push({strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,lineCap:this.lineCap,lineJoin:this.lineJoin});},
    restore(){Object.assign(this,stack.pop());},
    beginPath(){paths=[];current=[];},
    moveTo(x,y){current=[{x,y}];paths.push(current);},
    lineTo(x,y){current.push({x,y});},
    closePath(){},
    fill(){
      for(const point of samples)for(const path of paths){
        let inside=false;
        for(let i=0,j=path.length-1;i<path.length;j=i++){
          const a=path[i],b=path[j];
          if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
        }
        if(inside)point.color=this.fillStyle;
      }
    },
    stroke(){
      this.strokes++;
      for(const p of samples)if(paths.some(path=>path.slice(1).some((b,i)=>{
        const a=path[i],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
        const along=length2?((p.x-a.x)*dx+(p.y-a.y)*dy)/length2:0;
        if(this.lineCap==='butt'&&(along<0||along>1))return false;
        const t=Math.max(0,Math.min(1,along));
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=this.lineWidth/2;
      })))p.color=this.strokeStyle;
    },
    fillRect(x,y,w,h){this.stones++;for(const p of samples)if(p.x>=x&&p.x<x+w&&p.y>=y&&p.y<y+h)p.color=this.fillStyle;},
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
    assert.ok(ctx.samples.slice(0,5).every(p=>earth.has(p.color)),'crossing remains joined earth without grass stripes');
    assert.ok([ROAD_FEATHER,ROAD_VERGE,null].includes(ctx.samples[5].color),'outer shoulder blends into grass');
    assert.equal(ctx.samples[6].color,null);
  }
});

test('a bend has a continuous road surface and saved routes do not gain outlines inside it',()=>{
  const ctx=sampledCanvas([[0,0],[8,-8],[35,0],[0,35]]);
  drawRoadNetwork(ctx,[
    {points:[{x:-80,y:0},{x:0,y:0},{x:0,y:80}]},
    {points:[{x:0,y:0},{x:80,y:0}]},
  ]);
  assert.ok(ctx.samples.every(p=>earth.has(p.color)));
});

test('village cross streets have no bright or dark boundary across the junction',()=>{
  const ctx=sampledCanvas([[295,400],[324,400],[310,385],[310,414],[295,450]]);
  drawVillageRoadNetwork(ctx,villageRoadRects());
  assert.ok(ctx.samples.every(p=>earth.has(p.color)),'junction and exposed lane edge stay earth, without a bright outline');
});

test('south exit joins the travel hub and clearing boundary without drawing over the bridge',()=>{
  const south=Array.from({length:70},(_,i)=>[500,570+i]);
  const ctx=sampledCanvas([...south,[885,400]]);
  drawVillageRoadNetwork(ctx,villageRoadRects());
  assert.ok(ctx.samples.slice(0,-1).every(p=>earth.has(p.color)));
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
    for(const i of [0,3,6,7])assert.ok(earth.has(ctx.samples[i].color),'nominal lane width is intact');
    for(const i of [1,4])assert.ok([ROAD_FEATHER,ROAD_VERGE,null].includes(ctx.samples[i].color),'shoulder has no dark painted border');
    for(const i of [2,5])assert.equal(ctx.samples[i].color,null,'grass beyond the shared lane stays untouched');
  }
});

test('path shoulders vary gently while the worn center remains continuous and deterministic',()=>{
  const points=Array.from({length:81},(_,i)=>[-400+i*10,15]);
  const road={width:25,points:[{x:-420,y:0},{x:420,y:0}]};
  const a=sampledCanvas(points,.4),b=sampledCanvas(points,.4);drawRoadNetwork(a,[road]);drawRoadNetwork(b,[road]);
  assert.deepEqual(a.samples,b.samples);
  assert.ok(new Set(a.samples.map(p=>p.color)).size>1,'grass-to-earth shoulder is irregular along a straight route');
  const centers=sampledCanvas(points.map(([x])=>[x,0]),1);drawRoadNetwork(centers,[road]);
  assert.ok(centers.samples.every(p=>earth.has(p.color)),'wear never cuts a gap in the centerline');
  assert.ok(new Set(centers.samples.map(p=>p.color)).size>1,'nearby earth has patches rather than one solid color');
});

test('gravel disappears at atlas scale and close-view detail has a global budget',()=>{
  const roads=Array.from({length:100},(_,i)=>({points:[{x:0,y:i*80},{x:12000,y:i*80}],width:25}));
  const close=sampledCanvas([],1),far=sampledCanvas([],.2);drawRoadNetwork(close,roads);drawRoadNetwork(far,roads);
  assert.ok(close.stones>0);assert.ok(close.stones<=1400);assert.ok(close.strokes<=roads.length+700);
  assert.equal(far.stones,0);assert.equal(far.strokes,roads.length*4);
});

test('offscreen roads and remote parts of a long road do not consume the visible wear budget',()=>{
  const hidden=Array.from({length:100},(_,i)=>({points:[{x:0,y:i*80},{x:12000,y:i*80}],width:25}));
  const visible={points:[{x:-100000,y:10000},{x:100000,y:10000}],width:25};
  // The camera is far along the final route, after hundreds of offscreen samples.
  const make=()=>{
    const ctx=sampledCanvas(Array.from({length:10},(_,i)=>Array.from({length:25},(_,j)=>[70312.5+i*625,9988+j])).flat(),1);
    ctx.canvas={width:6000,height:200,clientWidth:6000};
    ctx.getTransform=()=>({a:1,b:0,c:0,d:1,e:-70000,f:-9900});return ctx;
  };
  const alone=make(),crowded=make();drawRoadNetwork(alone,[visible]);drawRoadNetwork(crowded,[...hidden,visible]);
  assert.deepEqual(crowded.samples,alone.samples,'distant roads cannot remove visible wear');
  assert.equal(crowded.strokes,alone.strokes,'offscreen routes are discarded before outlines and surfaces');
  assert.ok(crowded.samples.some(p=>p.color===ROAD_WEAR||p.color===ROAD_EARTH),'the visible portion still contains worn patches');
});

test('viewport culling preserves wide shoulders and handles device scaling and rotated cameras',()=>{
  const make=transform=>{
    const ctx=sampledCanvas([[205,50],[210,50]],1);ctx.canvas={width:400,height:200,clientWidth:200};
    ctx.getTransform=()=>transform;return ctx;
  };
  // A centerline just beyond the right edge still contributes its wide shoulder.
  const near={width:40,points:[{x:215,y:0},{x:215,y:100}]};
  const scaled=make({a:2,b:0,c:0,d:2,e:0,f:0});drawRoadNetwork(scaled,[near]);
  assert.ok(scaled.strokes>0);
  const hidden=make({a:2,b:0,c:0,d:2,e:0,f:0});drawRoadNetwork(hidden,[{...near,points:[{x:250,y:0},{x:250,y:100}]}]);
  assert.equal(hidden.strokes,0);
  const rotated=make({a:0,b:2,c:-2,d:0,e:400,f:0});
  drawRoadNetwork(rotated,[{width:25,points:[{x:40,y:20},{x:40,y:180}]}]);
  assert.ok(rotated.strokes>0,'inverse transform retains a visible rotated route');
});
