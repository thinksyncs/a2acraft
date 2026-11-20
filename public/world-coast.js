// The coast is a single set of world-space contours for picking, clipping and both cameras.
const lerp = (a,b,t) => a+(b-a)*t;
const boundsOf = points => ({
  left:Math.min(...points.map(p=>p.x)), right:Math.max(...points.map(p=>p.x)),
  top:Math.min(...points.map(p=>p.y)), bottom:Math.max(...points.map(p=>p.y)),
});

export function smoothCoast(gridVertices, cell, frame) {
  // A softly displaced control point per grid edge retains narrow necks. A cubic
  // B-spline turns the old staircase into one continuous line through each bay.
  const controls=gridVertices.map(([col,row],i)=>{
    const previous=gridVertices[(i+gridVertices.length-1)%gridVertices.length];
    const next=gridVertices[(i+1)%gridVertices.length];
    const dx=next[0]-previous[0], dy=next[1]-previous[1], length=Math.hypot(dx,dy);
    const shift=cell*(.15*Math.sin(col*.59+row*.37)+.12*Math.sin(col*.23-row*.71));
    return {x:frame.left+col*cell+dy/length*shift,y:frame.top+row*cell-dx/length*shift};
  });
  const coast=[];
  for(let i=0;i<controls.length;i++){
    const n=controls.length, points=[controls[(i+n-1)%n],controls[i],controls[(i+1)%n],controls[(i+2)%n]];
    for(const t of [0,.5]){
      const t2=t*t,t3=t2*t;
      const weights=[(1-t)**3,3*t3-6*t2+4,-3*t3+3*t2+3*t+1,t3];
      coast.push({x:points.reduce((v,p,k)=>v+p.x*weights[k]/6,0),
        y:points.reduce((v,p,k)=>v+p.y*weights[k]/6,0)});
    }
  }
  return coast;
}

function distanceToEdge(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}

export function offshoreIslets(coast,cell,frame) {
  const rings=[];
  for(const [tx,ty] of [[.23,.48],[.82,.48]]){
    const aim={x:lerp(frame.left,frame.right,tx),y:lerp(frame.top,frame.bottom,ty)};
    let best=null,bestScore=Infinity;
    for(let row=-5;row<=5;row++)for(let col=-5;col<=5;col++){
      const p={x:aim.x+col*cell,y:aim.y+row*cell};
      const score=col*col+row*row;
      if(score>=bestScore||insideLoop(p,coast))continue;
      const clearance=cell*2.8;
      if(p.x<frame.left+clearance||p.x>frame.right-clearance||p.y<frame.top+clearance||p.y>frame.bottom-clearance)continue;
      if(coast.some((a,i)=>distanceToEdge(p,a,coast[(i+1)%coast.length])<clearance))continue;
      if(rings.some(ring=>ring.some(a=>Math.hypot(a.x-p.x,a.y-p.y)<clearance)))continue;
      best=p; bestScore=score;
    }
    if(!best)continue;
    const phase=rings.length*.8;
    rings.push(Array.from({length:40},(_,i)=>{
      const a=i*Math.PI/20,r=cell*(1+.15*Math.cos(3*a+phase)+.09*Math.sin(5*a-phase));
      return {x:best.x+r*(1.75*Math.cos(a)+.24*Math.sin(a)),y:best.y+r*(.94*Math.sin(a)-.38*Math.cos(a))};
    }));
  }
  return rings;
}

export function coastLoops(island) { return [island.coast,...(island.islets||[])]; }

function insideLoop(point,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<lerp(a.x,b.x,(point.y-a.y)/(b.y-a.y)))inside=!inside;
  }
  return inside;
}

