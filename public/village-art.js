import {drawMapBuilding,drawMapPerson,drawMapScenery,drawIntoTerrainBitmap} from './world-map-models.js';
import {projectModel,facilityModel,cottageModel,characterPose} from './world-model-descriptors.js';
import {VILLAGE_PLACES,VILLAGE_WORLD} from './village-world.js';
import {biomeLandmarks} from './world-biomes.js';
import {mainAgentLabel} from './village-delegates.js';
import {drawVillageRoadNetwork, drawRoadNetwork, villageRoadRects} from './world-road-art.js';
import {districtScenery, villageRiverBanks, villageBridge, villageOutskirtsGeometry, villageSurroundingsScenery} from './world-terrain.js';
export {drawWorldHydrology,drawWorldHydrologyOutlets,drawWorldBridges} from './world-hydrology-art.js';

// Original canvas artwork. The settlement occupies a 1000 × 640 clearing in a
// larger world; the caller owns camera and device-pixel scaling.
const WIDTH=1000,HEIGHT=640;
const grass=['#718e4c','#789451','#819b55','#6e8a48','#8b9f5c'];
const clothing=['#cfaa5b','#7895ae','#c36e56','#af8ba3','#789b6c','#e0c7a1','#687b9e','#a6bfb0'];
const objectLayers={project:0,marker:1,resident:2,adventurer:3};
let cachedBackground=null,cachedHomes=-1;
let cachedOutskirts=null;
const surroundingTiles=new Map(),TILE=256,MAX_SURROUNDING_TILES=128;
const islandBackgrounds=new WeakMap();
const integer=value=>Number(value)||0;
const seedOf=value=>{
 if(Number.isFinite(Number(value)))return Number(value)>>>0;
 let result=2166136261;for(const char of String(value??''))result=Math.imul(result^char.charCodeAt(0),16777619);return result>>>0;
};
export function worldPersonColor(item,{hero=false,party=false,index=0,squadSeed}={}){
 if(item.nativeColor||item.color)return item.nativeColor||item.color;
 if(hero)return index===0?'#e7be70':index%2?'#739cb6':'#a17da9';
 if(party)return ['#7ca7ac','#a28cad','#91aa70'][(seedOf(squadSeed)+index)%3];
 return clothing[seedOf(item.seed??item.conversationId)%clothing.length];
}
function random(seed){let value=seed>>>0;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
function rect(ctx,color,x,y,w,h){ctx.fillStyle=color;ctx.fillRect(integer(x),integer(y),integer(w),integer(h));}
function polygon(ctx,color,points){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(integer(x),integer(y)):ctx.moveTo(integer(x),integer(y)));ctx.closePath();ctx.fill();}
function ellipse(ctx,color,x,y,rx,ry){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(integer(x),integer(y),rx,ry,0,0,Math.PI*2);ctx.fill();}
function line(ctx,color,x1,y1,x2,y2,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(integer(x1),integer(y1));ctx.lineTo(integer(x2),integer(y2));ctx.stroke();}

// The same world heading is used by the 3D scene: north is 0, east is PI/2.
// Four pixel profiles keep a conversation's facing readable at map scale.



function tree(ctx,x,y,size=1,tone=0){drawMapScenery(ctx,{kind:'tree',x,y,size,tone});}
function pine(ctx,x,y,size=1){drawMapScenery(ctx,{kind:'pine',x,y,size});}
function rock(ctx,x,y,size=1){drawMapScenery(ctx,{kind:'rock',x,y,size});}
function field(ctx,x,y,w=92,h=48,kind=0){
 rect(ctx,'#586d3c',x-4,y-4,w+8,h+8);rect(ctx,'#685c36',x,y,w,h);
 for(let row=5;row<h;row+=9){
  rect(ctx,'#9a8750',x+3,y+row,w-6,3);
  for(let col=7;col<w;col+=12){
   const color=kind?'#b4a15b':'#6d994d';
   rect(ctx,'#3e6437',x+col-2,y+row-4,7,5);rect(ctx,color,x+col,y+row-6,3,6);
   if(kind)rect(ctx,'#dfc978',x+col-1,y+row-7,5,3);else rect(ctx,'#93ae5a',x+col-2,y+row-4,6,2);
  }
 }
 for(let n=0;n<w;n+=18){rect(ctx,'#c4ae74',x+n,y+h+1,3,8);rect(ctx,'#7a633d',x+n+2,y+h+1,2,8);}
 rect(ctx,'#a48e59',x,y+h+4,w,2);
}
function cottage(ctx,x,y,tone=0){drawMapBuilding(ctx,cottageModel({x,y,tone}));}
function well(ctx,x,y){
 ellipse(ctx,'#3c513660',x+2,y+7,20,7);
 rect(ctx,'#718276',x-12,y-2,24,14);rect(ctx,'#b9b99b',x-14,y-5,28,8);rect(ctx,'#3d696b',x-9,y-5,18,5);
 rect(ctx,'#b1a580',x-12,y+4,10,3);rect(ctx,'#889d8d',x+1,y+7,10,3);
 rect(ctx,'#6e5438',x-16,y-27,4,33);rect(ctx,'#9a774b',x+12,y-27,4,33);
 polygon(ctx,'#715b3e',[[x-24,y-24],[x,y-43],[x+24,y-24],[x+20,y-21],[x-22,y-21]]);
 polygon(ctx,'#ab8652',[[x-21,y-25],[x,y-41],[x+19,y-25]]);rect(ctx,'#cfaa68',x-10,y-29,19,2);
 line(ctx,'#bdad7e',x,y-25,x,y-7,1);rect(ctx,'#9d784c',x-4,y-12,8,6);
}


