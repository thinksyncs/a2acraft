import {smoothCoast, offshoreIslets, onCoastalLand} from './world-coast.js';
// Display geometry only. Existing work, routes and saved world positions stay put.
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const seed = value => {
  let result=2166136261;
  for(const char of String(value))result=Math.imul(result^char.charCodeAt(0),16777619);
  return result>>>0;
};
const rectPoints = rect => rect && ['left','right','top','bottom'].every(key=>Number.isFinite(rect[key]))
  ? [{x:Math.min(rect.left,rect.right),y:Math.min(rect.top,rect.bottom)},
    {x:Math.max(rect.left,rect.right),y:Math.min(rect.top,rect.bottom)},
    {x:Math.max(rect.left,rect.right),y:Math.max(rect.top,rect.bottom)},
    {x:Math.min(rect.left,rect.right),y:Math.max(rect.top,rect.bottom)}] : [];

function hull(points) {
  const sorted=[...new Map(points.filter(finitePoint).map(point=>[point.x+':'+point.y,{...point}])).values()]
    .sort((a,b)=>a.x-b.x||a.y-b.y);
  if(sorted.length<3)return sorted;
  const half = list => {
    const result=[];
    for(const point of list){
      while(result.length>1&&cross(result.at(-2),result.at(-1),point)<=0)result.pop();
      result.push(point);
    }
    return result;
  };
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}