function inset(loop,width){
  const normals=loop.map((a,i)=>{
    const b=loop[(i+1)%loop.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    return {x:-dy/length,y:dx/length};
  });
  return loop.map((p,i)=>{
    const a=normals[(i+loop.length-1)%loop.length],b=normals[i];
    const scale=width/Math.max(.5,1+a.x*b.x+a.y*b.y);
    return {x:p.x+(a.x+b.x)*scale,y:p.y+(a.y+b.y)*scale};
  });
}

const cache=new WeakMap();
function coastIndex(island){
  const old=cache.get(island);
  if(old&&old.coast===island.coast&&old.islets===island.islets)return old;
  const outer=coastLoops(island);
  const inner=outer.map(ring=>inset(ring,(island.shoreWidth||18)/2));
  const edges=[...outer,...inner].flatMap((ring,k)=>ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length];
    return {a,b,inner:k>=outer.length,...boundsOf([a,b])};
  }));
  edges.forEach((edge,id)=>{edge.id=id+1;});
  const levels=[...new Set(edges.flatMap(edge=>[edge.top,edge.bottom]))].sort((a,b)=>a-b);
  const bands=levels.slice(1).map((bottom,i)=>{
    const top=levels[i],middle=(top+bottom)/2;
    const crossings=edges.filter(e=>e.top<middle&&e.bottom>middle).sort((a,b)=>edgeX(a,middle)-edgeX(b,middle));
    return {top,bottom,crossings};
  });
  const buckets=new Map(),cell=island.gridSize||256;
  for(const edge of edges)for(let row=Math.floor(edge.top/cell);row<=Math.floor(edge.bottom/cell);row++){
    const group=buckets.get(row)||[];group.push(edge);buckets.set(row,group);
  }
  const result={coast:island.coast,islets:island.islets,edges,bands,buckets,cell};
  cache.set(island,result);return result;
}
function edgeX(edge,y){ return lerp(edge.a.x,edge.b.x,(y-edge.a.y)/(edge.b.y-edge.a.y)); }
function bandAt(bands,y){
  let low=0,high=bands.length;
  while(low<high){const mid=(low+high)>>1;if(bands[mid].bottom<=y)low=mid+1;else high=mid;}
  return low;
}
function materialAt(point,bands,closed=false) {
  // Permit rounding of boundary vertices written into the WebGL Float32 mesh.
  const epsilon=closed?Math.max(.001,Math.max(Math.abs(point.x),Math.abs(point.y))*1e-7):0;
  const i=bandAt(bands,point.y);
  if(closed)for(const band of [bands[i-1],bands[i],bands[i+1]]){
    if(!band||point.y<band.top-epsilon||point.y>band.bottom+epsilon)continue;
    if(band.crossings.some(e=>!e.inner&&point.x>=e.left-epsilon&&point.x<=e.right+epsilon&&distanceToEdge(point,e.a,e.b)<=epsilon))return 'sand';
  }
  const band=bands[i];if(!band||point.y<band.top)return 'sea';
  let land=false,inner=false;
  for(const edge of band.crossings){
    if(edgeX(edge,point.y)>point.x)break;
    if(edge.inner)inner=!inner;else land=!land;
  }
  return inner?'grass':land?'sand':'sea';
}
export function onCoastalLand(point,island){return materialAt(point,coastIndex(island).bands,true)!=='sea';}
function nearRect(index,rect,outerOnly=false) {
  const first=Math.floor(rect.top/index.cell),last=Math.floor(rect.bottom/index.cell);
  const touches=e=>(!outerOnly||!e.inner)&&e.left<=rect.right&&e.right>=rect.left&&e.top<=rect.bottom&&e.bottom>=rect.top;
  if(last-first>32)return index.edges.some(touches);
  for(let row=first;row<=last;row++)if(index.buckets.get(row)?.some(touches))return true;
  return false;
}
export function coastalFootprintDry(rect,island) {
  const index=coastIndex(island),center={x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2};
  return !nearRect(index,rect,true)&&materialAt(center,index.bands)!=='sea';
}
export function coastalSegmentDry(a,b,island){
  const edges=coastIndex(island).edges,dx=b.x-a.x,dy=b.y-a.y;
  const times=[0,1],bounds=boundsOf([a,b]);
  if(!nearRect(coastIndex(island),bounds,true))return true;
  for(const edge of edges){
    if(edge.inner||edge.left>bounds.right||edge.right<bounds.left||edge.top>bounds.bottom||edge.bottom<bounds.top)continue;
    const ex=edge.b.x-edge.a.x,ey=edge.b.y-edge.a.y,det=dx*ey-dy*ex;
    if(Math.abs(det)<1e-8)continue;
    const x=edge.a.x-a.x,y=edge.a.y-a.y,t=(x*ey-y*ex)/det,u=(x*dy-y*dx)/det;
    if(t>0&&t<1&&u>=0&&u<=1)times.push(t);
  }
  times.sort((x,y)=>x-y);
  return times.slice(1).every((t,i)=>{const mid=(times[i]+t)/2;return onCoastalLand({x:a.x+dx*mid,y:a.y+dy*mid},island);});
}

