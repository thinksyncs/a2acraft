import {coastalFootprintDry} from './world-coast.js';
import {pointInIsland} from './world-island.js';
import {islandSegmentOnLand} from './world-island-travel.js';
import {avoidBuildings} from './world-travel.js';

// Work identities stay intact; only their display sites adapt to the geography.
const hash=value=>{let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const grow=(r,n)=>({left:r.left-n,right:r.right+n,top:r.top-n,bottom:r.bottom+n});
const contains=(p,r)=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const area=r=>(r.right-r.left)*(r.bottom-r.top);
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const boundsOf=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
 top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
const nearestOnRect=(p,r)=>({x:Math.max(r.left,Math.min(r.right,p.x)),y:Math.max(r.top,Math.min(r.bottom,p.y))});
function covered(rect,land){
 let sum=0;
 for(const r of land)sum+=Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left))*
  Math.max(0,Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top));
 return sum>=area(rect)-1e-5;
}
function interval(a,b,r){
 let from=0,to=1;
 for(const [key,lo,hi] of [['x',r.left,r.right],['y',r.top,r.bottom]]){
  const delta=b[key]-a[key];
  if(!delta){if(a[key]<=lo||a[key]>=hi)return null;}
  else{const u=(lo-a[key])/delta,v=(hi-a[key])/delta;from=Math.max(from,Math.min(u,v));to=Math.min(to,Math.max(u,v));}
 }
 return from<to-1e-8&&to>0&&from<1?[Math.max(0,from),Math.min(1,to)]:null;
}
function wetLength(a,b,water){
 const spans=water.map(r=>interval(a,b,r)).filter(Boolean).sort((a,b)=>a[0]-b[0]);
 let total=0,last=-1;
 for(const [from,to] of spans){total+=Math.max(0,to-Math.max(from,last));last=Math.max(last,to);}
 return total*distance(a,b);
}
const crossing=(a,b,rects)=>rects.some(r=>interval(a,b,r));
const footprint=(x,y,kind='work')=>kind==='work'?{left:x-64,right:x+64,top:y-75,bottom:y+24}:
 kind==='cottage'?{left:x-33,right:x+33,top:y-58,bottom:y+15}:
 kind==='field'?{left:x-5,right:x+91,top:y-5,bottom:y+57}:{left:x-30,right:x+30,top:y-52,bottom:y+20};
const roadTouches=(rect,roads)=>roads.some(road=>(road.points||[]).slice(1).some((p,i)=>interval(road.points[i],p,grow(rect,(road.width||25)/2+8))));

function terrainFor(island,hydrology,biomes,obstacles){
 const land=island?.landPatches||[],water=(hydrology?.water||[]).map(r=>grow(r,14));
 const mountains=(biomes?.ground||[]).filter(p=>p.kind==='mountain').map(p=>({left:p.x,right:p.x+p.width,top:p.y,bottom:p.y+p.depth}));
 return {land,water,mountains,dry:(rect,foothills=false)=>covered(grow(rect,12),land)&&(!island?.islets||coastalFootprintDry(grow(rect,12),island))&&
  !water.some(r=>overlap(rect,r))&&!obstacles.some(r=>overlap(grow(rect,12),r))&&
  (foothills||!mountains.some(r=>overlap(rect,r)))};
}

function centerFor(district,terrain){
 const {place,id}=district,target={x:place.x+500,y:place.y+360},candidates=[];
 for(let y=160;y<=480;y+=64)for(let x=180;x<=820;x+=64){
  const p={x:place.x+x,y:place.y+y},rect={left:p.x-68,right:p.x+68,top:p.y-68,bottom:p.y+68};
  if(!terrain.dry(rect))continue;
  const shore=terrain.water.reduce((best,r)=>Math.min(best,distance(p,nearestOnRect(p,r))),Infinity);
  const riverCost=Number.isFinite(shore)?Math.abs(Math.min(shore,700)-220)*.4:0;
  candidates.push({...p,score:distance(p,target)+riverCost+(hash(id+':'+x+':'+y)%13)});
 }
 return candidates.sort((a,b)=>a.score-b.score||a.x-b.x||a.y-b.y)[0]||target;
}

function candidatesFor(district){
 const points=[],{place,id}=district;
 for(let y=100;y<=600;y+=72)for(let x=92;x<=920;x+=72){
  const s=hash(id+':'+x+':'+y);
  points.push({x:place.x+x+(s%17)-8,y:place.y+y+((s>>>8)%17)-8});
 }
 return points;
}