function tavern(ctx,x,y){drawMapBuilding(ctx,facilityModel({id:'tavern',x,y}));}



function castle(ctx,x,y){drawMapBuilding(ctx,facilityModel({id:'castle',x,y}));}
function weaponShop(ctx,x,y){drawMapBuilding(ctx,facilityModel({id:'weapon',x,y}));}
function drawOutskirts(ctx){
 const outskirts=villageOutskirtsGeometry();
 for(const clearing of outskirts.clearings){
  const {x,y,rx,ry}=clearing,rng=random(clearing.seed);
  for(let i=0;i<18;i++)rng();
  polygon(ctx,clearing.color,clearing.points);
  polygon(ctx,'#8ba05a',clearing.inset);
  for(let i=0;i<350;i++){
   const dx=(rng()*2-1)*rx,dy=(rng()*2-1)*ry;
   if(dx*dx/(rx*rx)+dy*dy/(ry*ry)>.9)continue;
   rect(ctx,['#829951','#91a560','#869c56'][i%3],x+dx,y+dy,3+rng()*8,2+rng()*3);
  }
 }
 drawVillageRoadNetwork(ctx,outskirts.roadRects);
 for(const place of VILLAGE_PLACES){
  if(place.id==='castle')castle(ctx,place.x,place.y);
  else if(place.id==='weapon')weaponShop(ctx,place.x,place.y);
  else if(place.id==='tavern')tavern(ctx,place.x,place.y);
 }
 drawTerrainScenery(ctx,outskirts.landmarks);
}

function drawTerrainScenery(ctx,items){
 for(const item of items){
  if(item.kind==='field')field(ctx,item.x,item.y,item.w,item.h,item.tone);
  else if(item.kind==='cottage')cottage(ctx,item.x,item.y,item.tone);
  else if(item.kind==='well')well(ctx,item.x,item.y);
  else if(item.kind==='tree')tree(ctx,item.x,item.y,item.size,item.tone);
  else if(item.kind==='pine')pine(ctx,item.x,item.y,item.size);
  else if(item.kind==='rock')rock(ctx,item.x,item.y,item.size);
  else if(item.kind==='signpost'){
   const {x,y,width,height,direction}=item,top=y-height;
   rect(ctx,'#715738',x-2,top,4,height);rect(ctx,'#c8a66a',x-width/2,top,width,12);rect(ctx,'#e1c18b',x-width/2,top,width,2);
   if(direction){
    line(ctx,'#715b38',x-11,top+6,x+11,top+6,2);
    line(ctx,'#715b38',x+direction*12,top+6,x+direction*6,top+2,2);
    line(ctx,'#715b38',x+direction*12,top+6,x+direction*6,top+10,2);
   }else{
    line(ctx,'#5f5c47',x-7,top+5,x+7,top+15,2);line(ctx,'#5f5c47',x+7,top+5,x-7,top+15,2);
   }
  }
 }
}

