import {projectBuildings, facilities} from './project-buildings.js';
import {developmentScenery} from './world-terrain.js';
import {createWorldIsland, pointInIsland} from './world-island.js';
import {worldBiomes} from './world-biomes.js';
import {worldHydrology,riverBridges} from './world-hydrology.js';
import {planWorldSettlements} from './world-settlements.js';

export function facilityRoads() {
  return facilities.map(f=>({width:25,points:[{x:500,y:610},{x:-100,y:710},
    {x:-100,y:f.y+50},{x:f.x,y:f.y+50}]}));
}

// Both projections use the same district origins, buildings and terrain model.
export function projectSceneGeometry(layout, projects, residents, connectingRoads) {
  // Normalize once before terrain, bridge planning and both renderers consume it.
  const arteries=[...connectingRoads.map(road=>({...road,
    width:Math.max(3,Math.min(80,Number.isFinite(road.width)?road.width:25))})),...facilityRoads()];
  const districts=projects.filter(project=>layout[project.id]).map(project=>({id:project.id,
    place:layout[project.id],buildings:projectBuildings(project),population:residents.filter(r=>r.projectId===project.id).length}));
  const fixedBuildings=facilities.map(facility=>({id:'facility:'+facility.id,x:facility.x,y:facility.y-30,
    width:140,depth:90,height:facility.id==='castle'?130:85,stage:'finished',kind:facility.id,
    label:facility.name,color:facility.id==='castle'?'#bbb9a7':'#ad8661'}));
  const all=Object.values(layout);
  const bounds={
    left:Math.min(-650,...all.map(p=>p.x)),right:Math.max(1000,...all.map(p=>p.x+1000)),
    top:Math.min(-800,...all.map(p=>p.y)),bottom:Math.max(740,...all.map(p=>p.y+740))};
  const regions=all.map(place=>({left:place.x,right:place.x+1000,top:place.y,bottom:place.y+640}));
  const island=createWorldIsland({regions,roads:arteries,buildings:fixedBuildings,bounds});
  const fixedObstacles=fixedBuildings.map(b=>({left:b.x-b.width/2-25,right:b.x+b.width/2+25,
    top:b.y-b.depth/2-25,bottom:b.y+b.depth/2+25}));
  // Geography is established before a town chooses dry plots and streets.
  const hydrology=worldHydrology(island,{roads:arteries,obstacles:fixedObstacles}),water=hydrology.water;
  const naturalBiomes=worldBiomes(island,{roads:arteries,facilities,water});
  const plan=planWorldSettlements({districts,island,hydrology,connectingRoads:arteries,biomes:naturalBiomes,obstacles:fixedObstacles});
  const settlements=plan.settlements,roads=[...arteries,...plan.roads].map(road=>({...road,rounded:true})),bridges=riverBridges(hydrology,roads);
  const buildings=[...fixedBuildings];
  for(const settlement of settlements)for(const building of settlement.buildings)buildings.push({
    id:'building:'+JSON.stringify([settlement.id,building.id]),x:settlement.place.x+building.x,
    y:settlement.place.y+building.y-26,width:110,depth:77,
    height:{planned:20,building:45,testing:65,finished:78}[building.stage]||45,
    stage:building.stage,label:building.name,kind:'building',
    color:{planned:'#bdaf85',building:'#c68a52',testing:'#709ea1',finished:'#d0b276'}[building.stage],
  });
  const actualPlots=settlements.flatMap(s=>s.plots);
  const biomes=worldBiomes(island,{regions:actualPlots,roads,facilities,water});
  const landscape=developmentScenery(bounds,{districts:[],roads,facilities:buildings}).filter(item=>{
    const radius=25*(item.size||1);
    return [{x:item.x-radius,y:item.y-radius},{x:item.x+radius,y:item.y+radius}]
      .every(point=>pointInIsland(point,island));
  });
  return {buildings,roads,water,settlements,hydrology,
    scenery:[...plan.clearings,...plan.scenery,...landscape,...biomes.scenery],landscape,biomes,bridges,island,bounds:island.seaBounds};
}