function nearestSite(preferred,kind,{district,terrain,occupied,arteries,candidates}){
 const usable=(p,foothills)=>{const rect=footprint(p.x,p.y,kind);return terrain.dry(rect,foothills)&&
  !occupied.some(other=>overlap(grow(rect,14),other))&&!roadTouches(rect,arteries);};
 const choices=[preferred,...candidates].sort((a,b)=>distance(a,preferred)-distance(b,preferred)||a.y-b.y||a.x-b.x);
 for(const foothills of [false,true]){const found=choices.find(p=>usable(p,foothills));if(found)return found;}
 // A coastal or flooded anchor can be short of space. Search adjoining dry
 // land before considering the rest of the island; never drop a work building.
 for(const radius of [240,480,800,1280]){
  const ring=[];
  for(let d=-radius;d<=radius;d+=80)for(const p of [{x:preferred.x+d,y:preferred.y-radius},
   {x:preferred.x+d,y:preferred.y+radius},{x:preferred.x-radius,y:preferred.y+d},{x:preferred.x+radius,y:preferred.y+d}])ring.push(p);
  const found=ring.sort((a,b)=>distance(a,preferred)-distance(b,preferred)||a.y-b.y||a.x-b.x).find(p=>usable(p,true));
  if(found)return found;
 }
 const far=terrain.land.flatMap(r=>[{x:(r.left+r.right)/2,y:(r.top+r.bottom)/2},
  {x:r.left+100,y:r.top+100},{x:r.right-100,y:r.bottom-100}]).sort((a,b)=>distance(a,preferred)-distance(b,preferred));
 const found=far.find(p=>usable(p,true));
 if(found)return found;
 if(kind==='work')throw Error('No dry display site for work in district '+district.id);
 return null;
}

// A small heap keeps road planning bounded for many independent districts.
function heap(){const values=[];return {get length(){return values.length;},push(value){let i=values.push(value)-1;
 while(i){const p=(i-1)>>1;if(values[p].score<=value.score)break;values[i]=values[p];i=p;}values[i]=value;},pop(){
 const first=values[0],last=values.pop();if(values.length){let i=0;while(i*2+1<values.length){let child=i*2+1;
  if(child+1<values.length&&values[child+1].score<values[child].score)child++;
  if(values[child].score>=last.score)break;values[i]=values[child];i=child;}values[i]=last;}return first;}};}

function roadRoute(start,end,{island,water,obstacles}){
 const box=grow(boundsOf([start,end]),190),solid=obstacles.filter(r=>overlap(r,box)&&!contains(start,r)&&!contains(end,r));
 const localWater=water.filter(r=>overlap(r,box));
 const valid=(a,b)=>!crossing(a,b,solid)&&islandSegmentOnLand(a,b,island);
 const cost=path=>path.slice(1).reduce((sum,b,i)=>sum+distance(path[i],b)+wetLength(path[i],b,localWater)*7,0);
 const options=(a,b)=>{
  const choices=[[a,b],[a,{x:a.x,y:b.y},b],[a,{x:b.x,y:a.y},b]];
  return choices.filter(path=>path.slice(1).every((p,i)=>valid(path[i],p)&&
   (!wetLength(path[i],p,localWater)||Math.abs(p.x-path[i].x)<1e-6||Math.abs(p.y-path[i].y)<1e-6)))
   .sort((a,b)=>cost(a)-cost(b))[0];
 };
 const direct=avoidBuildings(start,end,solid);
 if(direct.length&&direct.slice(1).every((p,i)=>valid(direct[i],p)&&!wetLength(direct[i],p,localWater)))return direct;
 const fallback=options(start,end);
 const step=Math.max(40,Math.ceil(Math.max(box.right-box.left,box.bottom-box.top)/38/8)*8);
 const left=Math.floor(box.left/step)*step,top=Math.floor(box.top/step)*step;
 const cols=Math.ceil((box.right-left)/step)+1,rows=Math.ceil((box.bottom-top)/step)+1;
 const point=id=>({x:left+(id%cols)*step,y:top+Math.floor(id/cols)*step});
 const land=new Set();
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const id=y*cols+x,p=point(id);
  if(pointInIsland(p,island)&&!solid.some(r=>contains(p,r)))land.add(id);}
 const attach=p=>[...land].map(id=>({id,p:point(id)})).sort((a,b)=>distance(a.p,p)-distance(b.p,p)||a.id-b.id).slice(0,20)
  .map(({id,p:other})=>({id,path:options(p,other)})).filter(item=>item.path);
 const from=attach(start),targets=new Map(attach(end).map(item=>[item.id,{path:[...item.path].reverse(),cost:cost(item.path)}]));
 if(!from.length||!targets.size)return fallback||[];
 const queue=heap(),best=new Map(),previous=new Map(),prefix=new Map();
 for(const {id,path} of from){const g=cost(path);if(g>=(best.get(id)??Infinity))continue;
  best.set(id,g);previous.set(id,null);prefix.set(id,path);queue.push({id,g,score:g+distance(point(id),end)});}
 let found=null,total=fallback?cost(fallback):Infinity;
 while(queue.length){const row=queue.pop();if(row.g!==best.get(row.id))continue;if(row.score>=total)break;
  if(targets.has(row.id)){const g=row.g+targets.get(row.id).cost;if(g<total){total=g;found=row.id;}}
  const x=row.id%cols,y=Math.floor(row.id/cols),a=point(row.id);
  for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
   const id=ny*cols+nx;if(nx<0||nx>=cols||ny<0||ny>=rows||!land.has(id))continue;
   const b=point(id);if(!valid(a,b))continue;
   const g=row.g+distance(a,b)+wetLength(a,b,localWater)*7;
   if(g>=(best.get(id)??Infinity))continue;best.set(id,g);previous.set(id,row.id);
   queue.push({id,g,score:g+distance(b,end)});
  }
 }
 if(found===null)return fallback||[];
 const ids=[];for(let id=found;id!==null;id=previous.get(id))ids.push(id);ids.reverse();
 const raw=[...prefix.get(ids[0]),...ids.slice(1).map(point),...targets.get(found).path.slice(1)],result=[raw[0]];
 for(let index=0;index<raw.length-1;){let next=index+1,wet=0;
  const accumulated=[0];for(let i=index+1;i<raw.length;i++){wet+=wetLength(raw[i-1],raw[i],localWater);accumulated.push(wet);}
  for(let candidate=raw.length-1;candidate>index;candidate--){const a=raw[index],b=raw[candidate],crossed=wetLength(a,b,localWater);
   if(valid(a,b)&&crossed<=accumulated[candidate-index]+.5&&(!crossed||Math.abs(a.x-b.x)<1e-6||Math.abs(a.y-b.y)<1e-6)){next=candidate;break;}}
  if(distance(result.at(-1),raw[next])>1e-6)result.push(raw[next]);index=next;
 }
 return result;
}

