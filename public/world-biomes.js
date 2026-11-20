import {coastalFootprintDry} from './world-coast.js';
// Natural scenery for the wider world, shared by the atlas and 3D projection.
// These places never create work, residents, buildings or progress.
export const BIOME_COLORS = Object.freeze({woodland:'#456f45',mountain:'#a79c78',moor:'#aaa16d'});

// Each patch has a handful of landmarks, not one mesh per decorative tree.
// Both projections use these world-space positions and dimensions.
export function biomeLandmarks(item) {
  if(!['woodland','mountain-range'].includes(item?.kind))return [];
  const w=Number(item.width),d=Number(item.depth);
  if(![item.x,item.y,w,d].every(Number.isFinite)||w<=0||d<=0)return [];
  const trees=item.kind==='woodland';
  const slots=trees?[[.27,.42],[.68,.46],[.46,.77]]:[[.28,.50],[.68,.58],[.46,.82]];
  return slots.map(([px,py],index)=>({id:item.id+':'+index,kind:trees?'biome-tree':'biome-mountain',
    x:item.x+w*px,y:item.y+d*py,width:w*(trees?.22:.31),depth:d*(trees?.20:.22),
    height:Math.min(w,d)*(trees?.27:.43),tone:((item.tone||0)+index)%3}));
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
  const scenery=[],ground=[],rows=new Map();
  let active=new Map();
  for(let gy=Math.floor(bounds.top/step);gy<Math.ceil(bounds.bottom/step);gy++){
    const row=[];
    for(let gx=Math.floor(bounds.left/step);gx<Math.ceil(bounds.right/step);gx++){
      const rect={left:gx*step,right:(gx+1)*step,top:gy*step,bottom:(gy+1)*step};
      if((island.islets?!coastalFootprintDry(rect,island):!coveredByLand(rect,island.landPatches))||clearings.some(area=>overlaps(rect,area))||
        rivers.some(area=>overlaps(rect,area))||segments.some(segment=>crossesRoad(rect,segment)))continue;
      const wet=Math.sin(gx*.23)+Math.cos(gy*.31)*.6+Math.sin((gx-gy)*.17)*.35;
      const ridge=Math.sin(gx*.31+Math.sin(gy*.16)*1.8);
      const kind=ridge>.7&&wet<.75?'mountain':wet>.12?'woodland':wet<-.68?'moor':null;
      if(!kind)continue;
      row.push({gx,kind});
      const identity=hash(gx+':'+gy);
      if(kind==='moor'||identity%7===0)continue;
      scenery.push({id:`biome:${gx}:${gy}`,kind:kind==='woodland'?'woodland':'mountain-range',
        x:rect.left,y:rect.top,width:step,depth:step,height:step*(kind==='woodland'?.3:.65),tone:identity%3});
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
  return {ground,scenery,step};
}