export function drawWorldBiomes(ctx,biomes,{left=-Infinity,right=Infinity,top=-Infinity,bottom=Infinity}={}){
 if(!biomes)return;
 const visible=item=>item.x+item.width>=left&&item.x<=right&&item.y+item.depth>=top&&item.y<=bottom;
 for(const patch of biomes.ground||[])if(visible(patch))rect(ctx,patch.color,patch.x,patch.y,patch.width,patch.depth);
 for(const patch of biomes.scenery||[])if(visible(patch))for(const item of biomeLandmarks(patch)){
  drawMapScenery(ctx,item);
 }
}
function outskirts(ctx){
 if(!cachedOutskirts){
  // A bounded transparent cache covers all three landmarks and connecting roads.
  let canvas;const left=-700,top=-400,width=2420,height=940;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(width,height);
  else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;}
  const context=canvas?.getContext('2d');
  if(context){context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.translate(-left,-top);drawOutskirts(context);cachedOutskirts={canvas,left,top};}
 }
 if(cachedOutskirts)ctx.drawImage(cachedOutskirts.canvas,cachedOutskirts.left,cachedOutskirts.top);
 else drawOutskirts(ctx);
}
function drawTerrain(ctx,homes){
 rect(ctx,'#78924f',0,0,WIDTH,HEIGHT);
 const rng=random(58377);
 polygon(ctx,'#6a8749',[[0,38],[120,24],[300,42],[520,28],[740,45],[1000,30],[1000,80],[790,52],[610,77],[360,54],[160,85],[0,55]]);
 polygon(ctx,'#91a460',[[150,120],[360,92],[720,135],[810,300],[760,580],[510,625],[210,580],[135,360]]);
 polygon(ctx,'#839e55',[[140,165],[200,110],[490,122],[730,155],[780,348],[735,600],[360,607],[147,479]]);
 for(let i=0;i<2300;i++){
  const x=Math.floor(rng()*WIDTH/4)*4,y=Math.floor(rng()*HEIGHT/4)*4;
  rect(ctx,grass[Math.floor(rng()*grass.length)],x,y,3+Math.floor(rng()*8),2+Math.floor(rng()*5));
 }
 // Shallow banks trace a river independently from the village's grid.
 const {left,right}=villageRiverBanks();
 polygon(ctx,'#b5b58b',left.map(([x,y])=>[x-13,y]).concat(right.map(([x,y])=>[x+13,y])));
 polygon(ctx,'#4d8781',left.map(([x,y])=>[x-4,y]).concat(right.map(([x,y])=>[x+4,y])));
 polygon(ctx,'#477d87',left.concat(right));
 polygon(ctx,'#599ba0',left.map(([x,y])=>[x+9,y]).concat(right.map(([x,y])=>[x-20,y])));
 for(let i=0;i<70;i++){const y=8+i*9,x=865+Math.sin(y/110)*20+(i%3)*14;rect(ctx,i%3?'#79b5b0':'#a1ccc0',x,y,8+(i%4)*4,2);}
 // Roads connect every software plot to three broad walking streets.
 drawVillageRoadNetwork(ctx,villageRoadRects());
 // A sheltered public square and a modest timber bridge.
 rect(ctx,'#c1b580',420,386,148,63);rect(ctx,'#d5c695',429,392,130,48);
 for(let y=397;y<439;y+=10)for(let x=434;x<556;x+=15)rect(ctx,'#b4a976',x+(y%20?3:0),y,11,1);
 const bridge=villageBridge;
 rect(ctx,'#4c6353',bridge.x,bridge.y+4,bridge.w,bridge.h+4);rect(ctx,'#907549',bridge.x,bridge.y,bridge.w,bridge.h);
 for(let x=bridge.x+3;x<bridge.x+bridge.w;x+=9){rect(ctx,'#c4a974',x,bridge.y+2,7,32);rect(ctx,'#685539',x+7,bridge.y+2,2,32);}
 for(const y of bridge.railY){rect(ctx,'#755b39',bridge.railX,y,bridge.railWidth,5);for(let x=bridge.railX+4;x<=bridge.railX+bridge.railWidth-8;x+=23)rect(ctx,'#d1b680',x,y-9,4,18);}
 // Gardens and homes are population scenery, never substitute residents.
 drawTerrainScenery(ctx,districtScenery(homes));
 for(let i=0;i<90;i++){
  const x=175+rng()*590,y=80+rng()*510;
  if([230,400,570].some(row=>Math.abs(row-y)<27)||[310,630].some(col=>Math.abs(col-x)<30))continue;
  rect(ctx,'#4d7b3f',x,y,3,4);rect(ctx,i%3?'#e8cc7b':'#e8cfb7',x-1,y-1,3,2);
 }
}
function terrain(ctx,population){
 const homes=Math.min(12,Math.ceil(Math.max(0,population)/8));
 if(!cachedBackground||cachedHomes!==homes){
  let canvas;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(WIDTH,HEIGHT);
  else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;}
  const context=canvas?.getContext('2d');
  if(context){context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';drawTerrain(context,homes);cachedBackground=canvas;cachedHomes=homes;}
 }
 if(cachedBackground&&cachedHomes===homes)ctx.drawImage(cachedBackground,0,0);
 else drawTerrain(ctx,homes);
}
function cellSeed(x,y,salt=0){return (Math.imul(x,73856093)^Math.imul(y,19349663)^salt)>>>0;}
function drawSurroundingRiver(ctx,top,bottom){
 const {left:riverLeft,right:riverRight}=villageRiverBanks(top,bottom);
 polygon(ctx,'#b5b58b',riverLeft.map(([x,y])=>[x-13,y]).concat(riverRight.map(([x,y])=>[x+13,y])));
 polygon(ctx,'#4d8781',riverLeft.map(([x,y])=>[x-4,y]).concat(riverRight.map(([x,y])=>[x+4,y])));
 polygon(ctx,'#477d87',riverLeft.concat(riverRight));
 polygon(ctx,'#599ba0',riverLeft.map(([x,y])=>[x+9,y]).concat(riverRight.map(([x,y])=>[x-20,y])));
 for(let row=Math.floor(top/9)-1;row<=Math.ceil(bottom/9)+1;row++){
  const y=8+row*9,x=865+Math.sin(y/110)*20+((row%3+3)%3)*14;
  rect(ctx,row%3?'#79b5b0':'#a1ccc0',x,y,8+((row%4+4)%4)*4,2);
 }
}
function drawSurroundingTile(ctx,tileX,tileY){
 const left=tileX*TILE,top=tileY*TILE;
 ctx.save();ctx.translate(-left,-top);
 rect(ctx,'#78924f',left,top,TILE,TILE);
 // Sampling a world-aligned grid makes adjacent cached tiles join cleanly.
 for(let gy=Math.floor(top/16)-1;gy<=Math.ceil((top+TILE)/16);gy++){
  for(let gx=Math.floor(left/16)-1;gx<=Math.ceil((left+TILE)/16);gx++){
   const rng=random(cellSeed(gx,gy,72619));
   const x=gx*16+Math.floor(rng()*9),y=gy*16+Math.floor(rng()*9);
   rect(ctx,grass[Math.floor(rng()*grass.length)],x,y,4+Math.floor(rng()*10),3+Math.floor(rng()*5));
   if(rng()>.75){rect(ctx,'#54783f',x+4,y+6,2,4);rect(ctx,'#95a963',x+2,y+5,6,2);}
  }
 }
 drawSurroundingRiver(ctx,top,top+TILE);
 drawTerrainScenery(ctx,villageSurroundingsScenery({left,right:left+TILE,top,bottom:top+TILE}));
 ctx.restore();
}