function clipX(points,x,side){
  const output=[];
  for(let i=0;i<points.length;i++){
    const a=points[(i+points.length-1)%points.length],b=points[i];
    const before=(a.x-x)*side>=0,after=(b.x-x)*side>=0;
    if(before!==after)output.push({x,y:lerp(a.y,b.y,(x-a.x)/(b.x-a.x))});
    if(after)output.push(b);
  }
  return output;
}

// Intersect a rectangular terrain material with the coast. Only material tiles
// touching the shoreline are split; inland ground keeps its original geometry.
export function coastalFaces(island,rect,material,emit){
  const index=coastIndex(island),{bands}=index;
  const corners=(top,bottom)=>[{x:rect.left,y:top},{x:rect.right,y:top},{x:rect.right,y:bottom},{x:rect.left,y:bottom}];
  if(!nearRect(index,rect)){
    const at=materialAt({x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2},bands);
    if(at===material||(material==='land'&&at!=='sea'))emit(corners(rect.top,rect.bottom));return;
  }
  if(material==='sea'){
    if(bands[0].top>rect.top)emit(corners(rect.top,Math.min(rect.bottom,bands[0].top)));
    if(bands.at(-1).bottom<rect.bottom)emit(corners(Math.max(rect.top,bands.at(-1).bottom),rect.bottom));
  }
  // A cape on one side of the island adds sweep levels on the other side.
  // Merge successive bands with the same two edges before triangulating them.
  const strips=[],recent=new Map();
  const append=(left,right,top,bottom)=>{
    const key=(left?.id||0)+','+(right?.id||0),last=recent.get(key);
    if(last&&last.bottom===top){last.bottom=bottom;return;}
    const strip={left,right,top,bottom};
    recent.set(key,strip);strips.push(strip);
  };
  for(let i=bandAt(bands,rect.top);i<bands.length&&bands[i].top<rect.bottom;i++){
    const band=bands[i],top=Math.max(rect.top,band.top),bottom=Math.min(rect.bottom,band.bottom);
    let left=null,land=false,grass=false;
    for(let j=0;j<=band.crossings.length;j++){
      const right=band.crossings[j];
      const match=material==='land'?land:material===(grass?'grass':land?'sand':'sea');
      if(match&&(!left||left.left<=rect.right)&&(!right||right.right>=rect.left))
        append(left&&left.right>=rect.left?left:null,right&&right.left<=rect.right?right:null,top,bottom);
      if(right?.inner)grass=!grass;else land=!land;
      left=right;
    }
  }
  for(const {left,right,top,bottom} of strips){
    const polygon=[{x:left?edgeX(left,top):rect.left,y:top},{x:right?edgeX(right,top):rect.right,y:top},
      {x:right?edgeX(right,bottom):rect.right,y:bottom},{x:left?edgeX(left,bottom):rect.left,y:bottom}];
    const clipped=clipX(clipX(polygon,rect.left,1),rect.right,-1);
    if(clipped.length>=3)emit(clipped);
  }
}
