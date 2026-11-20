import {coastalSegmentDry} from './world-coast.js';
import {pointInIsland} from './world-island.js';
import {avoidBuildings} from './world-travel.js';

const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const near = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
const cache = new WeakMap();
const inside=(p,r)=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom;
function blocked(a,b,r,closed=false) {
  if(Math.max(a.x,b.x)<r.left||Math.min(a.x,b.x)>r.right||Math.max(a.y,b.y)<r.top||Math.min(a.y,b.y)>r.bottom)return false;
  let lo=0,hi=1;
  for(const [axis,min,max] of [['x',r.left,r.right],['y',r.top,r.bottom]]){
    const delta=b[axis]-a[axis];
    if(!delta){if(closed?a[axis]<min||a[axis]>max:a[axis]<=min||a[axis]>=max)return false;}
    else {const x=(min-a[axis])/delta,y=(max-a[axis])/delta;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}
  }
  return closed?lo<=hi+1e-9:lo<hi-1e-8&&hi>0&&lo<1;
}
const bridgeRect=b=>({left:b.left??b.x,right:b.right??b.x+b.w,top:b.top??b.y,bottom:b.bottom??b.y+b.h});

// Water is checked as geometry, never fed into the building visibility graph.
// Cutting out the actual timber deck also keeps narrow bridges traversable.
export function islandWaterObstacles(water=[],bridges=[]) {
  return water.flatMap(rect=>{
    let parts=[rect];
    for(const bridge of bridges){
      const deck=bridgeRect(bridge);
      parts=parts.flatMap(part=>{
        const left=Math.max(part.left,deck.left),right=Math.min(part.right,deck.right),top=Math.max(part.top,deck.top),bottom=Math.min(part.bottom,deck.bottom);
        if(left>=right||top>=bottom)return [part];
        return [{left:part.left,right:left,top:part.top,bottom:part.bottom},
          {left:right,right:part.right,top:part.top,bottom:part.bottom},
          {left,right,top:part.top,bottom:top},{left,right,top:bottom,bottom:part.bottom}]
          .filter(r=>r.left<r.right&&r.top<r.bottom);
      });
    }
    return parts;
  });
}

export function islandRouteWalkable(route,island,{obstacles=[],water=[],bridges=[]}={}) {
  if(!route.length||!route.every(point=>finite(point)&&pointInIsland(point,island)))return false;
  const wet=islandWaterObstacles(water,bridges);
  return route.slice(1).every((end,index)=>islandSegmentOnLand(route[index],end,island)&&
    !obstacles.some(rect=>blocked(route[index],end,rect))&&!wet.some(rect=>blocked(route[index],end,rect,true)));
}

// Cover the whole segment with dry rectangles, including exact tile boundaries.
// Sampling endpoints alone would let a straight walk cut across a narrow bay.
export function islandSegmentOnLand(a,b,island) {
  if(!finite(a)||!finite(b)||!pointInIsland(a,island)||!pointInIsland(b,island))return false;
  if(island.islets)return coastalSegmentDry(a,b,island);
  const spans=[];
  for(const patch of island.landPatches||[]){
    let from=0,to=1;
    for(const [axis,low,high] of [['x',patch.left,patch.right],['y',patch.top,patch.bottom]]){
      const delta=b[axis]-a[axis];
      if(!delta){if(a[axis]<low-1e-7||a[axis]>high+1e-7){to=-1;break;}}
      else {const x=(low-a[axis])/delta,y=(high-a[axis])/delta;from=Math.max(from,Math.min(x,y));to=Math.min(to,Math.max(x,y));}
    }
    if(from<=to+1e-9)spans.push([from,to]);
  }
  spans.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
  let end=0;
  for(const span of spans){if(span[0]>end+1e-8)return false;end=Math.max(end,span[1]);if(end>=1-1e-8)return true;}
  return false;
}

function islandGrid(island) {
  const bounds=island.gridBounds||island.bounds,cell=island.gridSize;
  if(!bounds||!Number.isFinite(cell)||cell<=0)return null;
  const shape=JSON.stringify([bounds,cell,island.landPatches]);
  const saved=cache.get(island);if(saved?.shape===shape)return saved;
  const cols=Math.ceil((bounds.right-bounds.left)/cell),rows=Math.ceil((bounds.bottom-bounds.top)/cell);
  if(cols<1||rows<1||cols*rows>20000)return null;
  const land=new Set(),key=(x,y)=>y*cols+x;
  for(const patch of island.landPatches||[]){
    const x0=Math.max(0,Math.floor((patch.left-bounds.left)/cell+1e-7));
    const x1=Math.min(cols,Math.ceil((patch.right-bounds.left)/cell-1e-7));
    const y0=Math.max(0,Math.floor((patch.top-bounds.top)/cell+1e-7));
    const y1=Math.min(rows,Math.ceil((patch.bottom-bounds.top)/cell-1e-7));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)land.add(key(x,y));
  }
  const center=id=>({x:bounds.left+(id%cols+.5)*cell,y:bounds.top+(Math.floor(id/cols)+.5)*cell});
  const locate=point=>{
    const x=Math.floor((point.x-bounds.left)/cell),y=Math.floor((point.y-bounds.top)/cell);
    for(const [dx,dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]){
      const cx=x+dx,cy=y+dy,id=key(cx,cy);
      if(cx>=0&&cx<cols&&cy>=0&&cy<rows&&land.has(id)&&
        Math.abs(point.x-center(id).x)<=cell/2+1e-7&&Math.abs(point.y-center(id).y)<=cell/2+1e-7)return id;
    }
    return null;
  };
  const result={shape,land,cols,rows,center,locate,bounds};cache.set(island,result);return result;
}