function drawIslandBackgroundScene(ctx,bounds,population,biomes){
 const {left,right,top,bottom}=bounds;
 rect(ctx,'#78924f',left,top,right-left,bottom-top);
 // Distant grass is a sparse texture; landmarks keep their exact world positions.
 const step=Math.max(96,Math.ceil(Math.max(right-left,bottom-top)/80/96)*96);
 for(let y=Math.floor(top/step)*step;y<bottom;y+=step)for(let x=Math.floor(left/step)*step;x<right;x+=step){
  const seed=cellSeed(x,y,72619);
  rect(ctx,grass[seed%grass.length],x+seed%53,y+(seed>>>6)%43,8,3);
 }
 drawSurroundingRiver(ctx,top,bottom);
 drawWorldBiomes(ctx,biomes,bounds);
 drawTerrainScenery(ctx,villageSurroundingsScenery(VILLAGE_WORLD));
 terrain(ctx,population);drawOutskirts(ctx);
}

// One bounded bitmap replaces hundreds of detailed terrain tiles at overview.
// Coast contents also invalidate it when a live island keeps the same identity.
// Camera position and frame time never regenerate the terrain.
export function drawVillageIslandBackground(ctx,island,{population=0,biomes,viewport}={}){
 const bounds=island.bounds,homes=Math.min(12,Math.ceil(Math.max(0,population)/8));
 const shape=JSON.stringify([bounds,island.coast,island.landPatches,biomes]);
 let cached=islandBackgrounds.get(island);
 if(!cached||cached.homes!==homes||cached.shape!==shape){
  const width=bounds.right-bounds.left,height=bounds.bottom-bounds.top,scale=Math.min(1,1400/Math.max(width,height));
  let canvas;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(Math.ceil(width*scale),Math.ceil(height*scale));
  else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);}
  const context=canvas?.getContext('2d');
  if(context){
   const sx=canvas.width/width,sy=canvas.height/height;
   context.setTransform(sx,0,0,sy,-bounds.left*sx,-bounds.top*sy);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
   drawIntoTerrainBitmap(()=>drawIslandBackgroundScene(context,bounds,population,biomes));
   cached={canvas,homes,shape};islandBackgrounds.set(island,cached);
  }
 }
 if(cached)ctx.drawImage(cached.canvas,bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);
 else drawIslandBackgroundScene(ctx,bounds,population,biomes);
 // The overview bitmap stays bounded; nearby forests and ridges retain their
 // shared model detail when a journey takes the camera outside the village.
 if(cached&&viewport?.zoom>=.25)drawWorldBiomes(ctx,biomes,viewport);
}

