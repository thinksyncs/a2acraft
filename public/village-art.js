import {VILLAGE_PLACES,VILLAGE_WORLD} from './village-world.js';
import {biomeLandmarks} from './world-biomes.js';
import {mainAgentLabel} from './village-delegates.js';
import {drawVillageRoadNetwork, villageRoadRects} from './world-road-art.js';
import {districtScenery, villageRiverBanks, villageBridge, villageOutskirtsGeometry, villageSurroundingsScenery} from './world-terrain.js';
export {drawWorldHydrology,drawWorldHydrologyOutlets,drawWorldBridges} from './world-hydrology-art.js';

// Original canvas artwork. The settlement occupies a 1000 × 640 clearing in a
// larger world; the caller owns camera and device-pixel scaling.
const WIDTH=1000,HEIGHT=640;
const grass=['#718e4c','#789451','#819b55','#6e8a48','#8b9f5c'];
const roofColors=[['#a9563b','#c6734b','#e19359'],['#416a71','#5c9292','#86b3a7'],['#77724c','#a09562','#d0bd7c'],['#665774','#8e7192','#b89cb4']];
const skinColors=['#e0b182','#c59367','#ad7853','#efd0a0'];
const clothing=['#cfaa5b','#7895ae','#c36e56','#af8ba3','#789b6c','#e0c7a1','#687b9e','#a6bfb0'];
const objectLayers={project:0,marker:1,resident:2,adventurer:3};
let cachedBackground=null,cachedHomes=-1;
let cachedOutskirts=null;
const surroundingTiles=new Map(),TILE=256,MAX_SURROUNDING_TILES=128;
const islandBackgrounds=new WeakMap();
const integer=value=>Math.round(Number(value)||0);
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
function personFacing(item){
 if(Number.isFinite(item.heading)){
  const dx=Math.sin(item.heading),dy=-Math.cos(item.heading);
  return Math.abs(dx)>Math.abs(dy)?dx>=0?'right':'left':dy>=0?'down':'up';
 }
 return ['up','right','down','left'].includes(item.direction)?item.direction:'down';
}
function personFace(ctx,item,x,y,skin,hair,highlight){
 const facing=personFacing(item),eyes='#283c34';
 rect(ctx,skin,x-3,y,6,6);
 if(facing==='up'){
  rect(ctx,hair,x-3,y,6,5);rect(ctx,skin,x-1,y+5,2,1);
  return;
 }
 rect(ctx,hair,x-3,y,6,2);
 if(facing==='down'){
  rect(ctx,eyes,x-2,y+2,1,1);rect(ctx,eyes,x+1,y+2,1,1);
  rect(ctx,highlight,x-1,y+4,2,1);
 }else{
  const side=facing==='left'?-1:1;
  rect(ctx,hair,side<0?x+1:x-3,y+1,2,4);
  rect(ctx,eyes,side<0?x-2:x+1,y+2,1,1);
  rect(ctx,highlight,side<0?x-4:x+3,y+3,1,2);
 }
}