function boundsOf(points) {
  return points.reduce((bounds,point)=>({left:Math.min(bounds.left,point.x),right:Math.max(bounds.right,point.x),
    top:Math.min(bounds.top,point.y),bottom:Math.max(bounds.bottom,point.y)}),
  {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
}

function touchesConvex(rect,polygon) {
  const bounds=boundsOf(polygon);
  if(rect.right<bounds.left||rect.left>bounds.right||rect.bottom<bounds.top||rect.top>bounds.bottom)return false;
  const corners=rectPoints(rect);
  return polygon.every((a,index)=>corners.some(point=>cross(a,polygon[(index+1)%polygon.length],point)>=-1e-7));
}

function tileCoast(bounds,protectedHull) {
  // This is a world around the work settlements, rather than a buffer around
  // their footprints. Its resolution stays bounded even for sparse old maps.
  const cell=Math.max(120,Math.ceil(Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top)/112/40)*40);
  const left=Math.floor(bounds.left/cell)*cell-cell*2,top=Math.floor(bounds.top/cell)*cell-cell*2;
  const cols=Math.ceil((bounds.right-left)/cell)+2,rows=Math.ceil((bounds.bottom-top)/cell)+2;
  const center={x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
  const halfWidth=(bounds.right-bounds.left)/2,halfHeight=(bounds.bottom-bounds.top)/2;
  const key=(x,y)=>x+','+y,land=new Set(),protectedCells=new Set();
  const neighbors=([x,y])=>[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
  const ellipse=(x,y,cx,cy,rx,ry)=>(x-cx)**2/(rx*rx)+(y-cy)**2/(ry*ry);
  // Several broad landforms joined by necks, with four sea-connected gulfs.
  // Coordinates are proportions of our own world, not a copied game map.
  const continents=[[-.28,-.55,.70,.35],[.62,-.42,.31,.42],[-.58,.20,.38,.62],
    [.52,.48,.45,.40],[0,.80,.22,.18],[0,0,.40,.38],[.27,-.28,.40,.18]];
  const bays=[[-.62,-.10,.50,.22],[.83,.05,.60,.22],[-.22,.77,.22,.38],[.08,-.90,.17,.26]];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const rect={left:left+x*cell,right:left+(x+1)*cell,top:top+y*cell,bottom:top+(y+1)*cell};
    const point={x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2};
    // Keep the smoothed fringe clear of the saved world's convex footprint.
    const buffer=cell*.65;
    const protectedCell=touchesConvex({left:rect.left-buffer,right:rect.right+buffer,
      top:rect.top-buffer,bottom:rect.bottom+buffer},protectedHull);
    const nx=(point.x-center.x)/halfWidth,ny=(point.y-center.y)/halfHeight;
    const roughness=(seed(Math.floor((left/cell+x)/3)+':'+Math.floor((top/cell+y)/2))%13-6)*.012;
    const continent=continents.some(shape=>ellipse(nx,ny,...shape)<=1+roughness);
    const bay=bays.some(shape=>ellipse(nx,ny,...shape)<1-roughness*.5);
    if(protectedCell)protectedCells.add(key(x,y));
    if(protectedCell||continent&&!bay)land.add(key(x,y));
  }
  // Preserve one walkable island. Optional fringe pixels must not become
  // detached rocks or invisible diagonal bridges around the protected world.
  const connected=new Set(),queue=[[...protectedCells][0].split(',').map(Number)];
  for(let i=0;i<queue.length;i++){
    const point=queue[i],id=key(...point);if(connected.has(id)||!land.has(id))continue;
    connected.add(id);queue.push(...neighbors(point));
  }
  for(const id of land)if(!connected.has(id))land.delete(id);
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){
    const a=land.has(key(x,y)),b=land.has(key(x+1,y)),c=land.has(key(x,y+1)),d=land.has(key(x+1,y+1));
    if(a&&d&&!b&&!c)land.add(key(x+1,y));
    else if(b&&c&&!a&&!d)land.add(key(x,y));
  }
  // An inlet stays connected to the ocean. Fill any enclosed single-tile holes
  // so coast remains one unambiguous exterior loop for both renderers.
  const ocean=new Set(),seaQueue=[];
  for(let x=0;x<cols;x++)seaQueue.push([x,0],[x,rows-1]);
  for(let y=0;y<rows;y++)seaQueue.push([0,y],[cols-1,y]);
  for(let i=0;i<seaQueue.length;i++){
    const point=seaQueue[i],[x,y]=point,id=key(x,y);
    if(x<0||x>=cols||y<0||y>=rows||land.has(id)||ocean.has(id))continue;
    ocean.add(id);seaQueue.push(...neighbors(point));
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)if(!ocean.has(key(x,y)))land.add(key(x,y));
  const edges=new Map();
  const edge=(a,b)=>edges.set(key(...a),b);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)if(land.has(key(x,y))){
    if(!land.has(key(x,y-1)))edge([x,y],[x+1,y]);
    if(!land.has(key(x+1,y)))edge([x+1,y],[x+1,y+1]);
    if(!land.has(key(x,y+1)))edge([x+1,y+1],[x,y+1]);
    if(!land.has(key(x-1,y)))edge([x,y+1],[x,y]);
  }
  const start=[...edges.keys()].map(id=>id.split(',').map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1])[0];
  const vertices=[];let point=start;
  do {vertices.push(point);point=edges.get(key(...point));} while(point&&key(...point)!==key(...start)&&vertices.length<=edges.size);
  const gridOutline=vertices.filter((b,index)=>{
    const a=vertices[(index+vertices.length-1)%vertices.length],c=vertices[(index+1)%vertices.length];
    return (b[0]-a[0])*(c[1]-b[1])!==(b[1]-a[1])*(c[0]-b[0]);
  }).map(([x,y])=>({x:left+x*cell,y:top+y*cell}));
  const landPatches=[];let active=new Map();
  for(let y=0;y<rows;y++){
    const next=new Map();
    for(let x=0;x<cols;x++)if(land.has(key(x,y))){
      const from=x;while(x+1<cols&&land.has(key(x+1,y)))x++;
      const id=from+':'+x,patch=active.get(id)||{left:left+from*cell,right:left+(x+1)*cell,top:top+y*cell,bottom:top+y*cell};
      if(!active.has(id))landPatches.push(patch);
      patch.bottom=top+(y+1)*cell;next.set(id,patch);
    }
    active=next;
  }
  const gridBounds=boundsOf(gridOutline);
  const coast=smoothCoast(vertices,cell,{left,top}),islets=offshoreIslets(coast,cell,gridBounds);
  return {coast,islets,landPatches,gridSize:cell,gridBounds};
}