// Draw this before drawVillageWorld, with the same camera transform. The map's
// core remains exactly 1000 × 640; wide/tall viewports reveal surrounding land.
export function drawVillageSurroundings(ctx,{left=0,right=WIDTH,top=0,bottom=HEIGHT}={}){
 const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
 const bounds={left:Math.max(-4096,number(left,0)),right:Math.min(WIDTH+4096,number(right,WIDTH)),top:Math.max(-4096,number(top,0)),bottom:Math.min(HEIGHT+4096,number(bottom,HEIGHT))};
 const minX=Math.floor(bounds.left/TILE),maxX=Math.ceil(bounds.right/TILE),minY=Math.floor(bounds.top/TILE),maxY=Math.ceil(bounds.bottom/TILE);
 const reserveTile=()=>{
  if(surroundingTiles.size<MAX_SURROUNDING_TILES)return true;
  // Keep every tile in the current view: FIFO eviction can rebuild an entire
  // tall, zoomed-out viewport on each frame. The cache stays at most 32 MiB.
  for(const key of surroundingTiles.keys()){
   const [x,y]=key.split(',').map(Number);
   if(x<minX||x>=maxX||y<minY||y>=maxY){surroundingTiles.delete(key);return true;}
  }
  // Exceptionally large views paint excess tiles directly instead of
  // allocating and immediately discarding hundreds of offscreen canvases.
  return false;
 };
 ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 for(let ty=minY;ty<maxY;ty++)for(let tx=minX;tx<maxX;tx++){
  const x=tx*TILE,y=ty*TILE;
  if(x>=0&&y>=0&&x+TILE<=WIDTH&&y+TILE<=HEIGHT)continue;
  const key=tx+','+ty;let tile=surroundingTiles.get(key);
  if(!tile&&reserveTile()){
   let canvas;
   if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(TILE,TILE);
   else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=TILE;canvas.height=TILE;}
   const context=canvas?.getContext('2d');
   if(context){
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';drawSurroundingTile(context,tx,ty);tile=canvas;
    surroundingTiles.set(key,tile);
   }
  }
  if(tile)ctx.drawImage(tile,x,y);
  else{ctx.save();ctx.beginPath();ctx.rect(x,y,TILE,TILE);ctx.clip();ctx.translate(x,y);drawSurroundingTile(ctx,tx,ty);ctx.restore();}
 }
 ctx.restore();
}


function project(ctx,item,time,motion,selectedId){
 const model=projectModel(item,{district:Boolean(item.id&&!item.conversationId)});
 if(selectedId===item.conversationId||selectedId===item.id){
  ctx.strokeStyle='#fff1b2';ctx.lineWidth=2;ctx.strokeRect(model.x-model.width/2-5,model.y-model.depth/2-5,model.width+10,model.depth+10);
 }
 drawMapBuilding(ctx,model);
}

function resident(ctx,item,time,motion,selectedId){
 const pose=characterPose({...item,kind:item.kind||'agent',color:worldPersonColor(item)},{time,motion});
 if(selectedId===item.conversationId){ctx.strokeStyle='#fff0ae';ctx.lineWidth=1;ctx.strokeRect(item.x-10,item.y-30,20,34);}
 drawMapPerson(ctx,pose);
}


function questMarker(ctx,squad,time,motion){
 const x=integer(squad.x)+4,y=integer(squad.y);
 const leader=squad.members?.find(member=>member.isLeader)||squad.members?.[0];
 const cloth=worldPersonColor(leader||{},{hero:squad.isProtagonist,party:true,index:0,squadSeed:squad.seed});
 const flutter=motion?Math.sin(time/480+seedOf(squad.seed)%16):0;
 line(ctx,'#695d47',x,y-31,x,y,1.5);
 ctx.fillStyle=cloth;ctx.beginPath();ctx.moveTo(x,y-30);
 ctx.quadraticCurveTo(x+4,y-31,x+12,y-28+flutter);
 ctx.quadraticCurveTo(x+7,y-28+flutter,x,y-23);
 ctx.closePath();ctx.fill();
}
function adventurer(ctx,item,squad,index,time,motion,selectedId){
 const hero=Boolean(squad.isProtagonist),pose=characterPose({...item,hero:hero&&index===0,
  kind:item.conversationId?'agent':'party',color:worldPersonColor(item,{hero,party:true,index,squadSeed:squad.seed})},{time,motion});
 if(selectedId===item.conversationId){ctx.strokeStyle='#fff0ae';ctx.lineWidth=1;ctx.strokeRect(item.x-10,item.y-30,20,34);}
 drawMapPerson(ctx,pose);
}