function clearingFor(plan,terrain,claimed){
 const blobs=[{x:plan.center.x,y:plan.center.y,rx:96,ry:76},...plan.plots.map(plot=>({
  x:(plot.left+plot.right)/2,y:(plot.top+plot.bottom)/2,rx:(plot.right-plot.left)/2+36,ry:(plot.bottom-plot.top)/2+32}))];
 const size=16,cells=new Set(),key=(x,y)=>x+':'+y;
 for(const blob of blobs){
  for(let y=Math.floor((blob.y-blob.ry)/size);y<=Math.ceil((blob.y+blob.ry)/size);y++)
   for(let x=Math.floor((blob.x-blob.rx)/size);x<=Math.ceil((blob.x+blob.rx)/size);x++){
    const id=key(x,y);if(cells.has(id)||claimed.has(id))continue;
    const px=(x+.5)*size,py=(y+.5)*size,s=hash(plan.id+':'+x+':'+y);
    if(((px-blob.x)/blob.rx)**2+((py-blob.y)/blob.ry)**2>1+(s%11-5)*.025)continue;
    const r={left:x*size,right:(x+1)*size,top:y*size,bottom:(y+1)*size};
    if(terrain.dry(r,true))cells.add(id);
   }
 }
 const rows=new Map();for(const id of cells){claimed.add(id);const [x,y]=id.split(':').map(Number);if(!rows.has(y))rows.set(y,[]);rows.get(y).push(x);}
 const patches=[];let active=new Map();
 for(const y of [...rows.keys()].sort((a,b)=>a-b)){
  const xs=rows.get(y).sort((a,b)=>a-b),next=new Map();
  for(let i=0;i<xs.length;i++){const first=xs[i];let last=first;while(xs[i+1]===last+1){last=xs[++i];}
   const id=first+':'+last,prior=active.get(id),r=prior?.bottom===y*size?prior:{left:first*size,right:(last+1)*size,top:y*size,bottom:y*size};
   if(r!==prior)patches.push(r);r.bottom=(y+1)*size;next.set(id,r);
  }active=next;
 }
 return {kind:'clearing',id:plan.id+':clearing',x:plan.center.x,y:plan.center.y,color:'#819650',patches};
}