function tree(ctx,x,y,size=1,tone=0){
 ctx.save();ctx.translate(integer(x),integer(y));ctx.scale(size,size);
 ellipse(ctx,'#28483155',3,4,15,6);
 rect(ctx,'#71533b',-3,-12,6,17);rect(ctx,'#9e7850',-2,-10,2,14);
 const dark=tone?'#365b3d':'#2c553a',mid=tone?'#557849':'#467044',light=tone?'#719452':'#64884c';
 polygon(ctx,dark,[[-17,-11],[-18,-23],[-10,-31],[-12,-39],[-3,-45],[7,-43],[12,-35],[18,-28],[17,-15],[10,-8]]);
 polygon(ctx,mid,[[-16,-24],[-9,-31],[-8,-38],[1,-43],[10,-35],[10,-29],[15,-24],[10,-13],[0,-10],[-9,-15]]);
 polygon(ctx,light,[[-11,-30],[-7,-36],[1,-40],[8,-34],[8,-30],[12,-25],[3,-23],[-4,-27]]);
 rect(ctx,'#8ba55d',-5,-34,7,4);rect(ctx,'#77974e',-13,-23,6,4);rect(ctx,'#244c37',8,-16,6,5);
 ctx.restore();
}
function pine(ctx,x,y,size=1){
 ctx.save();ctx.translate(integer(x),integer(y));ctx.scale(size,size);
 ellipse(ctx,'#28483166',3,4,13,5);rect(ctx,'#6c5038',-2,-8,5,12);
 polygon(ctx,'#294b3e',[[-18,-5],[-11,-20],[-14,-20],[-7,-33],[-9,-33],[0,-51],[9,-33],[7,-33],[15,-20],[11,-20],[18,-5]]);
 polygon(ctx,'#426a49',[[-13,-8],[-7,-22],[-10,-22],[-3,-35],[0,-48],[5,-33],[3,-33],[10,-20],[7,-20],[13,-8]]);
 polygon(ctx,'#6b8952',[[-3,-36],[0,-47],[4,-34],[0,-30]]);line(ctx,'#57794c',-8,-19,5,-19,2);line(ctx,'#537448',-11,-7,7,-7,2);
 ctx.restore();
}
function rock(ctx,x,y,size=1){
 ctx.save();ctx.translate(integer(x),integer(y));ctx.scale(size,size);
 polygon(ctx,'#4b6553',[[-10,2],[-10,-5],[-5,-13],[4,-14],[11,-7],[13,2],[5,7],[-5,6]]);
 polygon(ctx,'#a1aa8a',[[-9,-5],[-4,-12],[4,-12],[9,-7],[6,-1],[-3,1]]);
 polygon(ctx,'#7d9073',[[6,-1],[10,-6],[12,1],[5,5],[-2,4],[-3,1]]);ctx.restore();
}
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
function cottage(ctx,x,y,tone=0){
 ellipse(ctx,'#34492d55',x+3,y+3,25,8);
 polygon(ctx,'#34492d26',[[x-17,y+3],[x+18,y+3],[x+29,y+10],[x-8,y+10]]);
 rect(ctx,'#6f6543',x-19,y-25,38,29);rect(ctx,'#d5c18a',x-17,y-24,34,26);
 rect(ctx,'#9f9670',x-18,y+1,36,4);rect(ctx,'#c9bc91',x-17,y+1,15,1);rect(ctx,'#675f46',x+4,y+2,1,3);
 rect(ctx,'#9b8557',x+8,y-23,9,25);rect(ctx,'#5c5941',x-5,y-12,10,16);rect(ctx,'#806746',x-3,y-10,6,14);
 rect(ctx,'#3f6766',x-13,y-17,7,7);rect(ctx,'#dfce91',x-11,y-16,2,5);
 const palette=roofColors[tone%roofColors.length];
 polygon(ctx,palette[0],[[x-26,y-25],[x,y-47],[x+25,y-25],[x+22,y-20],[x-25,y-20]]);
 polygon(ctx,palette[1],[[x-24,y-26],[x,y-45],[x+20,y-26],[x+18,y-24],[x-24,y-24]]);
 line(ctx,palette[2],x-18,y-30,x+14,y-30,2);line(ctx,palette[0],x-10,y-35,x+8,y-35,2);
 for(const [dx,dy] of [[-13,-29],[-3,-29],[7,-29],[-5,-34],[4,-34]])rect(ctx,palette[0],x+dx,y+dy,1,3);
 rect(ctx,'#aa9870',x+12,y-45,6,15);rect(ctx,'#d6c39a',x+11,y-45,8,3);
}
function well(ctx,x,y){
 ellipse(ctx,'#3c513660',x+2,y+7,20,7);
 rect(ctx,'#718276',x-12,y-2,24,14);rect(ctx,'#b9b99b',x-14,y-5,28,8);rect(ctx,'#3d696b',x-9,y-5,18,5);
 rect(ctx,'#b1a580',x-12,y+4,10,3);rect(ctx,'#889d8d',x+1,y+7,10,3);
 rect(ctx,'#6e5438',x-16,y-27,4,33);rect(ctx,'#9a774b',x+12,y-27,4,33);
 polygon(ctx,'#715b3e',[[x-24,y-24],[x,y-43],[x+24,y-24],[x+20,y-21],[x-22,y-21]]);
 polygon(ctx,'#ab8652',[[x-21,y-25],[x,y-41],[x+19,y-25]]);rect(ctx,'#cfaa68',x-10,y-29,19,2);
 line(ctx,'#bdad7e',x,y-25,x,y-7,1);rect(ctx,'#9d784c',x-4,y-12,8,6);
}
function flowerBed(ctx,x,y,w){
 rect(ctx,'#657340',x-2,y-2,w+4,19);rect(ctx,'#647f42',x,y,w,14);
 for(let n=4;n<w;n+=9){rect(ctx,'#3e633c',x+n,y+3,4,7);rect(ctx,n%3?'#ddbd78':'#d9c5a3',x+n-1,y+2,6,3);}
 rect(ctx,'#b4a56c',x-2,y+14,w+4,3);
}
function lantern(ctx,x,y){
 rect(ctx,'#655037',x,y-32,3,34);rect(ctx,'#a38953',x-5,y-31,13,3);
 rect(ctx,'#4e5943',x-3,y-29,9,11);rect(ctx,'#edc97d',x-1,y-27,5,7);rect(ctx,'#fff0bb',x,y-26,2,5);
}
function tavern(ctx,x,y){
 // A public house with a long warm roof and a shaded outdoor terrace.
 ellipse(ctx,'#354b3555',x+8,y+6,106,23);
 rect(ctx,'#6a6143',x-78,y-75,156,82);rect(ctx,'#ddc796',x-74,y-74,148,77);
 rect(ctx,'#b49a6b',x+42,y-74,32,77);
 for(const dx of [-74,-36,35,70])rect(ctx,'#73553a',x+dx,y-74,5,78);
 for(const dy of [-67,-33,-2])rect(ctx,'#886340',x-74,y+dy,148,5);
 for(const dx of [-54,54]){
  rect(ctx,'#644e38',x+dx-11,y-58,23,30);rect(ctx,'#eac477',x+dx-8,y-55,17,23);
  rect(ctx,'#fff0ac',x+dx-6,y-53,6,18);rect(ctx,'#926a42',x+dx-1,y-56,3,26);rect(ctx,'#926a42',x+dx-10,y-43,22,3);
  rect(ctx,'#e4c698',x+dx-13,y-29,27,4);
 }
 rect(ctx,'#594a35',x-15,y-33,30,39);rect(ctx,'#9b7447',x-11,y-29,22,34);
 rect(ctx,'#b39359',x-9,y-26,5,30);rect(ctx,'#efce7b',x+5,y-13,3,3);
 rect(ctx,'#8e8564',x-23,y+4,46,5);rect(ctx,'#c9bd8d',x-27,y+9,54,6);
 polygon(ctx,'#5b4635',[[x-94,y-75],[x-56,y-126],[x+55,y-126],[x+94,y-75],[x+88,y-66],[x-91,y-66]]);
 polygon(ctx,'#93482f',[[x-90,y-77],[x-55,y-123],[x+54,y-123],[x+89,y-77],[x+84,y-71],[x-89,y-71]]);
 polygon(ctx,'#ba6240',[[x-87,y-78],[x-54,y-121],[x+47,y-121],[x+75,y-77],[x+72,y-74],[x-87,y-74]]);
 for(let dy=-114;dy<-76;dy+=8){const inset=(-dy-75)*.7;line(ctx,'#d18953',x-86+inset,y+dy,x+74-inset,y+dy,2);}
 line(ctx,'#e7a66b',x-55,y-124,x+55,y-124,3);rect(ctx,'#d7b37e',x-90,y-70,179,4);
 rect(ctx,'#9c9577',x+46,y-139,15,43);rect(ctx,'#ded0a5',x+43,y-142,21,6);rect(ctx,'#64664f',x+46,y-143,15,3);
 // A small gabled door canopy and the hanging tankard sign identify the inn.
 polygon(ctx,'#734c32',[[x-28,y-30],[x,y-49],[x+29,y-30],[x+26,y-26],[x-27,y-26]]);
 polygon(ctx,'#c28c52',[[x-25,y-31],[x,y-47],[x+24,y-31]]);
 rect(ctx,'#775334',x+82,y-53,4,61);rect(ctx,'#aa8351',x+80,y-54,33,4);
 line(ctx,'#655438',x+93,y-51,x+93,y-42,2);line(ctx,'#655438',x+107,y-51,x+107,y-42,2);
 rect(ctx,'#5c4932',x+87,y-43,26,24);rect(ctx,'#c7a16a',x+89,y-41,22,20);
 rect(ctx,'#725231',x+94,y-37,10,12);rect(ctx,'#e8d1a0',x+95,y-38,8,3);rect(ctx,'#eee0b9',x+104,y-35,4,8);rect(ctx,'#b88542',x+97,y-34,2,8);
 for(const dx of [-128,125]){
  rect(ctx,'#7b5d38',x+dx-17,y+30,34,5);rect(ctx,'#be985a',x+dx-18,y+29,36,3);
  rect(ctx,'#795b36',x+dx-12,y+13,24,14);rect(ctx,'#d0ad6b',x+dx-15,y+10,30,7);
  rect(ctx,'#8c7344',x+dx-18,y+3,36,4);rect(ctx,'#e0c88d',x+dx-4,y+9,5,5);
 }
 flowerBed(ctx,x-78,y+15,42);flowerBed(ctx,x+35,y+15,42);
 lantern(ctx,x-34,y+43);lantern(ctx,x+34,y+43);
}
function battlements(ctx,x,y,width){
 rect(ctx,'#555f58',x-3,y-3,width+6,12);rect(ctx,'#aaa990',x,y,width,10);rect(ctx,'#d5ccaa',x,y,width,3);
 for(let dx=0;dx<width;dx+=15){rect(ctx,'#858d7c',x+dx,y-11,10,12);rect(ctx,'#d2c9a7',x+dx,y-12,10,4);rect(ctx,'#b8b49a',x+dx,y-8,6,8);}
}
function stoneWall(ctx,x,y,width,height){
 rect(ctx,'#667469',x,y,width,height);rect(ctx,'#a0a58e',x+3,y+1,width-6,height-2);rect(ctx,'#b7b59b',x+4,y+1,Math.max(1,width-15),height-2);
 for(let dy=10;dy<height;dy+=12){line(ctx,'#87917c',x+4,y+dy,x+width-4,y+dy,1);for(let dx=(dy%24?8:19);dx<width-5;dx+=23)line(ctx,'#939b84',x+dx,y+dy-10,x+dx,y+dy,1);}
}
function banner(ctx,x,y,color='#527f9a'){
 rect(ctx,'#585743',x-3,y-5,26,4);rect(ctx,'#d0b274',x-4,y-6,28,2);
 polygon(ctx,color,[[x,y],[x+19,y],[x+19,y+35],[x+10,y+29],[x,y+35]]);rect(ctx,'#86a3ae',x,y,3,29);
 polygon(ctx,'#e7d5a0',[[x+9,y+8],[x+12,y+14],[x+16,y+16],[x+12,y+19],[x+9,y+25],[x+6,y+19],[x+3,y+16],[x+6,y+14]]);
}
function castle(ctx,x,y){
 ellipse(ctx,'#35473566',x+8,y+5,151,34);
 // The keep rises behind two courtyard walls; all doors lead to the road.
 stoneWall(ctx,x-61,y-169,122,113);battlements(ctx,x-63,y-173,126);
 for(const dx of [-34,26]){rect(ctx,'#566e6c',x+dx-5,y-145,11,28);rect(ctx,'#829897',x+dx-3,y-142,4,21);}
 rect(ctx,'#576452',x-2,y-226,3,45);polygon(ctx,'#49778d',[[x+1,y-225],[x+36,y-219],[x+28,y-209],[x+1,y-213]]);line(ctx,'#b0c0ad',x+3,y-223,x+30,y-218,2);
 stoneWall(ctx,x-113,y-99,226,98);battlements(ctx,x-116,y-103,232);
 // A dark arched passage stays readable as the building's entrance.
 polygon(ctx,'#51584b',[[x-27,y+2],[x-27,y-42],[x-21,y-57],[x-11,y-65],[x+11,y-65],[x+21,y-57],[x+27,y-42],[x+27,y+2]]);
 polygon(ctx,'#293c39',[[x-21,y+2],[x-21,y-40],[x-15,y-52],[x-7,y-58],[x+7,y-58],[x+15,y-52],[x+21,y-40],[x+21,y+2]]);
 for(let dx=-17;dx<=17;dx+=7){rect(ctx,'#8b8868',x+dx,y-53+Math.abs(dx)/2,2,20);}
 rect(ctx,'#c9bd94',x-31,y+2,62,6);rect(ctx,'#b2a77e',x-37,y+8,74,7);
 for(const side of [-1,1]){
  const tx=x+side*106;
  stoneWall(ctx,tx-26,y-145,52,148);battlements(ctx,tx-29,y-149,58);
  rect(ctx,'#586e69',tx-5,y-119,10,25);rect(ctx,'#d2c9a7',tx-7,y-121,14,3);rect(ctx,'#586e69',tx-5,y-58,10,23);
  rect(ctx,'#728174',tx+17,y-137,7,137);rect(ctx,'#d5c9a4',tx-26,y-6,52,6);
  banner(ctx,x+side*59-9,y-79);
 }
 for(const side of [-1,1]){
  flowerBed(ctx,x+side*89-22,y+24,44);lantern(ctx,x+side*47,y+45);
  rect(ctx,'#a0a68d',x+side*151-8,y+5,16,18);rect(ctx,'#d7ceac',x+side*151-12,y+1,24,6);rect(ctx,'#7d8c78',x+side*151-6,y-15,12,17);
  polygon(ctx,'#c7c5a4',[[x+side*151-9,y-14],[x+side*151,y-28],[x+side*151+9,y-14]]);
 }
}
function weaponShop(ctx,x,y){
 // A stone forge, a blue slate roof and crossed steel identify the skill shop.
 ellipse(ctx,'#34473566',x+6,y+8,126,29);
 stoneWall(ctx,x-89,y-88,178,91);
 rect(ctx,'#5b5440',x-92,y+2,184,7);rect(ctx,'#c5b68b',x-95,y+9,190,6);
 polygon(ctx,'#354b50',[[x-108,y-85],[x-64,y-139],[x+62,y-139],[x+108,y-85],[x+101,y-76],[x-104,y-76]]);
 polygon(ctx,'#4b6c74',[[x-104,y-86],[x-63,y-135],[x+57,y-135],[x+97,y-85],[x+94,y-80],[x-102,y-80]]);
 for(let dy=-128;dy<-83;dy+=9){const inset=(-dy-82)*.78;line(ctx,'#779299',x-102+inset,y+dy,x+95-inset,y+dy,2);}
 line(ctx,'#a7b7ac',x-64,y-139,x+62,y-139,4);rect(ctx,'#ae9d71',x-104,y-77,208,5);
 // The tall chimney and orange hearth are scenery, not a simulated worker.
 stoneWall(ctx,x-72,y-159,23,81);rect(ctx,'#515c53',x-76,y-166,31,9);rect(ctx,'#c5b99a',x-77,y-166,33,4);
 polygon(ctx,'#5b5140',[[x-74,y+2],[x-74,y-35],[x-68,y-48],[x-57,y-55],[x-44,y-48],[x-38,y-35],[x-38,y+2]]);
 polygon(ctx,'#9a482b',[[x-69,y],[x-69,y-31],[x-64,y-43],[x-56,y-47],[x-47,y-40],[x-43,y-30],[x-43,y]]);
 polygon(ctx,'#dc8039',[[x-68,y-1],[x-65,y-21],[x-60,y-14],[x-58,y-37],[x-50,y-24],[x-47,y-3]]);
 polygon(ctx,'#ffcf6b',[[x-63,y-2],[x-60,y-18],[x-56,y-9],[x-53,y-26],[x-49,y-2]]);
 rect(ctx,'#e7b75c',x-71,y+2,32,4);rect(ctx,'#7a694b',x-79,y+6,49,7);
 // The front door and brass trim align with the navigable doorway.
 rect(ctx,'#4b4f3d',x-15,y-44,30,49);rect(ctx,'#876b45',x-11,y-40,22,44);
 rect(ctx,'#b08b56',x-9,y-38,5,41);rect(ctx,'#d2b16b',x-14,y-46,28,5);rect(ctx,'#f0d28b',x+5,y-19,3,3);
 rect(ctx,'#cfc39c',x-23,y+5,46,5);rect(ctx,'#9a9474',x-27,y+10,54,7);
 rect(ctx,'#535a48',x+37,y-56,30,32);rect(ctx,'#d2b970',x+41,y-52,22,24);rect(ctx,'#f0d291',x+43,y-50,8,19);
 rect(ctx,'#7e7250',x+50,y-54,3,28);rect(ctx,'#7e7250',x+39,y-41,26,3);rect(ctx,'#b7aa80',x+34,y-25,35,4);
 // Hammer and anvil in the forge yard.
 rect(ctx,'#645136',x-130,y+12,34,17);rect(ctx,'#a28350',x-128,y+14,29,13);
 polygon(ctx,'#465861',[[x-142,y-5],[x-104,y-5],[x-96,y-1],[x-106,y+4],[x-109,y+12],[x-130,y+12],[x-132,y+4],[x-146,y+1]]);
 polygon(ctx,'#a7b5b2',[[x-143,y-5],[x-103,y-5],[x-97,y-1],[x-143,y-1]]);rect(ctx,'#7b9293',x-127,y+3,15,7);
 line(ctx,'#a28049',x-117,y-7,x-107,y-19,3);rect(ctx,'#bec6b8',x-111,y-24,14,7);rect(ctx,'#60787b',x-110,y-18,12,3);
 // A display rack with swords, a spear and a shield stands beside the shop.
 for(const dx of [110,150]){rect(ctx,'#6b5136',x+dx,y-45,5,72);rect(ctx,'#aa8651',x+dx,y-45,2,68);}
 rect(ctx,'#876339',x+106,y-37,51,5);rect(ctx,'#b2965e',x+106,y-37,51,2);
 for(const [dx,dy]of[[117,-58],[132,-54]]){
  rect(ctx,'#b5c4be',x+dx,y+dy,4,32);polygon(ctx,'#e5e8cf',[[x+dx,y+dy],[x+dx+2,y+dy-7],[x+dx+4,y+dy],[x+dx+2,y+dy+23]]);
  rect(ctx,'#d7b76d',x+dx-5,y+dy+31,14,3);rect(ctx,'#866443',x+dx,y+dy+34,4,11);
 }
 line(ctx,'#9f7d4c',x+150,y-6,x+151,y-70,3);polygon(ctx,'#c7d0bd',[[x+146,y-69],[x+152,y-85],[x+157,y-69],[x+152,y-64]]);
 polygon(ctx,'#516f79',[[x+129,y+7],[x+151,y+7],[x+151,y+26],[x+140,y+36],[x+129,y+26]]);line(ctx,'#d1b275',x+140,y+9,x+140,y+29,3);line(ctx,'#d1b275',x+132,y+18,x+148,y+18,3);
 // Hanging crossed-sword sign can be read even at the small map scale.
 rect(ctx,'#705435',x+86,y-69,4,73);rect(ctx,'#a7854f',x+84,y-71,34,5);
 rect(ctx,'#5b4c34',x+94,y-60,29,28);rect(ctx,'#b29961',x+96,y-58,25,24);
 line(ctx,'#e4e5c8',x+101,y-54,x+116,y-39,3);line(ctx,'#d1dfcc',x+116,y-54,x+101,y-39,3);
 line(ctx,'#4c5b52',x+98,y-43,x+105,y-36,2);line(ctx,'#4c5b52',x+112,y-36,x+119,y-43,2);
 for(const [dx,dy,s]of[[-157,30,.65],[-143,36,.5],[-159,42,.45]])rock(ctx,x+dx,y+dy,s);
 lantern(ctx,x-30,y+44);lantern(ctx,x+30,y+44);
}
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
  const {x,y,width:w,height:h}=item;
  if(item.kind==='biome-tree'){
   rect(ctx,'#6b543b',x-w*.05,y-h*.23,w*.1,h*.25);
   polygon(ctx,'#274e38',[[x-w*.5,y-h*.22],[x-w*.4,y-h*.73],[x,y-h],[x+w*.4,y-h*.73],[x+w*.5,y-h*.22]]);
   polygon(ctx,item.tone?'#547b49':'#467346',[[x-w*.33,y-h*.3],[x-w*.26,y-h*.69],[x,y-h*.9],[x+w*.25,y-h*.67],[x+w*.29,y-h*.3]]);
   rect(ctx,'#6b8b51',x-w*.16,y-h*.65,w*.27,h*.12);
  }else{
   polygon(ctx,'#746c57',[[x-w*.5,y],[x,y-h],[x+w*.5,y]]);
   polygon(ctx,'#b8ad88',[[x-w*.5,y],[x,y-h],[x-w*.06,y-h*.15]]);
   polygon(ctx,'#d3ccb0',[[x-w*.15,y-h*.7],[x,y-h],[x+w*.14,y-h*.72],[x+w*.04,y-h*.66],[x-w*.03,y-h*.75]]);
  }
 }
}
function outskirts(ctx){
 if(!cachedOutskirts){
  // A bounded transparent cache covers all three landmarks and connecting roads.
  let canvas;const left=-700,top=-400,width=2420,height=940;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(width,height);
  else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;}
  const context=canvas?.getContext('2d');
  if(context){context.imageSmoothingEnabled=false;context.translate(-left,-top);drawOutskirts(context);cachedOutskirts={canvas,left,top};}
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
 drawVillageRoadNetwork(ctx,villageRoadRects(),({x,y,w,h})=>{
  const rng=random(integer(x*103+y*71));
  for(let i=0;i<Math.floor(w*h/75);i++){
   const px=x+Math.floor(rng()*Math.max(1,w-7)),py=y+Math.floor(rng()*Math.max(1,h-4));
   rect(ctx,rng()>.45?'#bdac79':'#dccb96',px,py,3+Math.floor(rng()*5),2);
  }
 });
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
  if(context){context.imageSmoothingEnabled=false;drawTerrain(context,homes);cachedBackground=canvas;cachedHomes=homes;}
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
   context.setTransform(sx,0,0,sy,-bounds.left*sx,-bounds.top*sy);context.imageSmoothingEnabled=false;
   drawIslandBackgroundScene(context,bounds,population,biomes);
   cached={canvas,homes,shape};islandBackgrounds.set(island,cached);
  }
 }
 if(cached)ctx.drawImage(cached.canvas,bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);
 else drawIslandBackgroundScene(ctx,bounds,population,biomes);
 // The overview bitmap stays bounded; nearby forests and ridges retain their
 // original pixel outlines when a journey takes the camera outside the village.
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
 ctx.save();ctx.imageSmoothingEnabled=false;
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
    context.imageSmoothingEnabled=false;drawSurroundingTile(context,tx,ty);tile=canvas;
    surroundingTiles.set(key,tile);
   }
  }
  if(tile)ctx.drawImage(tile,x,y);
  else{ctx.save();ctx.beginPath();ctx.rect(x,y,TILE,TILE);ctx.clip();ctx.translate(x,y);drawSurroundingTile(ctx,tx,ty);ctx.restore();}
 }
 ctx.restore();
}
function timber(ctx,x,y,w,h){rect(ctx,'#614c34',x,y,w,h);if(w>h)rect(ctx,'#b28b58',x,y,w,2);else rect(ctx,'#b28b58',x,y,2,h);}
function scaffold(ctx,x,y,finished=false){
 const top=finished?-70:-61;
 for(const side of [-1,1]){
  timber(ctx,x+side*44,y+top,4,-top+12);timber(ctx,x+side*34,y+top+6,3,-top+3);
  line(ctx,'#a48654',x+side*42,y+top+7,x+side*34,y-5,3);
 }
 for(const yy of [-51,-27,-2])timber(ctx,x-48,y+yy,97,4);
 for(let xx=-40;xx<42;xx+=11)rect(ctx,'#d5b17a',x+xx,y-28,9,2);
}
function house(ctx,x,y,seed,testing=false){
 const type=seed%4,palette=roofColors[type],left=x-35,right=x+35;
 ellipse(ctx,'#3c4d3155',x+5,y+8,48,13);
 polygon(ctx,'#2d413526',[[left,y+5],[right,y+5],[right+19,y+18],[left+17,y+18]]);
 rect(ctx,'#5f6548',left-3,y-42,76,51);rect(ctx,'#cabb89',left,y-43,70,47);
 rect(ctx,'#e1cfa1',left,y-42,48,42);rect(ctx,'#b09b71',x+15,y-42,20,46);
 rect(ctx,'#7d6947',left,y-43,5,48);rect(ctx,'#a28555',x+13,y-43,4,48);rect(ctx,'#816a46',right-3,y-43,4,48);
 rect(ctx,'#9a7c4c',left,y-21,70,4);rect(ctx,'#6b6248',left,y+2,70,5);
 // Weathered plaster and a stone sill retain the compact pixel silhouette.
 for(const [dx,dy] of [[-27,-37],[-13,-11],[19,-37],[25,-9]]){
  rect(ctx,'#b6a67d',x+dx,y+dy,4,1);rect(ctx,'#ead8ad',x+dx+1,y+dy+1,3,1);
 }
 for(let dx=-34;dx<34;dx+=12){rect(ctx,'#b4ac8a',x+dx,y+3,10,2);rect(ctx,'#7d7c60',x+dx+10,y+3,1,4);}
 for(const wx of [-22,24]){
  rect(ctx,'#756748',x+wx-8,y-32,16,18);rect(ctx,testing?'#669a9d':'#e5c66f',x+wx-6,y-30,12,14);
  rect(ctx,'#435b57',x+wx,y-30,2,14);rect(ctx,'#9f8b5c',x+wx-6,y-24,12,2);
  rect(ctx,'#dac292',x+wx-9,y-14,18,3);
 }
 rect(ctx,'#6c5b41',x-8,y-18,17,24);rect(ctx,'#9d7c4c',x-5,y-16,11,22);rect(ctx,'#c9ac68',x+3,y-6,2,2);
 polygon(ctx,'#554b3e',[[x-48,y-44],[x,y-81],[x+48,y-44],[x+45,y-36],[x-46,y-36]]);
 polygon(ctx,palette[0],[[x-46,y-45],[x,y-79],[x+45,y-44],[x+42,y-40],[x-45,y-40]]);
 polygon(ctx,palette[1],[[x-43,y-46],[x,y-77],[x+32,y-47],[x+30,y-43],[x-43,y-43]]);
 for(let yy=-69;yy<=-47;yy+=7){const half=(yy+78)*1.1;line(ctx,palette[2],x-half,y+yy,x+half-7,y+yy,2);
  for(let xx=-half+5+(yy%2)*3;xx<half-8;xx+=10)line(ctx,palette[0],x+xx,y+yy+2,x+xx+2,y+yy+6,1);
 }
 line(ctx,palette[0],x+1,y-77,x+41,y-43,3);rect(ctx,'#e5c28b',x-44,y-40,86,3);
 rect(ctx,'#9b997b',x+22,y-81,9,26);rect(ctx,'#d5ceb0',x+20,y-83,13,5);rect(ctx,'#5c665b',x+22,y-84,9,2);
 if(type===1){
  rect(ctx,'#617e77',left-9,y-12,18,16);rect(ctx,'#d2b67a',left-10,y-13,20,4);
  for(let i=0;i<3;i++)rect(ctx,'#c7d0ae',left-7+i*5,y-10,3,12);
 }else if(type===2){
  rect(ctx,'#a17b44',x-42,y+5,17,7);rect(ctx,'#d4bd7c',x-40,y+3,13,4);
  rect(ctx,'#d1a54d',x-43,y-4,6,8);rect(ctx,'#b6c27a',x-34,y-2,6,6);
 }else if(type===3){
  rect(ctx,'#8a6a42',x+34,y-5,16,11);rect(ctx,'#c9a56a',x+35,y-4,14,3);line(ctx,'#615537',x+40,y-4,x+40,y+6,2);
 }
 if(!testing){
  for(const fx of [-45,44]){rect(ctx,'#4b783e',x+fx,y-1,7,5);rect(ctx,seed%2?'#e1bd74':'#d7c2a4',x+fx+1,y-3,4,3);}
  line(ctx,'#ad8d55',x-48,y+13,x+48,y+13,3);
  for(const px of [-48,-30,30,48]){rect(ctx,'#8d734c',x+px,y+6,3,12);rect(ctx,'#e0c28a',x+px,y+6,3,2);}
 }
}
function project(ctx,item,time,motion,selectedId){
 const x=integer(item.x),y=integer(item.y),seed=seedOf(item.seed??item.conversationId),stage=item.stage||'planned';
 // A worn building plot blends into its existing clearing instead of looking
 // like a second rectangular terrain tile laid over the settlement.
 polygon(ctx,'#708044',[[x-50,y-32],[x-37,y-39],[x+40,y-36],[x+52,y-23],[x+49,y+17],[x-39,y+20],[x-52,y+8]]);
 polygon(ctx,'#9d9a64',[[x-45,y-29],[x-34,y-35],[x+37,y-32],[x+47,y-21],[x+43,y+14],[x-36,y+16],[x-47,y+5]]);
 for(let i=0;i<8;i++){const dx=((seed+i*29)%83)-41,dy=((seed+i*17)%43)-27;rect(ctx,i%3?'#a7a06b':'#8e9460',x+dx,y+dy,3,1);}
 if(selectedId===item.conversationId||selectedId===item.id){
  ctx.strokeStyle='#fff1b2';ctx.lineWidth=3;ctx.strokeRect(x-56,y-85,112,106);
 }
 if(stage==='planned'){
  rect(ctx,'#aeb07a',x-35,y-32,70,35);rect(ctx,'#8b8d60',x-30,y-27,60,26);
  ctx.strokeStyle='#ddd4a2';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.strokeRect(x-37,y-35,74,41);ctx.setLineDash([]);
  for(const [dx,dy] of [[-39,-37],[37,-37],[-39,5],[37,5]]){rect(ctx,'#775d3b',x+dx,y+dy-11,4,16);rect(ctx,'#dfbe82',x+dx,y+dy-12,5,3);}
  rect(ctx,'#5b756f',x-11,y-17,24,14);rect(ctx,'#c5d8bc',x-9,y-15,20,10);line(ctx,'#6e9f9a',x-6,y-9,x+8,y-9,1);line(ctx,'#6e9f9a',x,y-13,x,y-6,1);
  timber(ctx,x+26,y+12,23,4);timber(ctx,x+31,y+7,19,4);
 }else if(stage==='building'){
  rect(ctx,'#6d6c4b',x-36,y-34,72,42);rect(ctx,'#c3b78c',x-34,y-31,68,35);
  for(const dx of [-31,-2,28])timber(ctx,x+dx,y-61,5,66);
  timber(ctx,x-33,y-56,65,5);timber(ctx,x-35,y-33,70,5);timber(ctx,x-35,y-13,70,4);
  line(ctx,'#7e5e3c',x-32,y-57,x,y-78,5);line(ctx,'#b59660',x,y-78,x+33,y-57,5);
  rect(ctx,'#c6b184',x-32,y-31,23,31);rect(ctx,'#9d855b',x+7,y-17,25,20);
  scaffold(ctx,x,y);
  rect(ctx,'#7e6850',x-57,y-9,17,17);rect(ctx,'#b8a07d',x-57,y-11,18,5);rect(ctx,'#a78e64',x+37,y+4,21,6);
 }else{
  house(ctx,x,y,seed,stage==='testing');
  if(stage==='testing'){
   timber(ctx,x+44,y-59,3,70);timber(ctx,x+52,y-59,3,70);
   for(let n=-55;n<9;n+=9)timber(ctx,x+44,y+n,11,2);
   rect(ctx,'#698b86',x-49,y-8,17,20);rect(ctx,'#d8ddbd',x-47,y-6,13,15);
   line(ctx,'#6f9483',x-45,y-2,x-36,y-2,2);line(ctx,'#6f9483',x-45,y+3,x-38,y+3,2);
  }else{
   rect(ctx,'#927d4e',x-45,y-54,3,29);
   polygon(ctx,'#e7ce83',[[x-42,y-54],[x-28,y-51],[x-42,y-45]]);
   if(motion&&seed%3===0){const t=(time/1700+seed%9)%3;ellipse(ctx,'#e6e1c04d',x+26+t*3,y-88-t*6,3+t,3+t);}
  }
 }
 if(item.activity==='working'&&motion){
  const phase=Math.floor(time/300+seed)%6;
  if(phase<2){rect(ctx,'#ffe3a2',x+33,y-39-phase*3,3,3);rect(ctx,'#e9c366',x+39,y-35-phase*3,2,2);}
 }
}
function resident(ctx,item,time,motion,selectedId){
 const x=integer(item.x),y=integer(item.y),seed=seedOf(item.seed??item.conversationId),walk=Boolean(item.walking&&motion);
 const step=walk?Math.floor(time/170+seed)%2:0,bob=step?1:0;
 const shirt=worldPersonColor(item),skin=skinColors[(seed>>>3)%skinColors.length],hair=['#4f4936','#805a36','#a68a52','#53544b'][(seed>>>5)%4];
 ellipse(ctx,'#233d3355',x,y+1,5,2);
 if(selectedId===item.conversationId){ctx.strokeStyle='#fff0ae';ctx.lineWidth=1;ctx.strokeRect(x-7,y-17,14,20);}
 rect(ctx,'#414c44',x-3,y-3,3,4-step);rect(ctx,'#414c44',x+1,y-3,3,3+step);
 rect(ctx,'#394c42',x-4,y-10-bob,8,8);rect(ctx,shirt,x-3,y-10-bob,6,7);
 personFace(ctx,item,x,y-15-bob,skin,hair,'#eed8b2');
 rect(ctx,shirt,x-5,y-9-bob,2,4);rect(ctx,skin,x-5,y-5-bob,2,2);rect(ctx,skin,x+4,y-8-bob,2,3);
 if(item.kind==='subagent'){
  polygon(ctx,shirt,[[x-5,y-16-bob],[x,y-25-bob],[x+5,y-16-bob]]);
  line(ctx,'#eee6cf',x-4,y-16-bob,x+4,y-16-bob,1);
 }else if(seed%5===0){rect(ctx,'#b9a469',x-5,y-17-bob,10,2);rect(ctx,'#d8bc7b',x-3,y-20-bob,6,3);}
 else if(item.appearance==='mage'){polygon(ctx,'#627b9d',[[x-4,y-16-bob],[x,y-23-bob],[x+3,y-16-bob]]);rect(ctx,'#92a4b1',x-5,y-16-bob,10,2);}
 else if(item.appearance==='priest'){rect(ctx,'#dfd4b2',x-4,y-17-bob,8,3);rect(ctx,'#d3c7a2',x+3,y-14-bob,2,4);}
 if(item.activity==='working'){
  rect(ctx,'#89613d',x+4,y-9-bob,5,5);rect(ctx,'#d2aa6b',x+4,y-10-bob,6,3);
 }else if(item.activity==='attention'){
  rect(ctx,'#f1d18e',x,y-24,2,4);rect(ctx,'#f1d18e',x,y-18,2,2);
 }
}

