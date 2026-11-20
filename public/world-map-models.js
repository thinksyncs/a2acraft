import {buildingMesh} from './world-building-model.js';
import {personMesh} from './world-character-model.js';
import {sceneryObjectMesh} from './world-scenery-model.js';

// An oblique view retains every ground coordinate used by paths and hit tests.
// Only height shifts the silhouette; both views consume the same triangle mesh.
export const mapProjection=Object.freeze({x:.34,y:.78});
export function projectModelPoint([x,height,z]){return [x-height*mapProjection.x,z-height*mapProjection.y];}
export function projectedModelFaces(mesh){
  const faces=[];
  for(let i=0;i<mesh.length;i+=27){
    const normal=mesh.slice(i+3,i+6);
    if(normal[0]*mapProjection.x+normal[1]+normal[2]*mapProjection.y<=.0001)continue;
    const points=[0,9,18].map(offset=>mesh.slice(i+offset,i+offset+3));
    const light=.76+Math.max(0,normal[0]*-.4+normal[1]*.82+normal[2]*.4)*.3;
    faces.push({points:points.map(projectModelPoint),depth:points.reduce((sum,[x,y,z])=>sum+x*mapProjection.x+y+z*mapProjection.y,0)/3,
      color:'rgb('+mesh.slice(i+6,i+9).map(c=>Math.round(Math.min(1,c*light)*255)).join(',')+')'});
  }
  return faces.sort((a,b)=>a.depth-b.depth);
}
const buildings=new Map(),characters=new Map(),scenery=new Map();
let terrainBitmapDepth=0;
export function drawIntoTerrainBitmap(draw){
  terrainBitmapDepth++;
  try{return draw();}finally{terrainBitmapDepth--;}
}
function paint(ctx,faces){
  for(const face of faces){ctx.fillStyle=face.color;ctx.beginPath();ctx.moveTo(...face.points[0]);
    ctx.lineTo(...face.points[1]);ctx.lineTo(...face.points[2]);ctx.closePath();ctx.fill();}
}
function sprite(cache,key,create,limit,density=3){
  if(cache.has(key)){const item=cache.get(key);cache.delete(key);cache.set(key,item);return item;}
  const mesh=[];create(mesh);const faces=projectedModelFaces(mesh),points=faces.flatMap(face=>face.points);
  const left=Math.floor(Math.min(...points.map(p=>p[0])))-2,top=Math.floor(Math.min(...points.map(p=>p[1])))-2;
  const width=Math.ceil(Math.max(...points.map(p=>p[0])))-left+2,height=Math.ceil(Math.max(...points.map(p=>p[1])))-top+2;
  const scale=Math.min(density,768/Math.max(width,height)),pixelWidth=Math.max(1,Math.ceil(width*scale)),pixelHeight=Math.max(1,Math.ceil(height*scale));
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(pixelWidth,pixelHeight):
    typeof document==='object'?Object.assign(document.createElement('canvas'),{width:pixelWidth,height:pixelHeight}):null;
  const ctx=canvas?.getContext('2d');
  if(ctx){ctx.scale(scale,scale);ctx.translate(-left,-top);paint(ctx,faces);}
  const item={canvas:ctx?canvas:null,faces:ctx?null:faces,left,top,width,height};
  cache.set(key,item);while(cache.size>limit)cache.delete(cache.keys().next().value);return item;
}
function draw(ctx,item,x,y){
  ctx.save();ctx.translate(x,y);ctx.imageSmoothingEnabled=true;
  if(item.canvas)ctx.drawImage(item.canvas,item.left,item.top,item.width,item.height);else paint(ctx,item.faces);
  ctx.restore();
}
function visible(ctx,x,y,radius){
  const matrix=ctx.getTransform?.();
  if(!matrix||!Number.isFinite(matrix.a)||!ctx.canvas?.width)return true;
  const px=matrix.a*x+matrix.c*y+matrix.e,py=matrix.b*x+matrix.d*y+matrix.f;
  const extent=radius*Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));
  return px+extent>=0&&py+extent>=0&&px-extent<=ctx.canvas.width&&py-extent<=ctx.canvas.height;
}
function buildingSprite(building){
  const model={...building,x:0,y:0};
  return sprite(buildings,JSON.stringify(model),out=>buildingMesh(out,model),128);
}
export function mapBuildingBounds(building){
  const item=buildingSprite(building);
  return {left:building.x+item.left,right:building.x+item.left+item.width,
    top:building.y+item.top,bottom:building.y+item.top+item.height};
}
export function drawMapBuilding(ctx,building){
  if(!visible(ctx,building.x,building.y,Math.max(building.width,building.depth)+building.height*2))return;
  if(terrainBitmapDepth){const mesh=[];buildingMesh(mesh,building);paint(ctx,projectedModelFaces(mesh));return;}
  const item=buildingSprite(building);
  ctx.save();ctx.fillStyle='#183d2d38';ctx.beginPath();
  ctx.ellipse(building.x+building.height*.15,building.y+building.depth*.25,building.width*.6,building.depth*.46,0,0,Math.PI*2);ctx.fill();ctx.restore();
  draw(ctx,item,building.x,building.y);
}
export function drawMapPerson(ctx,person){
  if(!visible(ctx,person.x,person.y,42))return;
  // Eight headings and three gait poses bound the cache without hiding walking.
  const heading=Math.round(person.heading/(Math.PI/4))*Math.PI/4,gait=Math.round(person.gait||0);
  const model={id:person.seed??person.id,seed:person.seed,x:0,y:0,heading,gait,appearance:person.appearance,
    role:person.role,kind:person.kind,color:person.color,scale:person.scale||1,hero:!!person.hero,statusColor:person.statusColor};
  const item=sprite(characters,JSON.stringify(model),out=>personMesh(out,model,model.hero),768);
  ctx.save();ctx.fillStyle='#17382e60';ctx.beginPath();ctx.ellipse(person.x+1,person.y+1,6*model.scale,3*model.scale,0,0,Math.PI*2);ctx.fill();ctx.restore();
  draw(ctx,item,person.x,person.y);
}
export function drawMapScenery(ctx,object){
  if(!visible(ctx,object.x,object.y,Math.max(object.width||50,object.depth||50)+(object.height||55)*2))return;
  const matrix=ctx.getTransform?.(),zoom=Number.isFinite(matrix?.a)?Math.hypot(matrix.a,matrix.b):1;
  const density=Math.min(3,Math.max(1/128,2**Math.ceil(Math.log2(zoom))));
  const seed=object.seed??object.id??`${object.kind}:${object.x}:${object.y}:${object.tone||0}`;
  const model={...object,x:0,y:0,seed};
  // The island already owns a distant terrain bitmap. Do not fill the close-up
  // sprite cache with hundreds of one-use, tiny forest landmarks while making it.
  if(terrainBitmapDepth||zoom<.12){
    const mesh=[];sceneryObjectMesh(mesh,model);
    ctx.save();ctx.translate(object.x,object.y);paint(ctx,projectedModelFaces(mesh));ctx.restore();return;
  }
  const item=sprite(scenery,JSON.stringify([model,density]),out=>sceneryObjectMesh(out,model),96,density);
  draw(ctx,item,object.x,object.y);
}
