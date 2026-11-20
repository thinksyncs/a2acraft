import {coastalFootprintDry} from './world-coast.js';
import {islandLandRoute,islandRouteWalkable,islandSegmentOnLand} from './world-island-travel.js';
import {meanderRoad} from './world-road-shape.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const hash=value=>{let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const expand=(r,p)=>({left:r.left-p,right:r.right+p,top:r.top-p,bottom:r.bottom+p});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const affinityRoadWidth=similarity=>3+25*clamp(Number(similarity)||0,0,1);
export const VILLAGE_ROAD_MIN_AFFINITY=.45;

export function villageMountainObstacles(biomes={}) {
  return (biomes.ground||[]).filter(p=>p.kind==='mountain').map(p=>({left:p.x,right:p.x+p.width,top:p.y,bottom:p.y+p.depth}));
}

function dryRectangle(area,island) {
  if(island.islets)return coastalFootprintDry(area,island)&&island.landPatches.some(p=>area.left<p.right&&area.right>p.left&&area.top<p.bottom&&area.bottom>p.top);
  const total=(area.right-area.left)*(area.bottom-area.top);
  let covered=0;
  for(const p of island.landPatches||[])covered+=Math.max(0,Math.min(area.right,p.right)-Math.max(area.left,p.left))*Math.max(0,Math.min(area.bottom,p.bottom)-Math.max(area.top,p.top));
  return covered>=total-.001;
}

// A bounded stress layout uses actual vector distances rather than message
// order, random streets, or discrete pages. Centering the entire cloud avoids
// forcing every unrelated topic onto one side of the first conversation.
export function conversationCoordinates(ids,affinity,center={x:400,y:320}) {
  const ordered=[...new Set(ids)].sort(),count=ordered.length;
  if(!count)return new Map();
  const landmarks=count<=180?ordered:ordered.slice(0,48),n=landmarks.length;
  const seeds=[];
  for(const id of landmarks){
    const nearest=seeds.map(group=>({group,score:affinity.similarity(id,group[0])})).sort((a,b)=>b.score-a.score)[0];
    if(nearest&&nearest.score>=.65)nearest.group.push(id);else seeds.push([id]);
  }
  const seeded=new Map();
  seeds.forEach((members,index)=>{
    const angle=index*Math.PI*2/seeds.length,x=Math.cos(angle)*2600,y=Math.sin(angle)*2600;
    members.forEach((id,member)=>{const turn=member*2.399963229728653,radius=50*Math.sqrt(member);seeded.set(id,{x:x+Math.cos(turn)*radius,y:y+Math.sin(turn)*radius});});
  });
  const points=landmarks.map(id=>seeded.get(id));
  const targets=landmarks.map((a,i)=>landmarks.map((b,j)=>i===j?0:180+5800*Math.pow(clamp(affinity.distance(a,b),0,1),4)));
  for(let step=0;step<300;step++){
    const shifts=points.map(()=>({x:0,y:0}));
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const dx=points[j].x-points[i].x,dy=points[j].y-points[i].y,d=Math.hypot(dx,dy)||1;
      const correction=(d-targets[i][j])*.32/Math.max(1,n),x=dx/d*correction,y=dy/d*correction;
      shifts[i].x+=x;shifts[i].y+=y;shifts[j].x-=x;shifts[j].y-=y;
    }
    points.forEach((p,i)=>{p.x+=shifts[i].x;p.y+=shifts[i].y;});
  }
  const origin={x:points.reduce((s,p)=>s+p.x,0)/n,y:points.reduce((s,p)=>s+p.y,0)/n};
  const result=new Map(landmarks.map((id,i)=>[id,{x:center.x+points[i].x-origin.x,y:center.y+points[i].y-origin.y}]));
  for(const id of ordered.slice(landmarks.length)){
    let nearest=landmarks[0],best=-1;
    for(const candidate of landmarks){const score=affinity.similarity(id,candidate);if(score>best){best=score;nearest=candidate;}}
    const base=result.get(nearest),angle=hash(id)/0x100000000*Math.PI*2,radius=180+5800*Math.pow(affinity.distance(id,nearest),4);
    result.set(id,{x:base.x+Math.cos(angle)*radius,y:base.y+Math.sin(angle)*radius});
  }
  return result;
}