function identityZoom(ctx){
 const transform=ctx.getTransform?.(),ratio=ctx.canvas?.clientWidth?ctx.canvas.width/ctx.canvas.clientWidth:1;
 return Math.max(.01,transform?Math.hypot(transform.a,transform.b)/ratio:1);
}
function identityBadge(ctx,x,y,label,{helper=false,color='#c5cfb1',compact=false}={}){
 const zoom=identityZoom(ctx);ctx.save();ctx.translate(x,y);ctx.scale(1/zoom,1/zoom);
 ctx.font=helper?'italic 11px sans-serif':'bold 11px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
 let shown=compact?(helper?'補':'主'):label;
 while(ctx.measureText(shown).width>165&&shown.length>3)shown=shown.slice(0,-2)+'…';
 const w=ctx.measureText(shown).width+24,left=-w/2;
 ctx.fillStyle=helper?'#142d2bf2':'#192b2af2';ctx.fillRect(left,-10,w,20);
 ctx.strokeStyle=color;ctx.lineWidth=helper?1:2;ctx.setLineDash?.(helper?[3,2]:[]);ctx.strokeRect(left,-10,w,20);ctx.setLineDash?.([]);
 ctx.beginPath();
 if(helper){ctx.moveTo(left+9,-5);ctx.lineTo(left+14,0);ctx.lineTo(left+9,5);ctx.lineTo(left+4,0);ctx.closePath();ctx.strokeStyle='#e5e5d1';ctx.lineWidth=1.4;ctx.stroke();}
 else{ctx.moveTo(left+4,-5);ctx.lineTo(left+14,-5);ctx.lineTo(left+13,2);ctx.lineTo(left+9,6);ctx.lineTo(left+5,2);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff0bd';ctx.lineWidth=1;ctx.stroke();}
 ctx.fillStyle=helper?'#d6e2dc':'#fff1cc';ctx.fillText(shown,left+19,0);ctx.restore();
}

export function drawWorldAgentIdentity(ctx,item,{badge=true}={}){
 if(item.kind!=='agent')return;
 const color=worldPersonColor(item),x=item.x,y=item.y;
 // A solid shield distinguishes a main session even when its name is hidden.
 polygon(ctx,'#f8e5b0',[[x-9,y-13],[x-3,y-13],[x-4,y-7],[x-6,y-4],[x-8,y-7]]);
 polygon(ctx,color,[[x-8,y-12],[x-4,y-12],[x-5,y-7],[x-6,y-6],[x-7,y-7]]);
 if(badge&&item.identityFocused&&!item.delegation?.total){
  const zoom=identityZoom(ctx);
  identityBadge(ctx,x,y-25-12/zoom,mainAgentLabel(item),{color,compact:zoom<.45});
 }
}

export function drawWorldDelegates(ctx,delegates){
 if(!delegates)return;
 const zoom=identityZoom(ctx),detailed=zoom>=.45;
 // These short dotted tethers identify ownership, not travel paths.
 ctx.save();ctx.lineWidth=1.4/zoom;ctx.setLineDash?.([3/zoom,3/zoom]);
 for(const helper of delegates.helpers){
  if(!Number.isFinite(helper.parentX)||!Number.isFinite(helper.parentY))continue;
  ctx.strokeStyle=helper.color||'#c5cfb1';ctx.globalAlpha=.75;ctx.beginPath();
  ctx.moveTo(helper.parentX,helper.parentY+2);ctx.lineTo(helper.x,helper.y+2);ctx.stroke();
 }
 ctx.restore();
 for(const helper of delegates.helpers){
  ctx.save();ctx.translate(helper.x,helper.y);ctx.scale(helper.scale,helper.scale);
  resident(ctx,{...helper,x:0,y:0,scale:1,nativeColor:helper.color,walking:false},0,false,null);ctx.restore();
  const r=3/zoom;
  ctx.beginPath();ctx.moveTo(helper.x,helper.y-17-r);ctx.lineTo(helper.x+r,helper.y-17);ctx.lineTo(helper.x,helper.y-17+r);ctx.lineTo(helper.x-r,helper.y-17);ctx.closePath();
  ctx.fillStyle='#152d29';ctx.fill();ctx.strokeStyle=helper.statusColor||'#e4e3d4';ctx.lineWidth=1.3/zoom;ctx.stroke();
  if(detailed){
   const slot=helper.clusterIndex||0,lx=helper.x+[-65,65,0][slot]/zoom,ly=helper.y+[20,20,45][slot]/zoom;
   ctx.save();ctx.strokeStyle=helper.color||'#c5cfb1';ctx.lineWidth=1/zoom;ctx.beginPath();ctx.moveTo(helper.x,helper.y+3);ctx.lineTo(lx,ly-10/zoom);ctx.stroke();ctx.restore();
   identityBadge(ctx,lx,ly,helper.label,{helper:true,color:helper.color});
  }
 }
 for(const badge of delegates.badges){
  identityBadge(ctx,badge.x,badge.y-27-12/zoom,badge.label,{color:badge.color,compact:!detailed});
 }
}

// Screen-space conversation markers retain the actors' world coordinates and
// stay readable among a crowd; they never replace, move or remove an actor.
export function villageConversationMarkers({person,leader,name,transform,width,height,measureText,avoid=[]}){
 if(!person||!leader||!transform||!(transform.scale>0))return [];
 const scale=transform.scale,clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
  Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 const markers=[{actor:person,role:'resident',name:name||person.name||'住民',color:'#a7eee6'},
  {actor:leader,role:'leader',name:'リーダー',color:'#ffe49b'}].map(item=>{
   const x=transform.x+item.actor.x*scale,y=transform.y+item.actor.y*scale,
    half=Math.max(12,10*scale),top=Math.max(30,26*scale),bottom=Math.max(9,7*scale);
   return {...item,x,y,body:{left:x-half,right:x+half,top:y-top,bottom:y+bottom}};
  });
 const placed=[];
 for(const marker of markers){
  let text=marker.role==='resident'?'話し相手 · '+marker.name:marker.name;
  const measure=measureText||((text)=>text.length*12);
  while(measure(text)>150&&text.length>4)text=text.slice(0,-2)+'…';
  const w=measure(text)+18,h=24,body=marker.body,other=markers.find(item=>item!==marker),
   outward=marker.x<=other.x?'left':'right';
  const choices={left:{left:body.left-w-8,top:(body.top+body.bottom-h)/2},
   right:{left:body.right+8,top:(body.top+body.bottom-h)/2},
   above:{left:marker.x-w/2,top:body.top-h-8},below:{left:marker.x-w/2,top:body.bottom+8}};
  const candidates=[outward,'above','below',outward==='left'?'right':'left'].map(key=>{
   const point=choices[key],left=clamp(point.left,8,Math.max(8,width-w-8)),top=clamp(point.top,8,Math.max(8,height-h-8));
   return {left,top,right:left+w,bottom:top+h};
  });
  const scores=box=>[markers.reduce((sum,item)=>sum+overlap(box,item.body),0),
   placed.reduce((sum,item)=>sum+overlap(box,item.label),0),avoid.reduce((sum,rect)=>sum+overlap(box,rect),0)];
  candidates.sort((a,b)=>{const aa=scores(a),bb=scores(b);return aa[0]-bb[0]||aa[1]-bb[1]||aa[2]-bb[2];});
  marker.label=candidates[0];marker.text=text;placed.push(marker);
 }
 return markers;
}

export function drawVillageConversationFocus(ctx,options){
 ctx.save();ctx.font='bold 12px sans-serif';
 const markers=villageConversationMarkers({...options,measureText:text=>ctx.measureText(text).width});
 if(markers.length!==2){ctx.restore();return markers;}
 const [person,leader]=markers;
 ctx.strokeStyle='#142a27';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(person.x,person.y+3);ctx.lineTo(leader.x,leader.y+3);ctx.stroke();
 ctx.strokeStyle='#fff0c6';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);
 for(const marker of markers){
  const {x,y,body,label,color,role}=marker,radius=Math.max(10,9*options.transform.scale);
  ctx.strokeStyle='#142a27';ctx.lineWidth=5;ctx.beginPath();
  if(role==='resident')ctx.ellipse(x,y+2,radius,radius*.5,0,0,Math.PI*2);
  else{ctx.moveTo(x-radius,y+2);ctx.lineTo(x,y-5);ctx.lineTo(x+radius,y+2);ctx.lineTo(x,y+9);ctx.closePath();}
  ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  // Corner brackets make the exact body distinguishable without painting over it.
  ctx.beginPath();
  for(const [xx,yy,dx,dy] of [[body.left,body.top,1,1],[body.right,body.top,-1,1],
   [body.left,body.bottom,1,-1],[body.right,body.bottom,-1,-1]]){
   ctx.moveTo(xx+dx*5,yy);ctx.lineTo(xx,yy);ctx.lineTo(xx,yy+dy*5);
  }
  ctx.stroke();
  const anchorX=Math.max(label.left,Math.min(label.right,x)),anchorY=Math.max(label.top,Math.min(label.bottom,(body.top+body.bottom)/2));
  ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(anchorX,anchorY);ctx.lineTo(x,(body.top+body.bottom)/2);ctx.stroke();
  ctx.fillStyle='#142b29';ctx.fillRect(label.left,label.top,label.right-label.left,label.bottom-label.top);
  ctx.strokeRect(label.left,label.top,label.right-label.left,label.bottom-label.top);
  ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(marker.text,(label.left+label.right)/2,(label.top+label.bottom)/2);
 }
 ctx.restore();return markers;
}

