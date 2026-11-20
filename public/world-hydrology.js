import {pointInIsland} from './world-island.js';

const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const mix=(a,b,t)=>a+(b-a)*t;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const empty=()=>({water:[],rivers:[],outlets:[],source:null,mouth:null,bankWidth:10});

function gridFor(island){
 const b=island?.gridBounds||island?.bounds,cell=island?.gridSize;
 if(!b||![b.left,b.right,b.top,b.bottom,cell].every(Number.isFinite)||cell<=0||
  b.right<=b.left||b.bottom<=b.top||!Array.isArray(island.landPatches))return null;
 const cols=Math.ceil((b.right-b.left)/cell),rows=Math.ceil((b.bottom-b.top)/cell);
 if(cols*rows>20000)return null;
 const land=new Uint8Array(cols*rows),center=id=>({x:b.left+(id%cols+.5)*cell,y:b.top+(Math.floor(id/cols)+.5)*cell});
 for(const patch of island.landPatches){
  const x0=Math.max(0,Math.floor((patch.left-b.left)/cell+1e-7)),x1=Math.min(cols,Math.ceil((patch.right-b.left)/cell-1e-7));
  const y0=Math.max(0,Math.floor((patch.top-b.top)/cell+1e-7)),y1=Math.min(rows,Math.ceil((patch.bottom-b.top)/cell-1e-7));
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)land[y*cols+x]=1;
 }
 const adjacent=id=>{
  const x=id%cols,y=Math.floor(id/cols),result=[];
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
   const nx=x+dx,ny=y+dy;
   result.push({id:nx<0||ny<0||nx>=cols||ny>=rows?-1:ny*cols+nx,dx,dy});
  }
  return result;
 };
 return {b,cell,cols,rows,land,center,adjacent};
}

function distances(grid,starts){
 const result=new Int32Array(grid.land.length).fill(-1),queue=[];
 for(const id of starts)if(grid.land[id]&&result[id]<0){result[id]=0;queue.push(id);}
 for(let i=0;i<queue.length;i++)for(const {id} of grid.adjacent(queue[i]))
  if(id>=0&&grid.land[id]&&result[id]<0){result[id]=result[queue[i]]+1;queue.push(id);}
 return result;
}

function cutsRectangle(a,b,rect,radius=0){
 let from=0,to=1;
 for(const [axis,low,high] of [['x',rect.left-radius,rect.right+radius],['y',rect.top-radius,rect.bottom+radius]]){
  const delta=b[axis]-a[axis];
  if(!delta){if(a[axis]<low||a[axis]>high)return false;}
  else{const x=(low-a[axis])/delta,y=(high-a[axis])/delta;from=Math.max(from,Math.min(x,y));to=Math.min(to,Math.max(x,y));}
  if(from>to)return false;
 }
 return true;
}

// A channel has clearance on both banks, including at corners of ocean inlets.
function drySegment(a,b,radius,island,cell,obstacles=[]){
 if(obstacles.some(rect=>cutsRectangle(a,b,rect,radius)))return false;
 const count=Math.max(1,Math.ceil(distance(a,b)/(cell/5)));
 for(let i=0;i<=count;i++){
  const x=mix(a.x,b.x,i/count),y=mix(a.y,b.y,i/count);
  for(const [dx,dy] of [[0,0],[-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]])
   if(!pointInIsland({x:x+dx,y:y+dy},island))return false;
 }
 return true;
}

function soften(points,island,cell,radius,obstacles){
 const simple=[points[0]];
 for(let at=0;at<points.length-1;){
  let next=at+1;
  for(let candidate=Math.min(points.length-1,at+7);candidate>at+1;candidate--)
   if(drySegment(points[at],points[candidate],radius,island,cell,obstacles)){next=candidate;break;}
  simple.push(points[next]);at=next;
 }
 let result=simple;
 for(let pass=0;pass<2;pass++){
  const rounded=[result[0]];
  for(let i=1;i<result.length;i++){
   const a=result[i-1],b=result[i];
   rounded.push({x:mix(a.x,b.x,.25),y:mix(a.y,b.y,.25)},{x:mix(a.x,b.x,.75),y:mix(a.y,b.y,.75)});
  }
  rounded.push(result.at(-1));
  if(rounded.slice(1).every((p,i)=>drySegment(rounded[i],p,radius,island,cell,obstacles)))result=rounded;
 }
 return result;
}

