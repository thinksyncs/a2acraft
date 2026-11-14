import {VILLAGE_PLACES, VILLAGE_WORLD} from './village-world.js';
import {addDelegatesToScene} from './village-delegates.js';
import {worldPersonColor} from './village-art.js';
import {districtTerrainGeometry, villageOutskirtsGeometry, villageRiverWater} from './world-terrain.js';
import {createWorldIsland, pointInIsland} from './world-island.js';
import {worldBiomes} from './world-biomes.js';

const COLORS = ['#d2ac65', '#71afb5', '#b78ca8', '#9bb968'];
const height = {planned: 5, building: 32, testing: 55, complete: 64};
const direction = {up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2};
export const VILLAGE_MIN_ZOOM = .001;

let cachedIsland, cachedIslandOutskirts,cachedIslandOutskirtsShape='';
export function villageIsland() {
  if (!cachedIsland) cachedIsland = createWorldIsland({regions:[{
    left:VILLAGE_WORLD.left,right:VILLAGE_WORLD.right,top:VILLAGE_WORLD.top,bottom:VILLAGE_WORLD.bottom,
  }],roads:villageOutskirtsGeometry().roads});
  return cachedIsland;
}

function islandOutskirts() {
  const island=villageIsland(),shape=JSON.stringify([island.bounds,island.coast,island.landPatches]);
  if (cachedIslandOutskirts&&cachedIslandOutskirtsShape===shape) return cachedIslandOutskirts;
  cachedIslandOutskirtsShape=shape;
  return cachedIslandOutskirts={
    water:[...villageRiverWater(island.bounds.top,VILLAGE_WORLD.top,{x:0,y:0},20),
      ...villageRiverWater(VILLAGE_WORLD.bottom,island.bounds.bottom,{x:0,y:0},20)],
    scenery:[],
  };
}

let cachedBiomes, cachedBiomesShape='';
export function villageBiomes() {
  const island=villageIsland(),shape=JSON.stringify([island.bounds,island.coast,island.landPatches]);
  if(cachedBiomes&&cachedBiomesShape===shape)return cachedBiomes;
  cachedBiomesShape=shape;
  const terrain=districtTerrainGeometry(),outskirts=villageOutskirtsGeometry(),outer=islandOutskirts();
  return cachedBiomes=worldBiomes(island,{regions:[VILLAGE_WORLD],
    roads:[...terrain.roads,...outskirts.roads],facilities:VILLAGE_PLACES,
    water:[...terrain.water,...outskirts.water,...outer.water]});
}

// zoom is a multiplier on the village's original 1000×640 core scale.
export function villageOverviewCamera(width,height,island=villageIsland()) {
  const w=Math.max(1,Number.isFinite(width)?width:1),h=Math.max(1,Number.isFinite(height)?height:1);
  const bounds=island.seaBounds,base=Math.min(w/1000,h/640);
  return {x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2,
    zoom:Math.max(VILLAGE_MIN_ZOOM,Math.min(2.5,
      Math.max(1,w-48)/(bounds.right-bounds.left)/base,
      Math.max(1,h-100)/(bounds.bottom-bounds.top)/base))};
}

// Finding a person is a close view, even when the map started at continent scale.
export function villageResidentCamera(width,height,point,currentZoom=1) {
  const base=Math.min(Math.max(1,width)/1000,Math.max(1,height)/640);
  return {x:point.x,y:point.y,zoom:Math.min(2.5,Math.max(currentZoom,1/base))};
}

export function villageFacing(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return {heading: Math.atan2(dx, -dy),
    direction: Math.abs(dx) > Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'down' : 'up'};
}

export function villageEncounterApproach(person, leader, obstacles = []) {
  const angle = Math.atan2(leader.y - person.y, leader.x - person.x);
  // Keep a full conversational distance even next to a construction footprint;
  // letting pathfinding clamp a point inside a building could put faces too close.
  for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const point = {x: person.x + Math.cos(angle + turn * Math.PI / 4) * 42,
      y: person.y + Math.sin(angle + turn * Math.PI / 4) * 42};
    if (!pointInIsland(point,villageIsland())) continue;
    if (!obstacles.some(rect => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom)) return point;
  }
  return null;
}

