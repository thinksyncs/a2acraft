import test from 'node:test';
import assert from 'node:assert/strict';
import {drawVillageIslandBackground,drawVillageWorld} from '../public/village-art.js';
import {villageIsland} from '../public/village-3d-scene.js';

const context = () => {
  const calls=[];
  const ctx=new Proxy({calls,measureText:text=>({width:String(text).length*6})},{
    get:(target,key)=>key in target?target[key]:(...args)=>calls.push({key,args}),
  });
  return ctx;
};

test('distant village terrain builds one bounded bitmap and reuses it across frames and cameras',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas'),allocated=[];
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;this.context=context();allocated.push(this);}
    getContext(){return this.context;}
  }
  Object.defineProperty(globalThis,'OffscreenCanvas',{value:Canvas,writable:true,configurable:true});
  t.after(()=>original?Object.defineProperty(globalThis,'OffscreenCanvas',original):delete globalThis.OffscreenCanvas);
  const island=structuredClone(villageIsland()),screen=context();
  drawVillageIslandBackground(screen,island,{population:87});
  const count=allocated.length,operations=allocated.reduce((sum,c)=>sum+c.context.calls.length,0);
  assert.ok(count>0&&count<=2,'background plus the existing village-core cache, never hundreds of tile canvases');
  assert.ok(allocated.every(c=>c.width<=1400&&c.height<=1400),'bitmap dimensions are bounded');
  for(let i=0;i<24;i++){
    screen.setTransform(.08+i*.002,0,0,.08+i*.002,i*9,i*-7);
    drawVillageIslandBackground(screen,island,{population:88});
  }
  assert.equal(allocated.length,count,'panning and repeated frames do not allocate terrain');
  assert.equal(allocated.reduce((sum,c)=>sum+c.context.calls.length,0),operations,'static artwork is not regenerated');
  const images=screen.calls.filter(call=>call.key==='drawImage');
  assert.equal(images.length,25,'each frame paints a single static image');
  const bounds=island.bounds;
  for(const call of images)assert.deepEqual(call.args.slice(1),[bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top]);
  drawVillageIslandBackground(screen,island,{population:89});
  assert.ok(allocated.length>count,'new homes invalidate the static image');
  const afterHomes=allocated.length;
  island.coast=structuredClone(island.coast);
  island.coast[0].x+=2;
  drawVillageIslandBackground(screen,island,{population:89});
  assert.ok(allocated.length>afterHomes,'a changed coast invalidates an island object reused by the caller');
  const afterShape=allocated.length;
  drawVillageIslandBackground(screen,island,{population:89});
  assert.equal(allocated.length,afterShape,'the updated coast is cached again');
});

test('foreground rendering can omit static terrain without omitting current project buildings',()=>{
  const empty=context();
  drawVillageWorld(empty,{terrainVisible:false,motion:false});
  assert.equal(empty.calls.filter(call=>call.key==='drawImage'||call.key==='fillRect').length,0);
  const building=context();
  drawVillageWorld(building,{terrainVisible:false,motion:false,projects:[{
    conversationId:'work',title:'工房',stage:'building',seed:7,x:230,y:180,
  }]});
  assert.ok(building.calls.some(call=>call.key==='fillRect'),'current construction state still draws above the cached land');
  assert.equal(building.calls.filter(call=>call.key==='drawImage').length,0,'static terrain is not painted a second time');
});
