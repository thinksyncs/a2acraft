import {coastalFaces} from './world-coast.js';
import {sceneryObjectMesh} from './world-scenery-model.js';
import {finite, clamp, worldBounds} from './world-3d-math.js';
import {pointInIsland} from './world-island.js';
import {biomeLandmarks} from './world-biomes.js';
import {biomeColorField} from './world-biome-blend.js';

import {hash,color,triangle,quad,box,roof,cone} from './world-model-primitives.js';
import {buildingMesh} from './world-building-model.js';
import {personMesh} from './world-character-model.js';
import {cottageModel} from './world-model-descriptors.js';
export {hash,color,box} from './world-model-primitives.js';
export {buildingShape} from './world-building-model.js';

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

function sceneryMesh(out,item,distant=false){
  const x=finite(item.x),z=finite(item.y),size=clamp(finite(item.size,finite(item.scale,1)),.1,4);
  if(item.kind==='woodland'||item.kind==='mountain-range'){
    for(const marker of biomeLandmarks(item))sceneryObjectMesh(out,marker,distant);
  }else if(sceneryObjectMesh(out,item,distant)){
    return;
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
  }else if(item.kind==='cottage'){
    buildingMesh(out,cottageModel(item));
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
// Keep the unchanged ground, roads and structures separate from natural
// scenery. A leader window only uploads the groves and ridges in its view.
const naturalKind=new Set(['woodland','mountain-range','tree','pine','rock','mountain','biome-tree','biome-mountain']);
export function naturalTiles(scene){
  const tiles=new Map(),step=clamp(finite(scene.biomes?.step,480)*2,560,1100);
  for(const item of scene.scenery||[]){
    if(!naturalKind.has(item.kind))continue;
    const patch=item.kind==='woodland'||item.kind==='mountain-range',size=clamp(finite(item.size,finite(item.scale,1)),.1,4);
    const w=finite(item.width,100*size),d=finite(item.depth,100*size),h=finite(item.height,100*size);
    const cx=finite(item.x)+(patch?w/2:0),cz=finite(item.y)+(patch?d/2:0);
    const key=Math.floor(cx/step)+','+Math.floor(cz/step);
    let tile=tiles.get(key);
    if(!tile){tile={items:[],left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,height:0};tiles.set(key,tile);}
    tile.items.push(item);
    tile.left=Math.min(tile.left,cx-w/2);tile.right=Math.max(tile.right,cx+w/2);
    tile.top=Math.min(tile.top,cz-d/2);tile.bottom=Math.max(tile.bottom,cz+d/2);
    // Survey height describes the stand, not necessarily its tallest tree.
    tile.height=Math.max(tile.height,h,patch?Math.min(w,d)*.65:0);
  }
  return [...tiles.values()];
}
export function naturalTileMesh(tile,distant=false){
  const out=[];for(const item of tile.items)sceneryMesh(out,item,distant);
  return new Float32Array(out);
}

export function staticMesh(scene,{separateNature=false}={}) {
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
  const coastSurface=(rect,material,height,shade)=>coastalFaces(island,rect,material,points=>{
    // Clipping at a tangent can repeat a vertex. Emit only upward faces.
    for(let i=1;i<points.length-1;i++){
      const a=points[0],b=points[i],c=points[i+1];
      if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>1e-6)surface([a,b,c],height,shade);
    }
  });
  const field=biomeColorField(scene.biomes);
  function biomeSurface(patch,clipCoast=false){
    const corners=r=>[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];
    if(!field){
      if(clipCoast)coastSurface(patch,'grass',.035,color(patch.color));
      else surface(corners(patch),.035,color(patch.color));
      return;
    }
    const paint=points=>{
      const vertices=points.map(({x,y})=>[x,.035,y,0,1,0,...field.sample(x,y).map(v=>v/255)]);
      for(let i=1;i<points.length-1;i++){
        const a=points[0],b=points[i],c=points[i+1];
        if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>1e-6)
          out.push(...vertices[0],...vertices[i+1],...vertices[i]);
      }
    };
    // Split on global sample lines, including when water or a clearing clips
    // a patch. WebGL interpolates the same soil colours as the atlas texture.
    const spacing=field.step/4;
    for(let gy=Math.floor(patch.top/spacing);gy<Math.ceil(patch.bottom/spacing);gy++)
      for(let gx=Math.floor(patch.left/spacing);gx<Math.ceil(patch.right/spacing);gx++){
        const tile={left:Math.max(patch.left,gx*spacing),right:Math.min(patch.right,(gx+1)*spacing),
          top:Math.max(patch.top,gy*spacing),bottom:Math.min(patch.bottom,(gy+1)*spacing)};
        if(clipCoast)coastalFaces(island,tile,'grass',paint);else paint(corners(tile));
      }
  }
  if(island){
    const frame=island.seaBounds||bounds;
    // seaBounds frames the overview; the ocean itself continues to the fog
    // horizon, as the 2D background does, instead of ending at that frame.
    const horizon=Math.max(3000,Math.hypot(frame.right-frame.left,frame.bottom-frame.top)*3);
    const sea={left:frame.left-horizon,right:frame.right+horizon,top:frame.top-horizon,bottom:frame.bottom+horizon};
    if(island.islets){
      for(const patch of cutGroundRectangles([sea],outletWater))
        coastSurface(patch,'sea',-2.8,color(island.seaColor));
      for(const patch of cutGroundRectangles([island.bounds],wetGround)){
        coastSurface(patch,'sand',-.3,color(island.sandColor));
        for(const dry of cutGroundRectangles([patch],[...biomeGround,...clearingGround]))
          coastSurface(dry,'grass',0,color(island.landColor));
      }
      for(const patch of biomeSurfaces)biomeSurface(patch,true);
      for(const patch of clearingSurfaces)coastSurface(patch,'grass',.035,color(patch.color));
      biomeSurfaces=[];clearingSurfaces=[];
    }else{
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
    }
  }else for (const patch of groundRectangles(bounds, [...wetGround,...biomeGround,...clearingGround]))
      box(out, (patch.left + patch.right) / 2, -2, (patch.top + patch.bottom) / 2,
        patch.right - patch.left, 2, patch.bottom - patch.top, color('#749568'));
  for (const water of scene.water || []) {
    const rect = waterRectangle(water);
    if(!rect)continue;
    // One upward surface: a thin box's bottom competes with its top in the
    // depth buffer at overview distances when both faces are rendered.
    if(island?.islets){
      for(const part of cutGroundRectangles([rect],outletWater))coastSurface(part,'land',.12,color(water.color,'#5e9eab'));
    }else if(island)for(const patch of island.landPatches||[]){
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
  for(const patch of biomeSurfaces)biomeSurface(patch);
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
  for(const item of scene.scenery||[])if(!separateNature||!naturalKind.has(item.kind))sceneryMesh(out,item);
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
const personPoses = new Map(), MAX_PERSON_POSES = 512;
const visualColor = value => typeof value === 'string' ? value :
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite) ? value.slice(0, 3) : undefined;
function localPersonPose(person) {
  // Cache only visual properties. Positions, headings and conversation contents
  // never become keys or retained objects, and walking has three bounded poses.
  const model = {
    seed: String(person.seed ?? person.conversationId ?? person.id ?? ''),
    color: visualColor(person.color),
    kind: typeof person.kind === 'string' ? person.kind : undefined,
    appearance: typeof person.appearance === 'string' ? person.appearance : person.appearance?.id,
    role: String(person.role ?? ''), scale: clamp(finite(person.scale, 1), .35, 1.25),
    hero: Boolean(person.hero), statusColor: visualColor(person.statusColor),
    gait: Math.round(clamp(finite(person.gait), -1, 1)),
  };
  const key = JSON.stringify(model);
  let pose = personPoses.get(key);
  if (pose) personPoses.delete(key);
  else {
    const vertices = [];
    personMesh(vertices, model, model.hero);
    pose = new Float32Array(vertices);
  }
  personPoses.set(key, pose);
  while (personPoses.size > MAX_PERSON_POSES) personPoses.delete(personPoses.keys().next().value);
  return pose;
}
export function peopleMesh(people) {
  const poses = people.map(localPersonPose);
  const out = new Float32Array(poses.reduce((length, pose) => length + pose.length, 0));
  let offset = 0;
  for (let personIndex = 0; personIndex < people.length; personIndex++) {
    const person = people[personIndex], pose = poses[personIndex];
    const x = finite(person.x), z = finite(person.y), heading = finite(person.heading);
    const cosine = Math.cos(heading), sine = Math.sin(heading);
    for (let i = 0; i < pose.length; i += 9) {
      out[offset++] = x + pose[i] * cosine - pose[i + 2] * sine;
      out[offset++] = pose[i + 1];
      out[offset++] = z + pose[i] * sine + pose[i + 2] * cosine;
      out[offset++] = pose[i + 3] * cosine - pose[i + 5] * sine;
      out[offset++] = pose[i + 4];
      out[offset++] = pose[i + 3] * sine + pose[i + 5] * cosine;
      out[offset++] = pose[i + 6];
      out[offset++] = pose[i + 7];
      out[offset++] = pose[i + 8];
    }
  }
  return out;
}