// A conversation holds the selected visible person, including a party member,
// at their actual point. Remove their other projections instead of adding a twin.
export function villageEncounterActors({residents = [], hero = null, squads = [], heading = 0, encounter = null}) {
  if (!encounter) return {residents, hero, squads, heading};
  const groups = [...squads, ...(hero ? [hero] : [])], active = groups.find(group => group.isProtagonist);
  const leader = active?.members?.find(member => member.isLeader || member.conversationId && member.conversationId === active.leaderId) || active?.members?.[0];
  if (!leader || leader.conversationId === encounter.conversationId) return {residents, hero, squads, heading};
  const person = {...encounter.person, conversationId: encounter.conversationId,
    ...villageFacing(encounter.person, leader), walking: false, conversing: true};
  const facing = villageFacing(leader, person), talking = encounter.status === 'talking';
  const projectGroup = group => ({...group, members: (group.members || [])
    .filter(member => member.conversationId !== encounter.conversationId)
    .map(member => member === leader && talking ? {...member, ...facing, walking: false, conversing: true} : member)});
  return {residents: [...residents.filter(resident => resident.conversationId !== encounter.conversationId), person],
    hero: hero ? projectGroup(hero) : null, squads: squads.map(projectGroup),
    heading: talking ? facing.heading : heading, person, leader: {...leader, ...(talking ? facing : {heading})}};
}

export function villageEncounterSightline(scene, conversationId) {
  const person = scene.people.find(item => item.conversationId === conversationId);
  if (!person) return scene;
  const leader = scene.leader, dx = person.x - leader.x, dy = person.y - leader.y, distance = Math.hypot(dx, dy);
  if (!distance) return scene;
  return {...scene, people: scene.people.filter(item => {
    if (item === person || item.id === leader.id) return true;
    const x = item.x - leader.x, y = item.y - leader.y;
    const along = (x * dx + y * dy) / distance, across = Math.abs(x * dy - y * dx) / distance;
    // Keep nearby companions in the town, but clear only the portrait sightline.
    return !(along > -10 && along < distance + 12 && across < 18);
  })};
}

export function villageSpeechPlacement({width, height, bubbleWidth, bubbleHeight, people, avoid = [], protectedAreas = []}) {
  const actors = protectedAreas.length?protectedAreas:people.map(point => ({left: point.x - 18, right: point.x + 18, top: point.y - 32, bottom: point.y + 12}));
  const minX=Math.min(...actors.map(rect=>rect.left)),maxX=Math.max(...actors.map(rect=>rect.right)),
    minY=Math.min(...actors.map(rect=>rect.top)),maxY=Math.max(...actors.map(rect=>rect.bottom)),
    centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const fullHeight=Math.min(bubbleHeight,height-16),above=Math.min(fullHeight,minY-20),below=Math.min(fullHeight,height-maxY-20);
  const candidates = [
    {left:centerX-bubbleWidth/2,top:minY-12-fullHeight,height:fullHeight},
    {left:maxX+12,top:centerY-fullHeight/2,height:fullHeight},
    {left:minX-12-bubbleWidth,top:centerY-fullHeight/2,height:fullHeight},
    {left:centerX-bubbleWidth/2,top:maxY+12,height:fullHeight},
    ...(above>=64?[{left:centerX-bubbleWidth/2,top:8,height:above}]:[]),
    ...(below>=64?[{left:centerX-bubbleWidth/2,top:maxY+12,height:below}]:[]),
  ].map(point => ({left:Math.max(8,Math.min(Math.max(8,width-bubbleWidth-8),point.left)),
    top:Math.max(8,Math.min(Math.max(8,height-point.height-8),point.top)),maxHeight:point.height}));
  const overlap = (point,areas) => areas.reduce((sum, rect) => sum +
    Math.max(0, Math.min(point.left + bubbleWidth, rect.right) - Math.max(point.left, rect.left)) *
    Math.max(0, Math.min(point.top + point.maxHeight, rect.bottom) - Math.max(point.top, rect.top)), 0);
  // On short maps the card can scroll in the free space above/below the pair.
  // Clamping a full-height card to the viewport must not cover their faces.
  return candidates.sort((a,b)=>overlap(a,actors)-overlap(b,actors)||overlap(a,avoid)-overlap(b,avoid)||b.maxHeight-a.maxHeight)[0];
}