function samplePath(path,count){
 const lengths=path.slice(1).map((p,i)=>distance(path[i],p)),total=lengths.reduce((sum,n)=>sum+n,0),points=[];
 let segment=0,start=0;
 for(let i=0;i<=count;i++){
  const progress=total*i/count;
  while(segment<lengths.length-1&&start+lengths[segment]<progress){start+=lengths[segment];segment++;}
  const t=lengths[segment]?clamp((progress-start)/lengths[segment],0,1):0,a=path[segment],b=path[segment+1];
  points.push({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
 }
 return {points,length:total};
}

function blend(a,b,t){
 const rgb=value=>[1,3,5].map(at=>parseInt(value.slice(at,at+2),16));
 const one=rgb(a),two=rgb(/^#[0-9a-f]{6}$/i.test(b)?b:'#315e75');
 return '#'+one.map((v,i)=>Math.round(mix(v,two[i],t)).toString(16).padStart(2,'0')).join('');
}

/** Geography is generated once for the continent, independently of district borders. */
export function worldHydrology(island,{roads=[],obstacles=[]}={}){
 const grid=gridFor(island);if(!grid)return empty();
 const {b,cell,land,center}=grid,w=b.right-b.left,h=b.bottom-b.top;
 const coast=[];
 for(let id=0;id<land.length;id++)if(land[id])for(const edge of grid.adjacent(id))
  if(edge.id<0||!land[edge.id])coast.push({id,normal:{x:edge.dx,y:edge.dy},point:{x:center(id).x+edge.dx*cell/2,y:center(id).y+edge.dy*cell/2}});
 if(!coast.length)return empty();
 const maxWidth=Math.min(120,cell*.58),radius=maxWidth/2+Math.min(10,cell*.05);
 const solids=obstacles.filter(rect=>rect&&['left','right','top','bottom'].every(key=>Number.isFinite(rect[key]))&&rect.left<rect.right&&rect.top<rect.bottom);
 // Only fixed world landmarks constrain the catchment. New town footprints
 // are planned after this river exists, rather than forcing it into a stamp.
 for(let id=0;id<land.length;id++)if(land[id]){
  const p=center(id),half=cell/2;
  if(solids.some(rect=>p.x+half>=rect.left-radius&&p.x-half<=rect.right+radius&&
   p.y+half>=rect.top-radius&&p.y-half<=rect.bottom+radius))land[id]=0;
 }
 const outlets=coast.filter(edge=>land[edge.id]);if(!outlets.length)return empty();
 const depth=distances(grid,coast.map(edge=>edge.id));
 // A high, sheltered northern catchment drains into an east-facing inlet.
 // The coast determines the actual outlet; no line continues through the sea.
 const mouthAim={x:b.left+w*.66,y:b.top+h*.55},sourceAim={x:b.left+w*.45,y:b.top+h*.22};
 const flow={x:mouthAim.x-sourceAim.x,y:mouthAim.y-sourceAim.y},flowLength=Math.hypot(flow.x,flow.y)||1;
 // A nearby face pointing back upstream would introduce an artificial elbow
 // just before the sea. Prefer the face the catchment is already draining to.
 const outletScore=edge=>{
  const alignment=(edge.normal.x*flow.x+edge.normal.y*flow.y)/flowLength;
  return distance(edge.point,mouthAim)+cell*(Math.max(0,-alignment)*3+(1-alignment)*.5);
 };
 outlets.sort((a,c)=>outletScore(a)-outletScore(c)||a.id-c.id||a.normal.x-c.normal.x);
 const outlet=outlets[0],toMouth=distances(grid,[outlet.id]);
 const candidates=[];
 for(let id=0;id<land.length;id++)if(land[id]&&toMouth[id]>3&&depth[id]>=2)candidates.push(id);
 if(!candidates.length)return empty();
 candidates.sort((a,c)=>{
  const score=id=>distance(center(id),sourceAim)-Math.min(depth[id],8)*cell*.7;
  return score(a)-score(c)||a-c;
 });
 const sourceID=candidates[0],cells=[sourceID];let current=sourceID;
 while(current!==outlet.id&&cells.length<land.length){
  const next=grid.adjacent(current).map(edge=>edge.id).filter(id=>id>=0&&land[id]&&toMouth[id]===toMouth[current]-1);
  if(!next.length)return empty();
  const aim=center(current),progress=1-toMouth[current]/toMouth[sourceID];
  const valley=sourceAim.x+(outlet.point.x-sourceAim.x)*progress+Math.sin(progress*Math.PI*2)*cell*1.4;
  next.sort((a,c)=>{
   const score=id=>Math.abs(center(id).x-valley)*.5-Math.min(depth[id],3)*cell*.4+Math.abs(center(id).y-aim.y)*.015;
   return score(a)-score(c)||a-c;
  });
  current=next[0];cells.push(current);
 }
 const course=soften(cells.map(center),island,cell,radius,solids),mouth={...outlet.point};
 if(island.islets){
  // The catchment uses a coarse dry-cell grid. Place its mouth on the actual
  // curved shore along the last downstream face.
  const origin=center(outlet.id),direction=outlet.normal;
  let nearest=Infinity,normal=direction;
  for(let i=0;i<island.coast.length;i++){
   const a=island.coast[i],b=island.coast[(i+1)%island.coast.length];
   const dx=b.x-a.x,dy=b.y-a.y,denominator=direction.x*dy-direction.y*dx;
   if(denominator<=0)continue;
   const x=a.x-origin.x,y=a.y-origin.y;
   const t=(x*dy-y*dx)/denominator,u=(x*direction.y-y*direction.x)/denominator;
   if(t<0||u<0||u>1||t>=nearest)continue;
   nearest=t;const length=Math.hypot(dx,dy);normal={x:dy/length,y:-dx/length};
  }
  if(Number.isFinite(nearest)){
   mouth.x=origin.x+direction.x*nearest;mouth.y=origin.y+direction.y*nearest;
   outlet.normal=normal;
  }
 }
 const end={x:mouth.x+outlet.normal.x*cell*.25,y:mouth.y+outlet.normal.y*cell*.25};
 const full=[...course,mouth,end],length=full.slice(1).reduce((sum,p,i)=>sum+distance(full[i],p),0);
 const count=Math.min(760,Math.max(40,Math.ceil(length/10))),sample=samplePath(full,count),points=sample.points;
 // Gentle meanders stay inside the dry corridor. Both projections receive the
 // resulting points rather than independently recreating the curve.
 for(let i=1;i<points.length-3;i++){
  const a=points[i-1],p=points[i],c=points[i+1],dx=c.x-a.x,dy=c.y-a.y,len=Math.hypot(dx,dy)||1,t=i/count;
  const bend=Math.sin(t*Math.PI*7)*Math.sin(t*Math.PI)*Math.min(90,cell*.2);
  const candidate={x:p.x-dy/len*bend,y:p.y+dx/len*bend};
  if(drySegment(a,candidate,radius,island,cell,solids)&&drySegment(candidate,c,radius,island,cell,solids))points[i]=candidate;
 }
 const widths=points.map((p,i)=>maxWidth*(.2+.8*i/count)*Math.min(1,i/Math.min(12,count*.12)));
 const water=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],p=points[i],r=Math.max(widths[i],widths[i-1])/2;
  const remaining=sample.length*(1-i/count);
  const nearMouth=clamp(1-Math.max(0,remaining-cell*.25)/Math.max(cell*.7,maxWidth),0,1);
  water.push({left:Math.min(a.x,p.x)-r,right:Math.max(a.x,p.x)+r,
   top:Math.min(a.y,p.y)-r,bottom:Math.max(a.y,p.y)+r,
   color:blend('#599ba0',island.seaColor,nearMouth),riverId:'main'});
 }
 const source={...points[0]},river={id:'main',points,width:maxWidth,widths,source,mouth};
 const bankWidth=Math.min(10,cell*.05),shoreReach=(island.shoreWidth||18)*.8+bankWidth+2;
 // The land clip excludes the outside half of a coastline stroke. This same
 // narrow outlet surface must therefore also be painted outside that clip,
 // without banks, so the sea and river have a genuinely open shared mouth.
 const outletWater=water.flatMap(rect=>{
  const cut={...rect};
  if(island.islets){
   const farX=outlet.normal.x>0?cut.right:cut.left,farY=outlet.normal.y>0?cut.bottom:cut.top;
   return (farX-mouth.x)*outlet.normal.x+(farY-mouth.y)*outlet.normal.y>=-shoreReach?[cut]:[];
  }
  if(outlet.normal.x>0)cut.left=Math.max(cut.left,mouth.x-shoreReach);
  else if(outlet.normal.x<0)cut.right=Math.min(cut.right,mouth.x+shoreReach);
  else if(outlet.normal.y>0)cut.top=Math.max(cut.top,mouth.y-shoreReach);
  else cut.bottom=Math.min(cut.bottom,mouth.y+shoreReach);
  return cut.left<cut.right&&cut.top<cut.bottom?[cut]:[];
 });
 const outletBounds=outletWater.reduce((bounds,rect)=>({left:Math.min(bounds.left,rect.left),right:Math.max(bounds.right,rect.right),
  top:Math.min(bounds.top,rect.top),bottom:Math.max(bounds.bottom,rect.bottom)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
 const result={water,rivers:[river],outlets:[{riverId:'main',mouth,normal:{...outlet.normal},width:maxWidth,
  water:outletWater,bounds:outletBounds}],source,mouth,bankWidth};
 // Accepted for callers that already have streets; geography never follows
 // those streets or changes when an unrelated district is registered.
 void roads;
 return result;
}

const cross=(a,b)=>a.x*b.y-a.y*b.x;
function segmentInterval(a,b,rect){
 let low=0,high=1;
 for(const [key,min,max] of [['x',rect.left,rect.right],['y',rect.top,rect.bottom]]){
  const delta=b[key]-a[key];
  if(!delta){if(a[key]<min||a[key]>max)return null;}
  else{const from=(min-a[key])/delta,to=(max-a[key])/delta;low=Math.max(low,Math.min(from,to));high=Math.min(high,Math.max(from,to));}
  if(low>high)return null;
 }
 return [low,high];
}
function merged(spans){
 const result=[];
 for(const span of spans.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){
  const last=result.at(-1);
  if(last&&span[0]<=last[1]+1e-7)last[1]=Math.max(last[1],span[1]);else result.push([...span]);
 }
 return result;
}
function followsRiver(a,b,p,river){
 let nearest=Infinity,sine=0;
 for(let i=1;i<river.points.length;i++){
  const c=river.points[i-1],d=river.points[i],dx=d.x-c.x,dy=d.y-c.y,length=dx*dx+dy*dy;if(!length)continue;
  const t=clamp(((p.x-c.x)*dx+(p.y-c.y)*dy)/length,0,1),gap=Math.hypot(p.x-c.x-dx*t,p.y-c.y-dy*t);
  if(gap<nearest){nearest=gap;sine=Math.abs(cross({x:b.x-a.x,y:b.y-a.y},{x:dx,y:dy}))/(distance(a,b)*Math.sqrt(length));}
 }
 return sine<1e-6;
}

/** Deck rectangles are also authoritative walking openings in the river. */
export function riverBridges(hydrology,roads=[]){
 const decks=[];
 for(const road of roads)for(let i=1;i<(road.points?.length||0);i++){
  const a=road.points[i-1],b=road.points[i];if(!finite(a)||!finite(b)||distance(a,b)<1e-7)continue;
  for(const river of hydrology?.rivers||[]){
   const water=(hydrology.water||[]).filter(rect=>!rect.riverId||rect.riverId===river.id);
   const contacts=merged(water.map(rect=>segmentInterval(a,b,rect)).filter(Boolean));
   for(const [from,to] of contacts){
    const at=t=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)}),hit=at((from+to)/2);
    if(followsRiver(a,b,hit,river))continue;
    const horizontal=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y),axis=horizontal?'x':'y',across=horizontal?'y':'x';
    const breadth=Math.max(28,Number.isFinite(road.width)?road.width+8:34),ends=[at(from),at(to)];
    const low=Math.min(...ends.map(p=>p[across]))-breadth/2,high=Math.max(...ends.map(p=>p[across]))+breadth/2;
    // Size the deck from the actual rendered water union, including the full
    // width of the road. A centerline-width estimate leaves wet slivers on a
    // curved bank, so a visible bridge can otherwise still be impassable.
    const spans=merged(water.filter(r=>horizontal?r.top<=high&&r.bottom>=low:r.left<=high&&r.right>=low)
     .map(r=>horizontal?[r.left,r.right]:[r.top,r.bottom]));
    const span=spans.find(([start,end])=>hit[axis]>=start-1e-7&&hit[axis]<=end+1e-7);if(!span)continue;
    const padding=(hydrology.bankWidth||0)+16;
    const deck=horizontal?{left:span[0]-padding,right:span[1]+padding,top:low,bottom:high}:
     {left:low,right:high,top:span[0]-padding,bottom:span[1]+padding};
    deck.orientation=horizontal?'horizontal':'vertical';deck.riverId=river.id;
    // Only combine truly coincident decks. Nearby roads on opposite axes must
    // keep their own crossing instead of losing one to distance-only deduping.
    const existing=decks.find(other=>other.riverId===deck.riverId&&other.orientation===deck.orientation&&
     (horizontal?Math.abs(other.top-deck.top)<1&&Math.abs(other.bottom-deck.bottom)<1&&other.left<=deck.right&&other.right>=deck.left:
      Math.abs(other.left-deck.left)<1&&Math.abs(other.right-deck.right)<1&&other.top<=deck.bottom&&other.bottom>=deck.top));
    if(existing){existing.left=Math.min(existing.left,deck.left);existing.right=Math.max(existing.right,deck.right);
     existing.top=Math.min(existing.top,deck.top);existing.bottom=Math.max(existing.bottom,deck.bottom);}
    else if(decks.length<128)decks.push(deck);
   }
  }
 }
 return decks.map(({left:x,right,top:y,bottom,orientation,riverId},index)=>{
  const w=right-x,h=bottom-y,horizontal=orientation==='horizontal';
  return {id:`bridge:${riverId}:${Math.round(x+w/2)}:${Math.round(y+h/2)}:${index}`,riverId,x,y,w,h,orientation,
   railX:horizontal?x-2:[x-3,x+w+3],railWidth:w+4,railY:horizontal?[y-3,y+h+3]:y-2,railDepth:h+4};
 });
}
