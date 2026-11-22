import {coastalFootprintDry} from './world-coast.js';
// Natural scenery for the wider world, shared by the atlas and 3D projection.
// These places never create work, residents, buildings or progress.
export const BIOME_COLORS = Object.freeze({woodland:'#456f45',mountain:'#a79c78',moor:'#aaa16d'});

// A range spans several map cells. Sample its crest in world space so that
// a cell boundary cannot restart the pattern or align the summits in rows.
function ridgePeaks(item) {
  const w=item.width,d=item.depth,col=item.x/w,row=item.y/d;
  const band=Math.round((col*.31+1.8*Math.sin((row+.5)*.16)-Math.PI/2)/(2*Math.PI));
  const phase=(hash('ridge:'+band)%1000)/1000*Math.PI*2;
  const spine=y=>(Math.PI/2+band*2*Math.PI-1.8*Math.sin(y*.16))/.31+
    .53*Math.sin(y*.73+phase)+.23*Math.sin(y*1.24-phase);
  const peaks=[];
  for(const spur of [false,true]){
    // Spurs rise away from the crest, alternating sides and ending in low hills.
    const spacing=spur?.67:.53,period=6.4;
    const branch=y=>{const reach=(y+phase)/period,age=reach-Math.floor(reach);
      return {age,x:spine(y)+(Math.floor(reach)%2===0?1:-1)*age*4.65};};
    for(let n=Math.floor(row/spacing)-1;n<=Math.ceil((row+1)/spacing);n++){
      const id=`ridge:${band}:${spur?'spur':'crest'}:${n}`;
      const variation=salt=>hash(id+':'+salt)/4294967296;
      const y=(n+.18+variation('station')*.62)*spacing;
      if(y<row||y>=row+1)continue;
      const limb=branch(y);
      if(spur&&(limb.age<.06||limb.age>.56))continue;
      const x=spur?limb.x:spine(y);
      if(x<col||x>=col+1)continue;
      const dx=spur?branch(y+.045).x-branch(y-.045).x:spine(y+.045)-spine(y-.045);
      const prominence=spur?.75-limb.age*.72:.78+.26*Math.sin(y*1.51+phase);
      const width=(1.06+variation('talus')*.55)*prominence;
      const depth=(1.09+variation('extent')*.32)*(spur?.80:1);
      peaks.push({id,kind:'biome-mountain',x:x*w,y:y*d,height:Math.min(w,d)*
        (.44+variation('summit')*.48)*prominence*(spur?.82:1),width:w*width,depth:d*depth,
        heading:Math.atan2(-dx*w,.09*d),tone:Math.floor(variation('stone')*3)});
    }
  }
  return peaks;
}

// Each patch has a handful of landmarks, not one mesh per decorative tree.
// Both projections use these world-space positions and dimensions.
export function biomeLandmarks(item) {
  if(!['woodland','mountain-range'].includes(item?.kind))return [];
  const w=Number(item.width),d=Number(item.depth);
  if(![item.x,item.y,w,d].every(Number.isFinite)||w<=0||d<=0)return [];
  if(item.peak)return [item.peak];
  const id=item.id??`${item.kind}:${item.x}:${item.y}`;
  let seed=hash(id);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const tone=Number.isFinite(item.tone)?Math.abs(Math.trunc(item.tone)):0;
  const marker=(index,kind,px,py,width,depth,height)=>({
    id:id+':'+index,kind,x:item.x+w*Math.max(width/2,Math.min(1-width/2,px)),
    y:item.y+d*Math.max(depth/2,Math.min(1-depth/2,py)),width:w*width,depth:d*depth,
    height:Math.min(w,d)*height,tone:(tone+index)%3,
  });
  const landmarks=[];
  if(item.kind==='woodland'){
    const cx=.35+random()*.3,cy=.35+random()*.3,rotation=random()*2*Math.PI;
    const density=.53+.23*Math.sin(item.x/w*.87+item.y/d*.41)+.24*Math.cos(item.y/d*.58-item.x/w*.3);
    const count=1+Math.floor(density*2.7+random()*2),conifers=random();
    for(let i=0;i<count;i++){
      const angle=rotation+(i+random()*.36)*Math.PI*2/count;
      const radius=.09+random()*.23,width=.23+random()*.20,depth=width*(.85+random()*.2);
      const pine=random()<conifers;
      landmarks.push({...marker(i,'biome-tree',cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius,
        width,depth,width*(pine?1.32:.96)),conifer:pine});
    }
  }else{
    for(const p of ridgePeaks(item))landmarks.push({...marker(landmarks.length,p.kind,
      (p.x-item.x)/w,(p.y-item.y)/d,Math.min(1,p.width/w),Math.min(1,p.depth/d),p.height/Math.min(w,d)),heading:p.heading});
  }
  // Far canopies and summits paint first in the overhead view.
  return landmarks.sort((a,b)=>a.y-b.y);
}
const finiteRect = rect => rect && ['left','right','top','bottom'].every(key=>Number.isFinite(rect[key])) && rect.left<rect.right && rect.top<rect.bottom;
const overlaps = (a,b) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
const grow = (rect,padding) => ({left:rect.left-padding,right:rect.right+padding,top:rect.top-padding,bottom:rect.bottom+padding});
const hash = value => {let result=2166136261;for(const char of String(value))result=Math.imul(result^char.charCodeAt(0),16777619);return result>>>0;};