// Projection only: rendering never creates jobs, progress, or AI activity.
export function village3DScene({projects = [], residents = [], population = residents.length, hero, squads = [], heading = 0, delegates = null}) {
  const terrain = districtTerrainGeometry({x:0,y:0},{population}), outskirts=villageOutskirtsGeometry(), outer=islandOutskirts(),island=villageIsland();
  const buildings = projects.map(project => ({
    id: 'project:' + project.conversationId,
    x: project.x, y: project.y - 24, width: 100, depth: 72,
    height: height[project.stage] ?? 5, stage: project.stage,
    color: COLORS[(project.seed >>> 0) % COLORS.length], label: project.title,
  }));
  buildings.push(...VILLAGE_PLACES.map(place => ({
    id: 'place:' + place.id, x: place.x, y: place.y - 40,
    width: place.id === 'castle' ? 170 : 120, depth: 100,
    height: place.id === 'castle' ? 100 : 64, stage: 'complete',
    kind: place.id, label: place.name,
    color: place.id === 'castle' ? '#99a9bb' : place.id === 'tavern' ? '#c28d68' : '#86a6a0',
  })));
  const people = residents.map(resident => ({
    id: 'resident:' + resident.conversationId, conversationId: resident.conversationId, x: resident.x, y: resident.y,
    kind:resident.kind||'agent',name:resident.name||resident.characterName||resident.title,
    identityFocused:Boolean(resident.identityFocused),
    color: worldPersonColor(resident),
    heading: Number.isFinite(resident.heading) ? resident.heading : direction[resident.direction] ?? 0,
  }));
  let leader = {id: 'leader', x: 490, y: 430, heading};
  for (const group of [...squads, ...(hero ? [hero] : [])]) {
    const members = group.members || [];
    const first = members.find(member => member.isLeader || member.conversationId && member.conversationId === group.leaderId) || members[0];
    for (const [index, member] of members.entries()) {
      const id = 'party:' + group.id + ':' + index;
      const activeLeader = group.isProtagonist && member === first;
      people.push({id, conversationId: member.conversationId, x: member.x, y: member.y,
        kind:member.conversationId?'agent':'party',name:member.name||member.characterName,
        identityFocused:Boolean(member.identityFocused||activeLeader),
        color: worldPersonColor(member,{hero:group.isProtagonist,party:true,index,squadSeed:group.seed}),
        heading: activeLeader ? heading : Number.isFinite(member.heading) ? member.heading : direction[member.direction] ?? 0});
      if (activeLeader) leader = {id, x: member.x, y: member.y, heading};
    }
  }
  const roads=[...terrain.roads,...outskirts.roads],water=[...terrain.water,...outskirts.water,...outer.water];
  const biomes=villageBiomes();
  return addDelegatesToScene({buildings, people, leader, roads, water,biomes,
    scenery:[...terrain.scenery,...outskirts.scenery,...biomes.scenery], bridges:[terrain.bridge],island,bounds:island.seaBounds}, delegates);
}

export function readVillageView(value) {
  const result = {mode: '2d', camera: null, camera3D: null, district: 0};
  if (!value || typeof value !== 'object') return result;
  if (['2d', 'overview', 'leader', 'follow'].includes(value.mode)) result.mode = value.mode;
  const c = value.camera;
  const bounds=villageIsland().seaBounds;
  if (c && [c.x, c.y, c.zoom].every(Number.isFinite)) result.camera = {
    x: Math.max(bounds.left, Math.min(bounds.right, c.x)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, c.y)),
    zoom: Math.max(VILLAGE_MIN_ZOOM, Math.min(2.5, c.zoom)),
  };
  if (Number.isSafeInteger(value.district) && value.district >= 0 && value.district < 20000) result.district = value.district;
  // The renderer validates individual camera fields again before use.
  if (value.camera3D && typeof value.camera3D === 'object') result.camera3D = value.camera3D;
  return result;
}