export function drawVillageWorld(ctx,{time=0,residents=[],projects=[],population=0,selectedId=null,motion=true,squads=[],protagonist=null,outskirtsVisible=true,terrainVisible=true,delegates=null,roads=[],clearings=[]}={}){
 ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 if(terrainVisible){terrain(ctx,population);if(outskirtsVisible)outskirts(ctx);}
 drawWorldSettlement(ctx,{clearings},{layer:'ground'});
 drawRoadNetwork(ctx,roads,{edgeWidth:35,width:25});
 const clock=motion?time:0;
 const groups=Array.isArray(squads)?[...squads]:[];
 if(protagonist&&!groups.some(squad=>squad.id===protagonist.id||protagonist.activityId&&squad.id===protagonist.activityId))groups.push({...protagonist,isProtagonist:true});
 // Depth sorting lets villagers pass behind roofs and in front of doorsteps.
 const objects=[...projects.map(value=>({type:'project',value})),...residents.map(value=>({type:'resident',value}))];
 for(const squad of groups){
  objects.push({type:'marker',value:squad});
  for(const [index,member]of(Array.isArray(squad.members)?squad.members:[]).entries())objects.push({type:'adventurer',value:{...member,x:Number.isFinite(member.x)?member.x:squad.x-12-index*12,y:Number.isFinite(member.y)?member.y:squad.y+index*6},squad,index});
 }
 objects.sort((a,b)=>(a.value.y||0)-(b.value.y||0)||objectLayers[a.type]-objectLayers[b.type]);
 for(const {type,value,squad,index} of objects){
  if(type==='project')project(ctx,value,clock,motion,selectedId);
  else if(type==='marker')questMarker(ctx,value,clock,motion);
  else if(type==='adventurer')adventurer(ctx,value,squad,index,clock,motion,selectedId);
  else resident(ctx,value,clock,motion,selectedId);
 }
 drawWorldDelegates(ctx,delegates);
 if(motion&&terrainVisible){
  for(let i=0;i<9;i++){const y=54+i*67,x=864+Math.sin(y/105)*19+((clock/250+i*13)%42);rect(ctx,'#add7c66b',x,y,9,1);}
 }
 ctx.restore();
}

