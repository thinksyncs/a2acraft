import test from 'node:test';
import assert from 'node:assert/strict';
import {mapWheelCamera,createMapInputFrame} from '../public/map-camera-input.js';

const view={width:1200,height:800,baseScale:.7,minZoom:.03,maxZoom:2.5,anchor:{x:930,y:190}};
const start={x:120,y:-90,zoom:.8};
const ground=(camera,anchor=view.anchor)=>({
  x:camera.x+(anchor.x-view.width/2)/(view.baseScale*camera.zoom),
  y:camera.y+(anchor.y-view.height/2)/(view.baseScale*camera.zoom),
});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);

test('trackpad pinch is continuous, responsive and anchored below the cursor',()=>{
  let camera={...start};
  const before=ground(camera);
  for(let i=0;i<20;i++)camera=mapWheelCamera(camera,{ctrlKey:true,deltaY:-3.5},view);
  assert.ok(camera.zoom>start.zoom*2,'a short pinch can approximately double the view');
  const after=ground(camera);close(after.x,before.x);close(after.y,before.y);
  for(let i=0;i<20;i++)camera=mapWheelCamera(camera,{ctrlKey:true,deltaY:3.5},view);
  close(camera.zoom,start.zoom);close(camera.x,start.x);close(camera.y,start.y);
  assert.deepEqual(start,{x:120,y:-90,zoom:.8});
});

test('pinch deltas apply equally as one event or many fractional events without an animation tail',()=>{
  let fragmented={...start};
  for(let i=0;i<100;i++)fragmented=mapWheelCamera(fragmented,{ctrlKey:true,deltaY:-.25},view);
  const single=mapWheelCamera(start,{ctrlKey:true,deltaY:-25},view);
  for(const axis of ['x','y','zoom'])close(fragmented[axis],single[axis]);
  const tiny=mapWheelCamera(start,{ctrlKey:true,deltaY:-.01},view);
  assert.ok(tiny.zoom>start.zoom,'subpixel trackpad input is never rounded away');
});

test('zoom limits stay finite while the cursor anchor is preserved',()=>{
  let camera={...start};const before=ground(camera);
  for(let i=0;i<40;i++)camera=mapWheelCamera(camera,{ctrlKey:true,deltaY:-10000},view);
  close(camera.zoom,view.maxZoom);close(ground(camera).x,before.x);close(ground(camera).y,before.y);
  for(let i=0;i<40;i++)camera=mapWheelCamera(camera,{ctrlKey:true,deltaY:10000},view);
  close(camera.zoom,view.minZoom);close(ground(camera).x,before.x);close(ground(camera).y,before.y);
  const invalid=mapWheelCamera(start,{ctrlKey:true,deltaY:NaN},view);
  for(const axis of ['x','y','zoom'])close(invalid[axis],start[axis]);
});

test('ordinary scroll pans, with line/page units and horizontal shift scroll preserved',()=>{
  const pixels=mapWheelCamera(start,{deltaX:32,deltaY:48},view);
  const lines=mapWheelCamera(start,{deltaX:2,deltaY:3,deltaMode:1},view);
  assert.deepEqual(lines,pixels);assert.equal(lines.zoom,start.zoom);
  close(pixels.x-start.x,32/(start.zoom*view.baseScale));
  close(pixels.y-start.y,48/(start.zoom*view.baseScale));
  const pages=mapWheelCamera(start,{deltaY:1,deltaMode:2},view);
  close(pages.y-start.y,view.height/(start.zoom*view.baseScale));
  const shifted=mapWheelCamera(start,{deltaY:20,shiftKey:true},view);
  assert.equal(shifted.y,start.y);close(shifted.x-start.x,20/(start.zoom*view.baseScale));
});

test('wheel rendering paints the latest state once per frame and cancels stale paints',()=>{
  const pending=new Map(),paints=[];let nextId=0,camera={...start};
  const frames=createMapInputFrame(()=>paints.push({...camera}),callback=>{pending.set(++nextId,callback);return nextId;},id=>pending.delete(id));
  for(let i=0;i<100;i++){camera=mapWheelCamera(camera,{ctrlKey:true,deltaY:-.1},view);frames.request();}
  assert.equal(pending.size,1);assert.equal(paints.length,0);
  const [id,paint]=[...pending][0];pending.delete(id);paint();
  assert.deepEqual(paints,[camera]);assert.equal(pending.size,0);
  frames.request();assert.equal(pending.size,1);frames.cancel();assert.equal(pending.size,0);
  frames.request();assert.equal(pending.size,1,'future gestures remain paintable');
});
