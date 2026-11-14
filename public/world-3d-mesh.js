import {cross, normalize, subtract, finite, clamp, worldBounds} from './world-3d-math.js';
import {pointInIsland} from './world-island.js';
import {biomeLandmarks} from './world-biomes.js';

const PALETTE = ['#b99a72', '#c3aa85', '#d2bb8c', '#acb8a4', '#c6a895'];
const CLOTHES = ['#c8794e', '#547e9a', '#8b6596', '#5d8c70', '#b59c58', '#537783'];
export function hash(value) {
  let result = 2166136261;
  for (const char of String(value ?? '')) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function color(value, fallback = '#b99a72') {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite))
    return value.slice(0, 3).map(v => clamp(v, 0, 1));
  const text = typeof value === 'string' ? value.trim() : fallback;
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(text);
  if (short) return short.slice(1).map(v => parseInt(v + v, 16) / 255);
  if (/^#[\da-f]{6}$/i.test(text)) return [1, 3, 5].map(i => parseInt(text.slice(i, i + 2), 16) / 255);
  return color(fallback);
}
function triangle(out, a, b, c, shade) {
  const normal = normalize(cross(subtract(b, a), subtract(c, a)));
  for (const point of [a, b, c]) out.push(...point, ...normal, ...shade);
}
function quad(out, a, b, c, d, shade) {
  triangle(out, a, b, c, shade); triangle(out, a, c, d, shade);
}
function positioned(point, x, y, z, heading) {
  const cosine = Math.cos(heading), sine = Math.sin(heading);
  return [x + point[0] * cosine - point[2] * sine, y + point[1], z + point[0] * sine + point[2] * cosine];
}
export function box(out, x, y, z, width, height, depth, shade, heading = 0) {
  const w = width / 2, d = depth / 2;
  const vertices = [[-w, 0, -d], [w, 0, -d], [w, height, -d], [-w, height, -d],
    [-w, 0, d], [w, 0, d], [w, height, d], [-w, height, d]]
    .map(p => positioned(p, x, y, z, heading));
  for (const face of [[1, 0, 3, 2], [4, 5, 6, 7], [0, 4, 7, 3], [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4]])
    quad(out, ...face.map(i => vertices[i]), shade);
}
function roof(out, x, y, z, width, rise, depth, shade) {
  const w = width / 2, d = depth / 2;
  const [a, b, c, e, f, g] = [[-w, 0, -d], [w, 0, -d], [0, rise, -d], [-w, 0, d], [w, 0, d], [0, rise, d]]
    .map(p => [p[0] + x, p[1] + y, p[2] + z]);
  triangle(out, b, a, c, shade); triangle(out, e, f, g, shade);
  // Tile courses are part of the original slopes, not coplanar overlays.
  // This gives the roof depth up close without changing its footprint or
  // introducing flickering extra surfaces at the island overview distance.
  const rows=Math.max(3,Math.min(9,Math.round(Math.hypot(w,rise)/9)));
  for(let row=0;row<rows;row++){
    const start=row/rows,end=(row+1)/rows,seam=start+.08/rows;
    for(const [low,high,tint]of [[start,seam,.83],[seam,end,row%3===0?.96:1.03]]){
      const rowShade=shade.map(channel=>Math.min(1,channel*tint));
      for(const side of [-1,1]){
        const outer=[x+side*w*(1-low),y+rise*low],inner=[x+side*w*(1-high),y+rise*high];
        const front=[outer[0],outer[1],z-d],back=[outer[0],outer[1],z+d],
          upperFront=[inner[0],inner[1],z-d],upperBack=[inner[0],inner[1],z+d];
        if(side<0)quad(out,front,back,upperBack,upperFront,rowShade);
        else quad(out,front,upperFront,upperBack,back,rowShade);
      }
    }
  }
}
function cone(out, x, y, z, radius, height, shade) {
  const tip = [x, y + height, z];
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7, b = (i + 1) * Math.PI * 2 / 7;
    triangle(out, [x + Math.sin(a) * radius, y, z + Math.cos(a) * radius],
      [x + Math.sin(b) * radius, y, z + Math.cos(b) * radius], tip, shade);
  }
}
export function buildingShape(building = {}) {
  const kind = building.kind || 'house';
  return {x: finite(building.x), y: finite(building.y),
    width: clamp(finite(building.width, kind === 'castle' ? 130 : 70), 12, 600),
    depth: clamp(finite(building.depth, kind === 'castle' ? 100 : 58), 12, 600),
    height: clamp(finite(building.height, kind === 'castle' ? 80 : 48), 10, 250),
    stage: building.stage || 'finished', kind};
}
function buildingMesh(out, building) {
  const {x, y: z, width: w, depth: d, height: h, stage, kind} = buildingShape(building);
  const wall = color(building.color, PALETTE[hash(building.id) % PALETTE.length]);
  const stone = color('#8e9a91'), wood = color('#795d41');
  box(out, x, 0.6, z, w + 8, 3, d + 8, stone);
  box(out, x, .65, z, w + 8, .8, d + 8, color('#707b6c'));
  if (stage === 'planned' || stage === 'plan') {
    for (const dx of [-w / 2, w / 2]) for (const dz of [-d / 2, d / 2]) box(out, x + dx, 3, z + dz, 3, 13, 3, wood);
    box(out, x, 3, z, w - 6, 1, d - 6, color('#d2c69e'));
    return;
  }
  const constructing = ['building', 'construction', 'implement'].includes(stage);
  const wallHeight = constructing ? h * 0.62 : h;
  box(out, x, 3, z, w, wallHeight, d, wall);
  // Recessed-looking plaster panels, timber corners and an eave shadow give
  // the same low-poly house a grounded facade; the model's bounds stay fixed.
  const front=z+d/2;
  for(const dx of [-w*.46,w*.46])box(out,x+dx,3,front+.35,2.2,wallHeight,.8,wood);
  box(out,x,wallHeight+1,front+.4,w,2,.9,color('#65513c'));
  box(out,x,3.2,front+.4,w,2,.9,color('#a7a18a'));
  const doorColor = color('#594a3a'), glass = color('#8bc3c4');
  box(out, x, 3, z + d / 2 + 0.5, Math.min(16, w / 4), wallHeight * 0.53, 1.2, doorColor);
  for(const dx of [-.25,0,.25])box(out,x+dx*Math.min(16,w/4),3.5,front+1.15,.65,wallHeight*.5,.2,color('#796047'));
  box(out,x+Math.min(5,w/12),wallHeight*.26+3,front+1.5,1.2,1.2,.5,color('#c2a366'));
  for (const dx of [-w * 0.29, w * 0.29]) {
    box(out, x + dx, 3 + wallHeight * 0.46, z + d / 2 + 0.7, w * 0.15, wallHeight * 0.23, 1, wood);
    box(out, x + dx, 4 + wallHeight * 0.46, z + d / 2 + 1.4, w * 0.15 - 2, wallHeight * 0.23 - 2, 0.6, glass);
    box(out,x+dx,4+wallHeight*.46,front+1.8,1,wallHeight*.23-2,.5,wood);
    box(out,x+dx,4+wallHeight*.57,front+1.8,Math.max(1,w*.15-2),1,.5,wood);
    box(out,x+dx,3+wallHeight*.46,front+1.6,w*.15+3,1.4,2,color('#c5b390'));
  }
  if (constructing) {
    for (const dx of [-w / 2 - 5, w / 2 + 5]) for (const dz of [-d / 2 - 5, d / 2 + 5]) box(out, x + dx, 0, z + dz, 3, h + 12, 3, wood);
    for (const level of [wallHeight * 0.5, wallHeight + 9]) {
      box(out, x, level, z - d / 2 - 5, w + 14, 3, 3, wood);
      box(out, x, level, z + d / 2 + 5, w + 14, 3, 3, wood);
    }
    roof(out, x, wallHeight + 3, z, w * 0.65, h * 0.32, d * 0.65, color('#bc9561'));
  } else if (kind === 'castle') {
    box(out, x, h + 3, z, w + 8, 7, d + 8, stone);
    for (const dx of [-w * 0.43, w * 0.43]) for (const dz of [-d * 0.4, d * 0.4]) {
      box(out, x + dx, 3, z + dz, w * 0.21, h * 1.3, d * 0.23, stone);
      roof(out, x + dx, h * 1.3 + 3, z + dz, w * 0.25, h * 0.35, d * 0.27, color('#667d95'));
    }
  } else {
    const roofColor = kind === 'weapon' || kind === 'shop' ? '#477d6d' : stage === 'testing' ? '#647c96' : '#a96047';
    roof(out, x, h + 3, z, w + 12, h * 0.42, d + 12, color(roofColor));
    box(out, x + w * 0.28, h + 10, z - d * 0.17, 9, h * 0.4, 9, color('#9b8b76'));
  }
  // A stage flag comes from the recorded state, never from elapsed animation time.
  box(out, x + w / 2 + 9, 1, z + d / 2, 1.8, 30, 1.8, wood);
  const flag = stage === 'testing' ? '#6ca5c1' : constructing ? '#daa259' : '#6d9b70';
  box(out, x + w / 2 + 15, 22, z + d / 2, 12, 8, 0.8, color(flag));
}
function road(out, from, to, width, height = 0.16, rounded = false) {
  const dx = to.x - from.x, dz = to.y - from.y, length = Math.hypot(dx, dz);
  if (!length) return;
  if(rounded){
    // The atlas uses a round stroked path. A single top surface and round caps
    // keep diagonal bends continuous without a competing box underside.
    const sideX=dz/length*width/2,sideZ=-dx/length*width/2;
    const elevation=height+.2,shade=color(height>1?'#a58a61':'#cbb77b');
    quad(out,[from.x-sideX,elevation,from.y-sideZ],[to.x-sideX,elevation,to.y-sideZ],
      [to.x+sideX,elevation,to.y+sideZ],[from.x+sideX,elevation,from.y+sideZ],shade);
    for(const point of [from,to])for(let i=0;i<16;i++){
      const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
      triangle(out,[point.x,elevation,point.y],
        [point.x+Math.cos(b)*width/2,elevation,point.y+Math.sin(b)*width/2],
        [point.x+Math.cos(a)*width/2,elevation,point.y+Math.sin(a)*width/2],shade);
    }
    return;
  }
  box(out, (from.x + to.x) / 2, height, (from.y + to.y) / 2, width, 0.2, length, color(height > 1 ? '#a58a61' : '#c4b385'), -Math.atan2(dx, dz));
}
// Cut water out of the ground instead of stacking nearly coplanar surfaces.
// Large overview distances otherwise expose depth-buffer stripes on the river.
export function waterRectangle(region) {
  if (![region?.left,region?.right,region?.top,region?.bottom].every(Number.isFinite)) return null;
  const rect={left:Math.min(region.left,region.right),right:Math.max(region.left,region.right),
    top:Math.min(region.top,region.bottom),bottom:Math.max(region.top,region.bottom)};
  return rect.right>rect.left&&rect.bottom>rect.top?rect:null;
}
export function groundRectangles(bounds, water = []) {
  return cutGroundRectangles([{left: bounds.left - 200, right: bounds.right + 200,
    top: bounds.top - 200, bottom: bounds.bottom + 200}],water);
}
function cutGroundRectangles(source,water=[]) {
  let patches=source.map(rect=>({...rect}));
  for (const region of water) {
    const rect = waterRectangle(region), next = [];
    if(!rect)continue;
    for (const patch of patches) {
      const left = Math.max(patch.left, rect.left), right = Math.min(patch.right, rect.right);
      const top = Math.max(patch.top, rect.top), bottom = Math.min(patch.bottom, rect.bottom);
      if (left >= right || top >= bottom) {next.push(patch); continue;}
      if (patch.top < top) next.push({...patch, bottom: top});
      if (bottom < patch.bottom) next.push({...patch, top: bottom});
      if (patch.left < left) next.push({...patch,left: patch.left, right: left, top, bottom});
      if (right < patch.right) next.push({...patch,left: right, right: patch.right, top, bottom});
    }
    patches = next;
  }
  return patches;
}
function intersectGroundRectangles(source,regions){
  const result=[];
  for(const rect of source)for(const region of regions){
    const left=Math.max(rect.left,region.left),right=Math.min(rect.right,region.right),
      top=Math.max(rect.top,region.top),bottom=Math.min(rect.bottom,region.bottom);
    if(left<right&&top<bottom)result.push({...rect,left,right,top,bottom});
  }
  return result;
}