/** Plan dry settlements after the shared landscape, keeping work IDs intact. */
export function planWorldSettlements({districts=[],island,hydrology={water:[],rivers:[]},connectingRoads=[],biomes,obstacles=[]}={}){
 const fixed=obstacles.filter(r=>r&&['left','right','top','bottom'].every(k=>Number.isFinite(r[k]))&&r.left<r.right&&r.top<r.bottom);
 const terrain=terrainFor(island,hydrology,biomes,fixed),occupied=[],plans=[];
 const arteries=connectingRoads.map(road=>({...road,width:road.width||25}));
 for(const district of [...districts].filter(d=>finite(d.place)).sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
  const {id,place}=district,candidates=candidatesFor(district),plots=[],buildings=[],scenery=[];
  const context={district,terrain,occupied,arteries,candidates};
  let center=centerFor(district,terrain);
  const centerPlot={left:center.x-68,right:center.x+68,top:center.y-68,bottom:center.y+68};
  if(!terrain.dry(centerPlot,true)||occupied.some(r=>overlap(centerPlot,r))||roadTouches(centerPlot,arteries))
   center=nearestSite(center,'work',context);
  const plaza={left:center.x-42,right:center.x+42,top:center.y-34,bottom:center.y+34,id:id+':plaza',kind:'plaza'};
  occupied.push(plaza);plots.push(plaza);
  const add=(preferred,kind,metadata)=>{const site=nearestSite(preferred,kind,context);if(!site)return null;
   const plot={...footprint(site.x,site.y,kind),id:id+':'+metadata.id,kind};occupied.push(plot);plots.push(plot);return site;};
  for(const building of [...(district.buildings||[])].sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
   const s=hash(id+':'+building.id),preferred={x:center.x+(building.x-500)*.85+(s%39)-19,
    y:center.y+(building.y-360)*.85+((s>>>8)%33)-16};
   const site=add(preferred,'work',building);
   buildings.push({...building,x:site.x-place.x,y:site.y-place.y});
  }
  const homes=Math.min(8,Math.ceil(Math.max(0,district.population||0)/8));
  for(let n=0;n<homes;n++){
   const s=hash(id+':home:'+n),angle=(s%628)/100,radius=180+(s>>>10)%155;
   const site=add({x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius*.72},'cottage',{id:'home:'+n});
   if(site)scenery.push({id:id+':home:'+n,kind:'cottage',...site,tone:s%5});
  }
  for(let n=0;n<(homes>2?2:homes?1:0);n++){
   const s=hash(id+':field:'+n),site=add({x:center.x-280+n*480,y:center.y+190+(s%61)-30},'field',{id:'field:'+n});
   if(site)scenery.push({id:id+':field:'+n,kind:'field',...site,w:86,h:46,width:86,depth:46,tone:s%2});
  }
  const well=add({x:center.x+72,y:center.y-32},'well',{id:'well'});
  if(well)scenery.push({id:id+':well',kind:'well',...well});
  const bounds=grow(boundsOf(plots.flatMap(p=>[{x:p.left,y:p.top},{x:p.right,y:p.bottom}])),60);
  plans.push({id,place:{...place},buildings,scenery,plots,bounds,center:{x:center.x,y:center.y},entrance:{x:place.x+500,y:place.y+610},roads:[],clearings:[]});
 }
 const allRoads=[...arteries],water=hydrology.water||[];
 for(const plan of plans){
  const obstacles=[...fixed,...occupied.filter(plot=>!['well','plaza'].includes(plot.kind)).map(plot=>grow(plot,3))];
  const destinations=[plan.center,...plan.buildings.map(b=>({x:plan.place.x+b.x,y:plan.place.y+b.y+40})),
   ...plan.scenery.filter(item=>item.kind==='cottage').map(item=>({x:item.x,y:item.y+28}))];
  const connected=[plan.entrance];
  for(const [index,target] of destinations.entries()){
   const source=[...connected].sort((a,b)=>distance(a,target)-distance(b,target))[0];
   const points=roadRoute(source,target,{island,water,obstacles});
   if(points.length>1)plan.roads.push({id:plan.id+':street:'+index,width:index?23:28,points});
   connected.push(target);
  }
  allRoads.push(...plan.roads);
 }
 const claimed=new Set();
 for(const plan of plans){
  plan.clearings=[clearingFor(plan,terrain,claimed)];
  const localRoads=allRoads.filter(road=>(road.points||[]).some(p=>distance(p,plan.center)<1000));
  for(let n=0;n<40&&plan.scenery.filter(s=>s.kind==='tree'||s.kind==='pine').length<9;n++){
   const s=hash(plan.id+':fringe:'+n),angle=(s%628)/100,radius=270+(s>>>9)%230;
   const x=plan.center.x+Math.cos(angle)*radius,y=plan.center.y+Math.sin(angle)*radius*.75,size=.65+(s%35)/100;
   const rect={left:x-24*size,right:x+24*size,top:y-60*size,bottom:y+12*size};
   if(!terrain.dry(rect)||occupied.some(r=>overlap(grow(rect,12),r))||roadTouches(rect,localRoads))continue;
   plan.scenery.push({id:plan.id+':fringe:'+n,kind:s%3?'tree':'pine',x,y,size,tone:s%2});
  }
 }
 return {settlements:plans,roads:plans.flatMap(p=>p.roads),scenery:plans.flatMap(p=>p.scenery),clearings:plans.flatMap(p=>p.clearings)};
}