// Area coverage catches bays crossing a patch even when all four corners are dry.
function coveredByLand(rect, patches) {
  const area=(rect.right-rect.left)*(rect.bottom-rect.top);
  let covered=0;
  for(const patch of patches) covered+=Math.max(0,Math.min(rect.right,patch.right)-Math.max(rect.left,patch.left))*
    Math.max(0,Math.min(rect.bottom,patch.bottom)-Math.max(rect.top,patch.top));
  return covered>=area-Math.max(1,area)*1e-9;
}

function crossesRoad(rect, {a,b,radius}) {
  const box=grow(rect,radius),dx=b.x-a.x,dy=b.y-a.y;
  let from=0,to=1;
  for(const [p,q] of [[-dx,a.x-box.left],[dx,box.right-a.x],[-dy,a.y-box.top],[dy,box.bottom-a.y]]){
    if(!p){if(q<0)return false;continue;}
    const amount=q/p;
    if(p<0)from=Math.max(from,amount);else to=Math.min(to,amount);
    if(from>to)return false;
  }
  return true;
}

/** Returns top-left anchored ground patches and bounded groups of natural landmarks. */
export function worldBiomes(island, {regions=[],roads=[],facilities=[],water=[]}={}) {
  if(!finiteRect(island?.bounds)||!Array.isArray(island.landPatches))return {ground:[],scenery:[],step:0};
  const bounds=island.bounds,span=Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top);
  const step=Math.max(240,Math.ceil(span/48/40)*40);
  const clearings=regions.filter(finiteRect).map(rect=>grow(rect,100));
  for(const place of facilities)if(Number.isFinite(place.x)&&Number.isFinite(place.y))clearings.push({
    left:place.x-(place.width||180)/2-100,right:place.x+(place.width||180)/2+100,
    top:place.y-(place.depth||160)/2-120,bottom:place.y+(place.depth||160)/2+120});
  const rivers=water.filter(finiteRect).map(rect=>grow(rect,45));
  const segments=roads.flatMap(road=>(road.points||[]).slice(1).map((b,index)=>({a:road.points[index],b,
    radius:Math.max(0,road.width||25)/2+65}))).filter(({a,b})=>[a?.x,a?.y,b?.x,b?.y].every(Number.isFinite));
  const clearLand=rect=>(island.islets?coastalFootprintDry(rect,island):coveredByLand(rect,island.landPatches))&&
    !clearings.some(area=>overlaps(rect,area))&&!rivers.some(area=>overlaps(rect,area))&&
    !segments.some(segment=>crossesRoad(rect,segment));
  const scenery=[],ground=[],rows=new Map();
  let active=new Map();
  for(let gy=Math.floor(bounds.top/step);gy<Math.ceil(bounds.bottom/step);gy++){
    const row=[];
    for(let gx=Math.floor(bounds.left/step);gx<Math.ceil(bounds.right/step);gx++){
      const rect={left:gx*step,right:(gx+1)*step,top:gy*step,bottom:(gy+1)*step};
      if(!clearLand(rect))continue;
      const wet=Math.sin(gx*.23)+Math.cos(gy*.31)*.6+Math.sin((gx-gy)*.17)*.35;
      const ridge=Math.sin(gx*.31+Math.sin(gy*.16)*1.8);
      const kind=ridge>.7&&wet<.75?'mountain':wet>.12?'woodland':wet<-.68?'moor':null;
      if(!kind)continue;
      row.push({gx,kind});
      const identity=hash(gx+':'+gy);
      if(kind==='mountain'){
        for(const peak of ridgePeaks({x:rect.left,y:rect.top,width:step,depth:step})){
          const x=peak.x-peak.width/2,y=peak.y-peak.depth/2;
          if(clearLand({left:x,right:x+peak.width,top:y,bottom:y+peak.depth}))
            scenery.push({id:peak.id,kind:'mountain-range',x,y,width:peak.width,depth:peak.depth,height:peak.height,peak});
        }
      }else if(kind==='woodland'&&identity%7!==0){
        scenery.push({id:`biome:${gx}:${gy}`,kind:'woodland',x:rect.left,y:rect.top,
          width:step,depth:step,height:step*.3,tone:identity%3});
      }
    }
    rows.set(gy,row);
    const next=new Map();
    for(let index=0;index<row.length;index++){
      const first=row[index];let last=first.gx;
      while(index+1<row.length&&row[index+1].gx===last+1&&row[index+1].kind===first.kind){last++;index++;}
      const key=first.gx+':'+last+':'+first.kind;
      const patch=active.get(key)||{id:'biome-ground:'+key+':'+gy,kind:first.kind,x:first.gx*step,y:gy*step,
        width:(last-first.gx+1)*step,depth:0,color:BIOME_COLORS[first.kind]};
      if(!active.has(key))ground.push(patch);
      patch.depth+=step;next.set(key,patch);
    }
    active=next;
  }
  return {ground,scenery,step,landColor:island.landColor || '#78924f'};
}