function narrowedBridge(b,padding){
  const r={left:b.left??b.x,right:b.right??b.x+b.w,top:b.top??b.y,bottom:b.bottom??b.y+b.h};
  const horizontal=r.right-r.left>=r.bottom-r.top;
  return horizontal?{...r,top:r.top+padding,bottom:r.bottom-padding}:{...r,left:r.left+padding,right:r.right-padding};
}
export function roadRouteIsSafe(points,width,island,{obstacles=[],water=[],bridges=[]}={}) {
  const padding=width/2+5;
  if(!islandRouteWalkable(points,island,{obstacles:obstacles.map(r=>expand(r,padding)),water:water.map(r=>expand(r,padding)),
    bridges:bridges.map(b=>narrowedBridge(b,padding)).filter(r=>r.left<r.right&&r.top<r.bottom)}))return false;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=distance(a,b);if(!length)continue;
    const nx=-(b.y-a.y)/length*padding,ny=(b.x-a.x)/length*padding;
    for(const sign of [-1,1])if(!islandSegmentOnLand({x:a.x+nx*sign,y:a.y+ny*sign},{x:b.x+nx*sign,y:b.y+ny*sign},island))return false;
  }
  return true;
}

/** One source of positions/roads for painting, 3D projection and walking. */
export function buildVillageSemanticLayout({residents=[],projects=[],affinity,island,terrain={},obstacles=[],biomes={}}) {
  const ids=residents.map(r=>r.conversationId),coordinates=conversationCoordinates(ids,affinity,{x:(island.bounds.left+island.bounds.right)/2,y:(island.bounds.top+island.bounds.bottom)/2}),projectsById=new Map(projects.map(p=>[p.conversationId,p]));
  const mountains=villageMountainObstacles(biomes),natural=[...mountains,...(biomes.scenery||[]).map(p=>({left:p.x,right:p.x+p.width,top:p.y,bottom:p.y+p.depth}))];
  const water=terrain.water||[],fixed=[...obstacles,...mountains],candidates=[];
  const fixedRoads=(terrain.roads||[]).flatMap(road=>(road.points||[]).slice(1).map((b,i)=>{const a=road.points[i],r=(road.width||25)/2+4;return {left:Math.min(a.x,b.x)-r,right:Math.max(a.x,b.x)+r,top:Math.min(a.y,b.y)-r,bottom:Math.max(a.y,b.y)+r};}));
  // Existing core plots remain candidates; additional plots extend over the
  // actual continent. A complete dry clearing includes the doorstep and patrol.
  for(let y=Math.ceil(island.bounds.top/170)*170+10;y<island.bounds.bottom-100;y+=170){
    for(let x=Math.ceil(island.bounds.left/160)*160+70;x<island.bounds.right-85;x+=160){
      const point={x,y},clearing={left:x-72,right:x+72,top:y-80,bottom:y+86};
      const footprint={left:x-62,right:x+62,top:y-72,bottom:y+24};
      if(!dryRectangle(clearing,island)||water.some(r=>overlap(clearing,r))||natural.some(r=>overlap(clearing,r))||obstacles.some(r=>overlap(clearing,r))||fixedRoads.some(r=>overlap(footprint,r)))continue;
      candidates.push(point);
    }
  }
  const used=new Set(),unreachable=new Set(),homes=new Map(),placedProjects=[],clearings=[];
  const reachability={obstacles:fixed,water,bridges:terrain.bridges||[]};
  const reachable=[{x:490,y:430}];
  for(const id of [...ids].sort()){
    const goal=coordinates.get(id),project=projectsById.get(id);let best=-1;
    const ordered=candidates.map((p,index)=>({index,cost:distance(goal,p)})).filter(p=>!used.has(p.index)&&!unreachable.has(p.index)).sort((a,b)=>a.cost-b.cost);
    for(const candidate of ordered){
      const p=candidates[candidate.index],door={x:p.x,y:p.y+(project?52:25)};
      const anchor=reachable.reduce((best,p)=>distance(p,door)<distance(best,door)?p:best,reachable[0]);
      if(islandRouteWalkable([anchor,door],island,reachability)||islandLandRoute(anchor,door,island,reachability).length){best=candidate.index;break;}
      unreachable.add(candidate.index);
    }
    if(best<0)continue;
    used.add(best);const point=candidates[best],home={x:point.x,y:point.y+(project?52:25)};
    const patrol=[{x:home.x-22,y:home.y},{x:home.x+22,y:home.y},{x:home.x+22,y:home.y+18},{x:home.x-22,y:home.y+18}];
    homes.set(id,{...home,patrol,conversationId:id});
    reachable.push(home);
    const left=point.x-(project?72:40),right=point.x+(project?72:40),top=point.y-(project?80:16),bottom=point.y+(project?86:62);
    clearings.push({id:'conversation-clearing:'+id,kind:'clearing',color:'#829650',patches:[
      {left:left+16,right:right-16,top,bottom:top+16},
      {left,right,top:top+16,bottom:bottom-16},
      {left:left+16,right:right-16,top:bottom-16,bottom}]});
    if(project)placedProjects.push({...project,...point});
  }
  const buildingObstacles=placedProjects.map(p=>({left:p.x-62,right:p.x+62,top:p.y-72,bottom:p.y+24}));
  const solid=[...fixed,...buildingObstacles],roads=[],groups=[];
  const placed=[...homes.keys()].sort();
  const clusters=[],groupById=new Map(),roadCounts=new Map();
  for(const id of placed){
    const best=clusters.map((members,index)=>({members,index,score:affinity.similarity(id,members[0])})).sort((a,b)=>b.score-a.score)[0];
    if(best&&best.score>=.18){best.members.push(id);groupById.set(id,best.index);}
    else{groupById.set(id,clusters.length);clusters.push([id]);}
  }
  const candidatesEdges=[];
  for(let i=0;i<placed.length;i++)for(let j=0;j<Math.min(i,placed.length<=180?180:48);j++){
    const from=placed[j],to=placed[i],similarity=affinity.similarity(from,to);
    if(similarity>=VILLAGE_ROAD_MIN_AFFINITY)candidatesEdges.push({from,to,similarity,length:distance(homes.get(from),homes.get(to))});
  }
  candidatesEdges.sort((a,b)=>b.similarity-a.similarity||a.length-b.length||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  const parents=new Map(placed.map(id=>[id,id]));
  const find=(map,id)=>{let p=id;while(map.get(p)!==p)p=map.get(p);while(map.get(id)!==p){const next=map.get(id);map.set(id,p);id=next;}return p;};
  const join=(map,a,b)=>{a=find(map,a);b=find(map,b);if(a===b)return false;map.set(b,a);return true;};
  // A maximum-affinity forest joins nearest equivalents first. Weak links
  // stay invisible; separate topics do not need decorative connecting roads.
  let detours=0;
  for(const edge of candidatesEdges){
    const {from,to,similarity}=edge;
    if(roads.length>=40)break;
    const connectedGroups=[...new Set([groupById.get(from),groupById.get(to)])];
    if(connectedGroups.some(group=>(roadCounts.get(group)||0)>=3))continue;
    if(find(parents,from)===find(parents,to))continue;
    const width=affinityRoadWidth(similarity),padding=width/2+5;
    const options={obstacles:solid.map(r=>expand(r,padding)),water:water.map(r=>expand(r,padding)),
      bridges:(terrain.bridges||[]).map(b=>narrowedBridge(b,padding)).filter(r=>r.left<r.right&&r.top<r.bottom)};
    const safe=points=>roadRouteIsSafe(points,width,island,{obstacles:solid,water,bridges:terrain.bridges||[]});
    let points=[homes.get(from),homes.get(to)];
    if(!safe(points)){if(detours>=32)continue;detours++;points=islandLandRoute(homes.get(from),homes.get(to),island,options);}
    if(points.length&&safe(points)){
      points=meanderRoad(points,{seed:from+':'+to,amplitude:32,step:72,isSafe:safe});
      roads.push({id:'affinity:'+from+':'+to,from,to,similarity,width,points});join(parents,from,to);
      for(const group of connectedGroups)roadCounts.set(group,(roadCounts.get(group)||0)+1);
    }
  }
  for(const members of clusters)groups.push({conversationId:members[0],count:members.length,
    x:members.reduce((s,id)=>s+homes.get(id).x,0)/members.length,y:members.reduce((s,id)=>s+homes.get(id).y,0)/members.length});
  return {version:'conversation-world-v1',homes,projects:placedProjects,roads,neighborhoods:groups,mountains,clearings,unplaced:ids.filter(id=>!homes.has(id))};
}
