import test from 'node:test';
import assert from 'node:assert/strict';
import {drawVillageIslandBackground,drawVillageWorld} from '../public/village-art.js';
import {villageIsland} from '../public/village-3d-scene.js';

const context = () => {
  const calls=[],stack=[];let matrix={a:1,b:0,c:0,d:1,e:0,f:0};
  const ctx=new Proxy({calls,measureText:text=>({width:String(text).length*6}),
    getTransform:()=>({...matrix}),
    setTransform(a,b,c,d,e,f){matrix={a,b,c,d,e,f};calls.push({key:'setTransform',args:[a,b,c,d,e,f]});},
    scale(x,y){matrix.a*=x;matrix.d*=y;calls.push({key:'scale',args:[x,y]});},
    translate(x,y){matrix.e+=matrix.a*x;matrix.f+=matrix.d*y;calls.push({key:'translate',args:[x,y]});},
    save(){stack.push({...matrix});calls.push({key:'save',args:[]});},
    restore(){matrix=stack.pop()||matrix;calls.push({key:'restore',args:[]});}},{
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
  assert.ok(building.calls.some(call=>call.key==='fill')||building.calls.some(call=>call.key==='drawImage'),
    'the current construction model still draws above the cached land');
  assert.ok(building.calls.some(call=>call.key==='translate'&&call.args[0]===230&&call.args[1]===156),
    'the construction model is anchored at its shared project coordinates');
  assert.ok(building.calls.filter(call=>call.key==='drawImage').length<=1,
    'only a cached building sprite may be painted; static terrain is not painted a second time');
});

test('close cameras paint the same river and forest at village resolution across the southern border',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas'),allocated=[];
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;this.context=context();allocated.push(this);}
    getContext(){return this.context;}
  }
  Object.defineProperty(globalThis,'OffscreenCanvas',{value:Canvas,configurable:true});
  t.after(()=>original?Object.defineProperty(globalThis,'OffscreenCanvas',original):delete globalThis.OffscreenCanvas);
  const island=structuredClone(villageIsland()),overview=context(),close=context();
  drawVillageIslandBackground(overview,island,{population:8});
  const atlas=overview.calls.find(call=>call.key==='drawImage').args[0];
  const viewport={left:400,right:1150,top:440,bottom:940,zoom:1};
  drawVillageIslandBackground(close,island,{population:8,viewport});
  const images=close.calls.filter(call=>call.key==='drawImage');
  assert.ok(!images.some(call=>call.args[0]===atlas),'the close view never enlarges the whole-island thumbnail');
  const woods=images.find(call=>call.args[1]<-900&&call.args[2]<-900);
  assert.ok(woods&&woods.args.length===3,'nearby woods are drawn at native world scale');
  assert.ok(close.calls.some(call=>call.key==='lineTo'&&call.args[1]>640&&call.args[0]>800&&call.args[0]<1000),
    'the real river bank continues south of the 640-unit village seam');
  const next=context(),count=allocated.length;
  drawVillageIslandBackground(next,island,{population:8,viewport:{...viewport,top:620,bottom:1120}});
  assert.ok(next.calls.some(call=>call.key==='drawImage'&&call.args[0]===woods.args[0]),'moving the camera reuses the high-resolution forest');
  assert.equal(allocated.length,count);
});

test('a conversation clearing shades each dry patch without painting outside its reserved footprint',()=>{
  const screen=context(),stops=[],drawn=[];
  screen.createRadialGradient=()=>({addColorStop:(at,color)=>stops.push([at,color])});
  screen.fillRect=(x,y,w,h)=>{
    const m=screen.getTransform();
    drawn.push([m.a*x+m.e,m.d*y+m.f,m.a*w,m.d*h]);
  };
  const patches=[{left:85,right:133,top:115,bottom:131},
    {left:69,right:149,top:131,bottom:177},{left:85,right:133,top:177,bottom:193}];
  drawVillageWorld(screen,{terrainVisible:false,motion:false,clearings:[{
    id:'conversation-clearing:a',kind:'clearing',color:'#829650',patches}]});
  assert.deepEqual(stops[0],[0,'#829650']);
  assert.deepEqual(stops.at(-1),[1,'#78924f']);
  assert.deepEqual(drawn.map(row=>row.map(Math.round)),patches.map(p=>[p.left,p.top,p.right-p.left,p.bottom-p.top]));
});