/** One stable coastline encloses every district, facility and recorded road. */
export function createWorldIsland({regions=[],roads=[],buildings=[],bounds,padding=250}={}) {
  const points=regions.flatMap(rectPoints);
  for(const route of roads){
    const radius=Math.max(0,Number.isFinite(route.width)?route.width/2:13)+30;
    for(const point of route.points||[])if(finitePoint(point))points.push(...rectPoints({
      left:point.x-radius,right:point.x+radius,top:point.y-radius,bottom:point.y+radius}));
  }
  for(const building of buildings)if(finitePoint(building)){
    const w=Math.max(1,Number.isFinite(building.width)?building.width:100)/2+35;
    const d=Math.max(1,Number.isFinite(building.depth)?building.depth:80)/2+35;
    points.push(...rectPoints({left:building.x-w,right:building.x+w,top:building.y-d,bottom:building.y+d}));
  }
  if(!points.length)points.push(...rectPoints(bounds||{left:0,right:1000,top:0,bottom:640}));
  if(!points.length)points.push(...rectPoints({left:0,right:1000,top:0,bottom:640}));
  const protectedHull=hull(points),protectedBounds=boundsOf(protectedHull);
  const margin=Math.max(80,Number.isFinite(padding)?padding:250);
  const width=Math.max(16000,(protectedBounds.right-protectedBounds.left)*3.6+margin*2);
  const height=Math.max(12800,(protectedBounds.bottom-protectedBounds.top)*3.6+margin*2);
  const cx=(protectedBounds.left+protectedBounds.right)/2,cy=(protectedBounds.top+protectedBounds.bottom)/2;
  const world={left:cx-width/2,right:cx+width/2,top:cy-height/2,bottom:cy+height/2};
  const {coast,islets,landPatches,gridSize,gridBounds}=tileCoast(world,protectedHull);
  const coastBounds={left:Math.min(gridBounds.left,...coast.map(p=>p.x)),right:Math.max(gridBounds.right,...coast.map(p=>p.x)),
    top:Math.min(gridBounds.top,...coast.map(p=>p.y)),bottom:Math.max(gridBounds.bottom,...coast.map(p=>p.y))};
  const seaMargin=Math.max(320,Math.hypot(coastBounds.right-coastBounds.left,coastBounds.bottom-coastBounds.top)*.07);
  return {coast,islets,landPatches,gridSize,gridBounds,bounds:coastBounds,protectedBounds,
    seaBounds:{left:coastBounds.left-seaMargin,right:coastBounds.right+seaMargin,
      top:coastBounds.top-seaMargin,bottom:coastBounds.bottom+seaMargin},
    seaColor:'#315e75',sandColor:'#c7bb83',landColor:'#78924f',shoreWidth:18};
}

export function pointInIsland(point,island) {
  const coast=island?.coast;
  if(!finitePoint(point)||!Array.isArray(coast)||coast.length<3)return false;
  if(island.islets)return onCoastalLand(point,island);
  if(Array.isArray(island.landPatches))return island.landPatches.some(rect=>
    point.x>=rect.left-1e-6&&point.x<=rect.right+1e-6&&point.y>=rect.top-1e-6&&point.y<=rect.bottom+1e-6);
  let inside=false;
  for(let i=0,j=coast.length-1;i<coast.length;j=i++){
    const a=coast[j],b=coast[i];
    if(Math.abs(cross(a,b,point))<1e-6&&point.x>=Math.min(a.x,b.x)-1e-6&&point.x<=Math.max(a.x,b.x)+1e-6&&
      point.y>=Math.min(a.y,b.y)-1e-6&&point.y<=Math.max(a.y,b.y)+1e-6)return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