function questMarker(ctx,squad,time,motion,selectedSquadId){
 const x=integer(squad.x),y=integer(squad.y),hero=Boolean(squad.isProtagonist),state=squad.motion||'waiting';
 const colors=hero?['#ae8745','#f0cc80','#ffedba']:state==='returned'?['#517855','#9cbd7b','#dfebad']:state==='working'?['#a57440','#e2b775','#ffdf9a']:state==='paused'?['#7a6d79','#ba9fa9','#e5c9ca']:['#456b77','#8bb2b6','#d1e6d3'];
 const sway=motion&&['working','gathering'].includes(state)?Math.floor(time/400+seedOf(squad.seed))%2:0;
 ellipse(ctx,'#263d3155',x+2,y+1,10,4);
 rect(ctx,'#634b33',x-2,y-38,3,40);rect(ctx,'#c3a367',x-1,y-38,1,38);
 rect(ctx,colors[0],x-8,y-38,24,18);rect(ctx,colors[1],x-7,y-37,21,14);
 polygon(ctx,colors[0],[[x+13,y-37],[x+18+sway,y-35],[x+14,y-30],[x+18+sway,y-24],[x+12,y-24]]);
 rect(ctx,colors[2],x-7,y-37,21,2);rect(ctx,'#fff6cf33',x-6,y-34,18,1);
 const ink=hero?'#6f5937':'#34514b';
 if(hero){
  polygon(ctx,ink,[[x+3,y-35],[x+5,y-31],[x+9,y-30],[x+6,y-28],[x+7,y-24],[x+3,y-26],[x-1,y-24],[x,y-28],[x-3,y-30],[x+1,y-31]]);
 }else if(state==='returned'){
  line(ctx,ink,x-2,y-30,x+2,y-26,2);line(ctx,ink,x+2,y-26,x+9,y-33,2);
 }else if(state==='paused'){
  rect(ctx,ink,x-1,y-34,3,9);rect(ctx,ink,x+5,y-34,3,9);
 }else if(state==='working'){
  line(ctx,ink,x-1,y-25,x+7,y-33,2);line(ctx,ink,x-2,y-33,x+7,y-26,2);rect(ctx,ink,x+5,y-35,5,4);
 }else if(state==='gathering'){
  line(ctx,ink,x-2,y-30,x+7,y-30,2);line(ctx,ink,x+4,y-34,x+8,y-30,2);line(ctx,ink,x+4,y-26,x+8,y-30,2);
 }else{
  rect(ctx,ink,x-1,y-34,9,2);rect(ctx,ink,x-1,y-26,9,2);polygon(ctx,ink,[[x,y-32],[x+7,y-32],[x+4,y-29],[x+7,y-27],[x,y-27],[x+3,y-29]]);
 }
 rect(ctx,colors[2],x-3,y-41,5,4);
 if(selectedSquadId===squad.id){ctx.strokeStyle='#fff0b0';ctx.lineWidth=2;ctx.strokeRect(x-11,y-44,32,28);}
}
function adventurer(ctx,item,squad,index,time,motion,selectedId){
 const x=integer(item.x),y=integer(item.y),seed=seedOf(item.seed??item.conversationId),hero=Boolean(squad.isProtagonist),leader=index===0;
 const walking=Boolean(item.walking&&motion),step=walking?Math.floor(time/170+seed)%2:0,bob=step?1:0;
 const palette=hero?(leader?['#9b793f','#e7be70','#fff0b0']:index%2?['#3d647c','#739cb6','#c3d8dc']:['#67506f','#a17da9','#dcc4db']):[['#3d6573','#7ca7ac','#b9d6cf'],['#655575','#a28cad','#d9c7da'],['#546b47','#91aa70','#d4deaa']][(seedOf(squad.seed)+index)%3];
 palette[1]=worldPersonColor(item,{hero,party:true,index,squadSeed:squad.seed});
 const skin=skinColors[(seed>>>3)%skinColors.length];
 ellipse(ctx,hero?'#e7c77d55':'#263d3355',x,y+1,6,3);
 if(selectedId===item.conversationId){ctx.strokeStyle='#fff0ae';ctx.lineWidth=1;ctx.strokeRect(x-8,y-22,16,25);}
 // A narrow cape makes a party readable among the working villagers without
 // changing the map's small character scale.
 polygon(ctx,palette[0],[[x-4,y-13-bob],[x+4,y-13-bob],[x+6+step,y-3],[x,y-1],[x-6,y-3]]);
 polygon(ctx,palette[1],[[x-3,y-12-bob],[x+2,y-12-bob],[x+3,y-3],[x-4,y-4]]);
 rect(ctx,'#354448',x-3,y-3,3,4-step);rect(ctx,'#354448',x+1,y-3,3,3+step);
 rect(ctx,'#314750',x-4,y-11-bob,8,8);rect(ctx,palette[1],x-3,y-11-bob,6,7);rect(ctx,palette[2],x-3,y-11-bob,6,2);
 personFace(ctx,item,x,y-17-bob,skin,'#514b3d','#f2ddb4');
 if(leader){
  rect(ctx,palette[0],x-4,y-19-bob,8,4);rect(ctx,palette[2],x-4,y-18-bob,8,2);rect(ctx,palette[1],x-1,y-22-bob,3,4);
  rect(ctx,'#63747a',x+5,y-13-bob,2,12);rect(ctx,palette[2],x+4,y-6-bob,4,2);
  polygon(ctx,palette[0],[[x-7,y-10-bob],[x-3,y-11-bob],[x-3,y-4-bob],[x-5,y-2-bob],[x-7,y-4-bob]]);
  rect(ctx,palette[2],x-6,y-9-bob,2,5);
 }else if(item.appearance==='mage'){
  polygon(ctx,palette[0],[[x-5,y-17-bob],[x,y-24-bob],[x+4,y-17-bob]]);rect(ctx,palette[2],x-5,y-17-bob,10,2);
  rect(ctx,'#8f754e',x+5,y-12-bob,2,13);rect(ctx,palette[2],x+4,y-14-bob,4,4);
 }else if(item.appearance==='priest'){
  rect(ctx,'#d7d7b9',x-4,y-19-bob,8,3);rect(ctx,'#dbdbc1',x-4,y-16-bob,2,5);rect(ctx,'#dbdbc1',x+2,y-16-bob,2,5);
 }else{
  rect(ctx,palette[0],x-4,y-19-bob,8,4);rect(ctx,palette[2],x-3,y-18-bob,6,1);
  rect(ctx,palette[1],x-5,y-10-bob,2,4);rect(ctx,skin,x+4,y-8-bob,2,3);
 }
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
  resident(ctx,{...helper,x:0,y:0,nativeColor:helper.color,walking:false},0,false,null);ctx.restore();
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

export function drawVillageWorld(ctx,{time=0,residents=[],projects=[],population=0,selectedId=null,motion=true,squads=[],protagonist=null,selectedSquadId=null,outskirtsVisible=true,terrainVisible=true,delegates=null}={}){
 ctx.save();ctx.imageSmoothingEnabled=false;
 if(terrainVisible){terrain(ctx,population);if(outskirtsVisible)outskirts(ctx);}
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
  else if(type==='marker')questMarker(ctx,value,clock,motion,selectedSquadId);
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
export function drawWorldFacility(ctx,item){
 if(item.id==='castle')castle(ctx,item.x,item.y);
 else if(item.id==='tavern')tavern(ctx,item.x,item.y);
 else {cottage(ctx,item.x,item.y,1);ctx.fillStyle='#e8d08c';ctx.font='bold 20px serif';ctx.textAlign='center';ctx.fillText('⚔',item.x,item.y-40);}
}