function islandShoreRectangles(island) {
  const radius=(island.shoreWidth||18)/2;
  return island.coast.map((a,index)=>{
    const b=island.coast[(index+1)%island.coast.length];
    return {left:Math.min(a.x,b.x)-radius,right:Math.max(a.x,b.x)+radius,
      top:Math.min(a.y,b.y)-radius,bottom:Math.max(a.y,b.y)+radius};
  });
}

function sceneryMesh(out,item){
  const x=finite(item.x),z=finite(item.y),size=clamp(finite(item.size,finite(item.scale,1)),.1,4);
  if(item.kind==='woodland'||item.kind==='mountain-range'){
    for(const marker of biomeLandmarks(item)){
      const {x,y:z,width:w,depth:d,height:h}=marker;
      if(marker.kind==='biome-tree'){
        box(out,x,.06,z,w*.1,h*.38,d*.1,color('#6b543b'));
        cone(out,x,h*.17,z,w*.5,h*.78,color('#274e38'));
        cone(out,x,h*.43,z,w*.37,h*.57,color(marker.tone?'#547b49':'#467346'));
      }else{
        cone(out,x,.06,z,w*.5,h,color('#746c57'));
        cone(out,x,h*.69,z,w*.15,h*.31,color('#d3ccb0'));
      }
    }
  }else if(item.kind==='tree'||item.kind==='pine'){
    const pine=item.kind==='pine',height=(pine?51:45)*size;
    box(out,x,0,z,5*size,17*size,5*size,color('#71533b'));
    cone(out,x,8*size,z,18*size,height-8*size,color(pine?'#426a49':item.tone?'#557849':'#467044'));
    cone(out,x,22*size,z,13*size,height-22*size,color(pine?'#57794c':item.tone?'#719452':'#64884c'));
  }else if(item.kind==='well'){
    const stone=color('#b9b99b'),wood=color('#9a774b');
    box(out,x,1,z+4,28,5,24,stone);box(out,x,6,z+4,18,1,14,color('#3d696b'));
    for(const dx of [-12,12])box(out,x+dx,6,z+4,4,6,24,stone);
    for(const dz of [-6,14])box(out,x,6,z+dz,20,6,4,stone);
    for(const dx of [-14,14])box(out,x+dx,0,z+4,4,32,4,wood);
    roof(out,x,30,z+4,48,13,32,color('#ab8652'));
    box(out,x,12,z+4,1,17,1,color('#bdad7e'));
  }else if(item.kind==='field'){
    const w=clamp(finite(item.w,finite(item.width,92)),4,600),d=clamp(finite(item.h,finite(item.depth,48)),4,600);
    box(out,x+w/2,.2,z+d/2,w,.4,d,color('#685c36'));
    for(let row=5;row<d;row+=9){
      box(out,x+w/2,.6,z+row,w-6,.3,3,color('#9a8750'));
      for(let col=7;col<w;col+=12)box(out,x+col,1,z+row,4,item.tone?7:4,4,color(item.tone?'#b4a15b':'#6d994d'));
    }
    for(let col=0;col<w;col+=18)box(out,x+col,0,z+d+4,3,8,3,color('#c4ae74'));
    box(out,x+w/2,4,z+d+4,w,2,2,color('#a48e59'));
  }else if(item.kind==='rock'){
    box(out,x,0,z,19*size,7*size,13*size,color('#7d9073'));
    cone(out,x,6*size,z,10*size,7*size,color('#a1aa8a'));
  }else if(item.kind==='cottage'){
    const colors=['#a9563b','#416a71','#77724c','#665774'];
    const center=z-10;
    box(out,x,0,center,38,27,28,color('#d5c18a'));
    box(out,x,0,z+4.5,10,16,1,color('#5c5941'));
    box(out,x-10,10,z+4.6,7,7,1,color('#3f6766'));
    roof(out,x,27,center,52,20,38,color(colors[Math.abs(Math.trunc(finite(item.tone)))%colors.length]));
    box(out,x+14,27,center-5,6,19,6,color('#aa9870'));
  }else if(item.kind==='signpost'){
    const width=clamp(finite(item.width,39),8,80),height=clamp(finite(item.height,31),12,80),depth=clamp(finite(item.depth,4),1,12);
    box(out,x,0,z,4,height,4,color('#715738'));
    box(out,x,height-12,z,width,12,depth,color('#c8a66a'));
    box(out,x,height-2,z,width,2,depth+.1,color('#e1c18b'));
    const front=z+depth/2+.1,ink=color('#715b38'),direction=Math.sign(finite(item.direction));
    if(direction){
      box(out,x,height-6,front,width*.55,1,.2,ink);
      triangle(out,[x+direction*12,height-6,front+.2],[x+direction*6,height-2,front+.2],[x+direction*6,height-10,front+.2],ink);
    }else{
      for(const sign of [-1,1])quad(out,[x-7,height-4*sign-7,front],[x-7,height-4*sign-5,front],
        [x+7,height+4*sign-5,front],[x+7,height+4*sign-7,front],ink);
    }
  }else if(item.kind==='clearing'){
    // Terrain-shaped city clearings own dry rectangle footprints and are
    // emitted with the ground below, not as a second polygon over the grass.
    if(Array.isArray(item.patches))return;
    const points=(Array.isArray(item.points)?item.points:[]).filter(point=>Array.isArray(point)&&point.length>=2&&point.slice(0,2).every(Number.isFinite));
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      triangle(out,[x,.24,z],[b[0],.24,b[1]],[a[0],.24,a[1]],color(item.color,'#849a54'));
    }
  }
}
function bridgeMesh(out,bridge){
  const vertical=bridge.orientation==='vertical';
  const x=finite(bridge.x),z=finite(bridge.y),w=clamp(finite(bridge.w,144),4,600),d=clamp(finite(bridge.h,38),4,vertical?600:120);
  box(out,x+w/2,1.5,z+d/2,w,2,d,color('#a58a61'));
  if(vertical){
    for(let offset=3;offset<d;offset+=9)box(out,x+w/2,3.5,z+offset,w,.3,1,color('#d1ba83'));
    const start=finite(bridge.railY,z),length=clamp(finite(bridge.railDepth,finite(bridge.railHeight,d)),4,600);
    for(const railX of Array.isArray(bridge.railX)?bridge.railX:[x,x+w]){
      if(!Number.isFinite(railX))continue;
      for(let offset=0;offset<=length;offset+=18)box(out,railX,1.5,start+offset,3,15,3,color('#8b704c'));
      box(out,railX,13,start+length/2,3,3,length,color('#c6ab76'));
    }
    return;
  }
  for(let offset=3;offset<w;offset+=9)box(out,x+offset,3.5,z+d/2,1,.3,d,color('#d1ba83'));
  const railX=finite(bridge.railX,x),railWidth=clamp(finite(bridge.railWidth,w),4,600);
  for(const railZ of Array.isArray(bridge.railY)?bridge.railY:[z,z+d]){
    if(!Number.isFinite(railZ))continue;
    for(let offset=0;offset<=railWidth;offset+=18)box(out,railX+offset,1.5,railZ,3,15,3,color('#8b704c'));
    box(out,railX+railWidth/2,13,railZ,railWidth,3,3,color('#c6ab76'));
  }
}
export function staticMesh(scene) {
  const out = [], bounds = worldBounds(scene.bounds), buildings = scene.buildings || [];
  const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2;
  const island=scene.island?.coast?.length>=3?scene.island:null;
  const outletWater=(scene.hydrology?.outlets||[]).flatMap(outlet=>outlet.water||[])
    .flatMap(item=>{const rect=waterRectangle(item);return rect?[{...rect,color:item.color}]:[];});
  const wetGround=[...(scene.water||[]),...outletWater];
  // Match the 2D painter's last-strip color without stacking coplanar outlet
  // surfaces. The same footprint also replaces the sea below the estuary.
  const outletSurfaces=outletWater.flatMap((rect,index)=>cutGroundRectangles([rect],outletWater.slice(index+1))
    .map(part=>({...part,color:rect.color})));
  const biomeGround=(scene.biomes?.ground||[]).filter(p=>[p.x,p.y,p.width,p.depth].every(Number.isFinite)&&p.width>0&&p.depth>0)
    .map(p=>({...p,left:p.x,right:p.x+p.width,top:p.y,bottom:p.y+p.depth}));
  const clearingGround=(scene.scenery||[]).filter(item=>item.kind==='clearing'&&Array.isArray(item.patches))
    .flatMap(item=>item.patches.flatMap(p=>{const rect=waterRectangle(p);return rect?[{...rect,color:item.color||'#829650'}]:[];}));
  let biomeSurfaces=cutGroundRectangles(biomeGround,[...wetGround,...clearingGround]);
  let clearingSurfaces=cutGroundRectangles(clearingGround,wetGround);
  const surface=(points,height,shade)=>{
    for(let i=1;i<points.length-1;i++)triangle(out,[points[0].x,height,points[0].y],
      [points[i+1].x,height,points[i+1].y],[points[i].x,height,points[i].y],shade);
  };
  if(island){
    const frame=island.seaBounds||bounds;
    // seaBounds frames the overview; the ocean itself continues to the fog
    // horizon, as the 2D background does, instead of ending at that frame.
    const horizon=Math.max(3000,Math.hypot(frame.right-frame.left,frame.bottom-frame.top)*3);
    const sea={left:frame.left-horizon,right:frame.right+horizon,top:frame.top-horizon,bottom:frame.bottom+horizon};
    const land=island.landPatches||[];
    // Every visible ground type owns its footprint. Even a few world units of
    // height separation disappear in the depth buffer of a distant camera.
    for(const patch of cutGroundRectangles([sea],[...land,...outletWater]))surface([
      {x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
      {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],-2.8,color(island.seaColor,'#315e75'));
    const innerLand=cutGroundRectangles(land,islandShoreRectangles(island));
    const dryInnerLand=cutGroundRectangles(innerLand,wetGround);
    const beach=cutGroundRectangles(cutGroundRectangles(land,innerLand),wetGround);
    for(const patch of beach)surface([{x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
      {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],-.3,color(island.sandColor,'#c7bb83'));
    for(const patch of cutGroundRectangles(dryInnerLand,[...biomeGround,...clearingGround]))
      surface([{x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
        {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],0,color(island.landColor,'#78924f'));
    biomeSurfaces=cutGroundRectangles(intersectGroundRectangles(biomeGround,dryInnerLand),clearingGround);
    clearingSurfaces=intersectGroundRectangles(clearingGround,dryInnerLand);
  }else for (const patch of groundRectangles(bounds, [...wetGround,...biomeGround,...clearingGround]))
      box(out, (patch.left + patch.right) / 2, -2, (patch.top + patch.bottom) / 2,
        patch.right - patch.left, 2, patch.bottom - patch.top, color('#749568'));
  for (const water of scene.water || []) {
    const rect = waterRectangle(water);
    if(!rect)continue;
    // One upward surface: a thin box's bottom competes with its top in the
    // depth buffer at overview distances when both faces are rendered.
    if(island)for(const patch of island.landPatches||[]){
      const clipped={left:Math.max(rect.left,patch.left),right:Math.min(rect.right,patch.right),
        top:Math.max(rect.top,patch.top),bottom:Math.min(rect.bottom,patch.bottom)};
      if(clipped.left<clipped.right&&clipped.top<clipped.bottom)for(const part of cutGroundRectangles([clipped],outletWater))surface([
        {x:part.left,y:part.top},{x:part.right,y:part.top},
        {x:part.right,y:part.bottom},{x:part.left,y:part.bottom}],.12,color(water.color,'#5e9eab'));
    }
    else for(const part of cutGroundRectangles([rect],outletWater))quad(out, [part.left, 0.12, part.top], [part.left, 0.12, part.bottom],
      [part.right, 0.12, part.bottom], [part.right, 0.12, part.top], color(water.color,'#5e9eab'));
  }
  for(const patch of outletSurfaces)surface([
    {x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
    {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],.12,color(patch.color,'#315e75'));
  for(const patch of biomeSurfaces){
    surface([{x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
      {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],.035,color(patch.color));
  }
  for(const patch of clearingSurfaces){
    surface([{x:patch.left,y:patch.top},{x:patch.right,y:patch.top},
      {x:patch.right,y:patch.bottom},{x:patch.left,y:patch.bottom}],.035,color(patch.color));
  }
  const roads = Array.isArray(scene.roads) && (scene.roads.length || island) ? scene.roads : [
    {points: [{x: bounds.left, y: centerY}, {x: bounds.right, y: centerY}], width: 22},
    {points: [{x: centerX, y: bounds.top}, {x: centerX, y: bounds.bottom}], width: 22},
  ];
  for (const route of roads) for (let i = 1; i < (route.points?.length || 0); i++)
    road(out, route.points[i - 1], route.points[i], clamp(finite(route.width, 20), 3, 80), finite(route.height, 0.16),route.rounded===true);
  for (const building of buildings) buildingMesh(out, building);
  for(const bridge of scene.bridges||[])bridgeMesh(out,bridge);
  for(const item of scene.scenery||[])sceneryMesh(out,item);
  // Sparse decorative woodland is stable, and never used as work/progress evidence.
  // An explicit shared terrain scene is authoritative, including an empty one.
  for (let i = 0; !Array.isArray(scene.scenery) && i < 64; i++) {
    const seed = hash('tree:' + i), x = bounds.left - 100 + (seed % 10000) / 10000 * (bounds.right - bounds.left + 200);
    const z = bounds.top - 100 + ((seed >>> 14) % 10000) / 10000 * (bounds.bottom - bounds.top + 200);
    if(island&&!pointInIsland({x,y:z},island))continue;
    if (Math.abs(x - centerX) < 38 || Math.abs(z - centerY) < 38 ||
      (scene.water || []).some(w => x > w.left - 15 && x < w.right + 15 && z > w.top && z < w.bottom) ||
      buildings.some(b => Math.abs(x - b.x) < finite(b.width, 70) / 2 + 28 && Math.abs(z - b.y) < finite(b.depth, 58) / 2 + 28)) continue;
    const height = 22 + seed % 18;
    box(out, x, 0, z, 4, height * 0.6, 4, color('#6e5c43'));
    cone(out, x, height * 0.3, z, height * 0.36, height, color(i % 2 ? '#3f7254' : '#56815a'));
    cone(out, x, height * 0.65, z, height * 0.27, height * 0.65, color('#618d64'));
  }
  return new Float32Array(out);
}
function personMesh(out, person, hero = false) {
  const x = finite(person.x), z = finite(person.y), heading = finite(person.heading);
  const size = clamp(finite(person.scale, 1), 0.35, 1.25);
  const cloth = color(person.color, hero ? '#457d94' : CLOTHES[hash(person.id) % CLOTHES.length]);
  const skin = color('#dfb78d'), dark = color('#494b48');
  const part = (dx, y, dz, w, h, d, c) => {
    const [px, py, pz] = positioned([dx * size, y * size, dz * size], x, 0, z, heading);
    box(out, px, py, pz, w * size, h * size, d * size, c, heading);
  };
  part(-2.5, 0, 0, 3.5, 7, 4, dark); part(2.5, 0, 0, 3.5, 7, 4, dark);
  part(0, 6, 0, 8, 10, 5, cloth);
  part(-5.5, 7, 0, 3, 8, 3, cloth); part(5.5, 7, 0, 3, 8, 3, cloth);
  part(0, 16, 0, 6.5, 6.5, 6.5, skin);
  part(0, 21, 0.5, 7.5, hero ? 3.5 : 2.5, 7.5, color(hero ? '#dfb953' : '#574b40'));
  part(-1.6, 19.4, -3.35, 1.1, 1.1, 0.5, dark); part(1.6, 19.4, -3.35, 1.1, 1.1, 0.5, dark);
  if (hero) part(0, 5, 3, 9, 10, 1.2, color('#c58355'));
  if (person.kind === 'agent') {
    // Main sessions have a shield and an upright pennant; helpers have a hood.
    part(0, 21, 0, 8, 3, 8, color('#cbd1c6'));
    part(-7, 6, -1.5, 4, 9, 2, cloth);
    part(-7, 9.5, -2.7, 2.6, 1.5, .5, color('#f5e6bd'));
    part(7, 3, 2, 1, 30, 1, color('#d6c694'));
    part(10, 27, 2, 7, 5, .8, cloth);
    part(10, 31, 2, 7, 1, 1, color('#f5e6bd'));
  }
  if (person.kind === 'subagent') {
    cone(out,x,21*size,z,5*size,9*size,cloth);
    const shade=color(person.statusColor,'#d1cfcb');
    const points=[[0,36,0],[4,32,0],[0,28,0],[-4,32,0],[0,32,2],[0,32,-2]]
      .map(p=>positioned(p.map(v=>v*size),x,0,z,heading));
    for(const [a,b,c] of [[0,1,4],[1,2,4],[2,3,4],[3,0,4],[1,0,5],[2,1,5],[3,2,5],[0,3,5]])
      triangle(out,points[a],points[b],points[c],shade);
  }
}
export function visiblePeople(scene, eye, mode, limit = 320) {
  const leader = scene.leader || {}, people = (scene.people || []).filter(p =>
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    (mode !== 'leader' || Math.hypot(p.x - eye[0], p.y - eye[2]) >= 16) &&
    (leader.id ? p.id !== leader.id : Math.hypot(p.x - finite(leader.x), p.y - finite(leader.y)) > 3));
  if (people.length > limit) people.sort((a, b) =>
    Number(a.kind === 'subagent') - Number(b.kind === 'subagent') ||
    (a.x - eye[0]) ** 2 + (a.y - eye[2]) ** 2 - (b.x - eye[0]) ** 2 - (b.y - eye[2]) ** 2);
  const shown = people.slice(0, limit);
  if (mode !== 'leader') shown.push({...leader, id: leader.id || '__leader', hero: true});
  return shown;
}
export function peopleMesh(people) {
  const out = [];
  for (const person of people) personMesh(out, person, Boolean(person.hero));
  return new Float32Array(out);
}