/** Free exploration on the existing continent; it never changes saved roads. */
export function islandLandRoute(start,target,island,{obstacles=[],water=[],bridges=[]}={}) {
  if(!finite(start)||!finite(target)||!pointInIsland(start,island)||!pointInIsland(target,island))return [];
  const wet=islandWaterObstacles(water,bridges),solid=obstacles.filter(rect=>!inside(start,rect));
  if(wet.some(rect=>blocked(target,target,rect,true)))return [];
  // Preserve the existing behavior when clicking a building's footprint.
  const containing=obstacles.filter(rect=>inside(target,rect));
  if(containing.length)target=avoidBuildings(target,target,containing).at(-1);
  if(!target||!pointInIsland(target,island)||wet.some(rect=>blocked(target,target,rect)))return [];
  const clear=(a,b)=>!solid.some(rect=>blocked(a,b,rect))&&!wet.some(rect=>blocked(a,b,rect,true));
  const connect=(a,b)=>{
    const relevant=solid.filter(rect=>rect.right>=Math.min(a.x,b.x)-100&&rect.left<=Math.max(a.x,b.x)+100&&rect.bottom>=Math.min(a.y,b.y)-100&&rect.top<=Math.max(a.y,b.y)+100);
    const route=avoidBuildings(a,b,relevant);
    return route.length&&near(route.at(-1),b)&&route.slice(1).every((point,index)=>clear(route[index],point)&&islandSegmentOnLand(route[index],point,island))?route:[];
  };
  const direct=connect(start,target);
  if(direct.length)return direct;
  const grid=islandGrid(island);if(!grid)return [];
  const nodes=new Map(),links=new Map();let nextId=grid.cols*grid.rows;
  const link=(a,b)=>{if(!links.has(a))links.set(a,[]);links.get(a).push(b);};
  const attach=point=>{
    const id=nextId++;nodes.set(id,point);
    const cx=Math.floor((point.x-grid.bounds.left)/island.gridSize),cy=Math.floor((point.y-grid.bounds.top)/island.gridSize);
    for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){
      const cell=y*grid.cols+x;
      if(x<0||x>=grid.cols||y<0||y>=grid.rows||!grid.land.has(cell))continue;
      if(connect(point,grid.center(cell)).length){link(id,cell);link(cell,id);}
    }
    return id;
  };
  const from=attach(start),to=attach(target);
  for(const bridge of bridges){
    const deck=bridgeRect(bridge),horizontal=deck.right-deck.left>=deck.bottom-deck.top;
    const a=horizontal?{x:deck.left-8,y:(deck.top+deck.bottom)/2}:{x:(deck.left+deck.right)/2,y:deck.top-8};
    const b=horizontal?{x:deck.right+8,y:a.y}:{x:a.x,y:deck.bottom+8};
    if(!connect(a,b).length)continue;
    const first=attach(a),last=attach(b);link(first,last);link(last,first);
  }
  const point=id=>nodes.get(id)||grid.center(id);
  const previous=new Map([[from,null]]),queue=[from];
  for(let i=0;i<queue.length&&!previous.has(to);i++){
    const id=queue[i],x=id%grid.cols,y=Math.floor(id/grid.cols);
    const adjacent=[...(links.get(id)||[])];
    if(!nodes.has(id))for(const [nx,ny] of [[x+1,y],[x,y+1],[x-1,y],[x,y-1]]){
      const next=ny*grid.cols+nx;
      if(nx>=0&&nx<grid.cols&&ny>=0&&ny<grid.rows&&grid.land.has(next)&&clear(point(id),point(next)))adjacent.push(next);
    }
    for(const next of adjacent){
      if(previous.has(next))continue;
      previous.set(next,id);queue.push(next);
    }
  }
  if(!previous.has(to))return [];
  const cells=[];for(let id=to;id!==null;id=previous.get(id))cells.push(point(id));
  const points=cells.reverse(),route=[{...start}];
  // Safe long strides remove the grid staircase; every shortcut is checked
  // against the dry land and the same building obstacles as a local walk.
  for(let index=0;index<points.length-1;){
    let next=index,part=[];
    for(let candidate=points.length-1;candidate>index;candidate--){
      const path=connect(route.at(-1),points[candidate]);
      if(path.length){next=candidate;part=path;break;}
    }
    if(next===index)return [];
    for(const point of part.slice(1))if(!near(point,route.at(-1)))route.push({...point});
    index=next;
  }
  return route;
}