// A settlement is a set of dry, terrain-shaped clearings and landmarks. The
// project map owns the shared river and street network; no 1000x640 stamp is
// painted here. The optional layers let roads sit below buildings and trees.
export function drawWorldSettlement(ctx,settlement,{left=-Infinity,right=Infinity,top=-Infinity,bottom=Infinity,layer='all'}={}){
 if(!settlement)return;
 const visible=(x,y,rx=0,ry=rx)=>x+rx>=left&&x-rx<=right&&y+ry>=top&&y-ry<=bottom;
 if(layer!=='scenery')for(const clearing of settlement.clearings||[]){
  if(Array.isArray(clearing.patches)){
   for(const patch of clearing.patches)if(['left','right','top','bottom'].every(key=>Number.isFinite(patch[key]))&&
    patch.left<patch.right&&patch.top<patch.bottom&&patch.right>=left&&patch.left<=right&&patch.bottom>=top&&patch.top<=bottom)
    rect(ctx,clearing.color||'#829650',patch.left,patch.top,patch.right-patch.left,patch.bottom-patch.top);
   continue;
  }
  const points=(clearing.points||[]).filter(point=>Array.isArray(point)&&point.slice(0,2).every(Number.isFinite));
  if(points.length<3)continue;
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  if(maxX<left||minX>right||maxY<top||minY>bottom)continue;
  polygon(ctx,clearing.color||'#829650',points);
  if(clearing.inset?.length>=3)polygon(ctx,'#8ba05a',clearing.inset);
 }
 if(layer!=='ground')drawTerrainScenery(ctx,(settlement.scenery||[]).filter(item=>visible(item.x,item.y,
  item.kind==='field'?(item.w||item.width||92):55,item.kind==='field'?(item.h||item.depth||48):80))
  .sort((a,b)=>a.y-b.y||a.x-b.x));
}

export function drawDevelopmentLandscape(ctx,{left,right,top,bottom,zoom=1,scenery,biomes}){
 const step=Math.max(180,Math.ceil(40/zoom/180)*180);
 ctx.fillStyle='#6e8a48';ctx.fillRect(left,top,right-left,bottom-top);
 for(let y=Math.floor(top/step)*step;y<bottom;y+=step)for(let x=Math.floor(left/step)*step;x<right;x+=step){
  const seed=seedOf(x+':'+y);rect(ctx,'#819b5544',x+seed%80,y+(seed>>>4)%80,35,2);
  if(!Array.isArray(scenery)){
   if(seed%4===0)for(let n=0;n<3;n++)tree(ctx,x+25+n*18,y+45+n*6,.9,seed%2);
   else if(seed%7===0)rock(ctx,x+60,y+50,.8);
  }
 }
 drawWorldBiomes(ctx,biomes,{left,right,top,bottom});
 if(Array.isArray(scenery))for(const item of scenery){
  if(item.x+24<left||item.x-24>right||item.y+12<top||item.y-64>bottom)continue;
  if(item.kind==='tree')tree(ctx,item.x,item.y,item.size,item.tone);
  else if(item.kind==='pine')pine(ctx,item.x,item.y,item.size);
  else if(item.kind==='rock')rock(ctx,item.x,item.y,item.size);
 }
}

export function drawWorldPerson(ctx,item,{hero=false,index=0,time=0,motion=true}={}){
 if(hero)adventurer(ctx,item,{isProtagonist:true,seed:'hero'},index,time,motion,null);
 else resident(ctx,item,time,motion,null);
 drawWorldAgentIdentity(ctx,item);
}
export function drawWorldFacility(ctx,item){drawMapBuilding(ctx,facilityModel(item,{district:true}));}
