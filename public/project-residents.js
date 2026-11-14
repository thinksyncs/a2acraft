import { routeLength, routePoint } from "./world-travel.js";
import { mapStorage } from "./map-storage.js";
import { projectBuildings, sceneBuildingObstacles } from "./project-buildings.js";
import { delegationCacheKey, villageDelegation } from "./village-delegates.js";
import {pointInIsland} from './world-island.js';
import {islandWaterObstacles,islandLandRoute,islandRouteWalkable} from './world-island-travel.js';

function direction(heading) {
  return ["up", "right", "down", "left"][
    ((Math.round(heading / (Math.PI / 2)) % 4) + 4) % 4
  ];
}

function identitySeed(value) {
  let seed = 2166136261;
  for (const char of String(value)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

function restingPlaces(buildings,plan) {
  // Small groups beside different streets and the square, never one long queue.
  const points = [[310,230],[630,230],[310,400],[630,400],[310,570],[630,570],[490,440],[760,400]]
    .flatMap(([x,y]) => [[-28,18],[24,22],[8,-26],[-22,-20]].map(([dx,dy]) => ({x:x+dx,y:y+dy})));
  // Extra capacity is real space, not several residents occupying one slot.
  for (let y=100; y<=590; y+=24) for (let x=165; x<=790; x+=24) {
    const seed=identitySeed(x+':'+y);
    points.push({x:x+seed%9-4,y:y+(seed>>>8)%9-4});
  }
  if(plan)points.unshift(...plan.roads.flatMap(road=>road.points.flatMap(point=>[
    {x:point.x-plan.place.x-22,y:point.y-plan.place.y+20},
    {x:point.x-plan.place.x+22,y:point.y-plan.place.y-20},
  ])));
  return points.filter(point => !buildings.some(b => point.x > b.x-65 && point.x < b.x+65 &&
      point.y > b.y-75 && point.y < b.y+22));
}

export function createResidents(key,{buildingsFor=projectBuildings,terrainFor=()=>null}={}) {
  let saved = {};
  try {
    saved = JSON.parse(mapStorage.getItem(key) || "{}");
  } catch {}
  const stopped = new Map();
  const delegations = new Map();
  const restingCache = new Map();
  const waterCache=new WeakMap();
  const terrainCache=new WeakMap();
  const checkedJourneys=new Map();
  function residentTerrain(source){
    if(!source)return null;
    let terrain=terrainCache.get(source);
    if(!terrain){terrain={...source,obstacles:[...(source.obstacles||[]),...sceneBuildingObstacles(source)]};terrainCache.set(source,terrain);}
    return terrain;
  }
  function dry(point,terrain){
    if(!terrain)return true;
    let wet=waterCache.get(terrain);
    if(!wet){wet=islandWaterObstacles(terrain.water,terrain.bridges);waterCache.set(terrain,wet);}
    const inside=r=>point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom;
    return pointInIsland(point,terrain.island)&&!wet.some(inside)&&!terrain.obstacles.some(inside);
  }
  let dirty = false,
    lastSave = 0,
    previousChats = null,
    groups = new Map();
  function get({ projects, chats, places, journeys, clock, moving }) {
    const result = [];
    if (chats !== previousChats) {
      previousChats = chats;
      groups = new Map();
      for (const chat of chats) {
        const id = chat.project?.id;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(chat);
      }
    }
    for (const p of projects) {
      const buildings = buildingsFor(p),terrain=residentTerrain(terrainFor(p)),plan=terrain?.settlements?.find(s=>s.id===p.id),
        people = (groups.get(p.id) || []).slice(0, 180);
      const restingKey = JSON.stringify(buildings.map(b=>[b.x,b.y]));
      if (restingCache.get(p.id)?.key !== restingKey||restingCache.get(p.id)?.terrain!==terrain)
        restingCache.set(p.id,{key:restingKey,terrain,points:restingPlaces(buildings,plan)
          .filter(point=>dry({x:point.x+places[p.id].x,y:point.y+places[p.id].y},terrain))});
      const candidates = restingCache.get(p.id).points,
        resting = candidates.length ? candidates : [{x:15,y:400}],
        occupied = people.map(chat=>saved[chat.id]?.position).filter(Boolean)
          .map(point=>({x:point.x-places[p.id].x,y:point.y-places[p.id].y}));
      for (const [i, chat] of people.entries()) {
        const previous = saved[chat.id]?.position;
        const delegationKey = JSON.stringify([chat.threadId, delegationCacheKey(chat.delegation)]);
        if (delegations.get(chat.id)?.key !== delegationKey)
          delegations.set(chat.id, { key: delegationKey, value: villageDelegation(chat) });
        const job = p.jobs.find((j) => j.id === chat.project?.jobId),
          b = buildings.find((b) => b.jobId === job?.id) ||
            buildings.find((b) => b.id === job?.repoId) || { x: 500, y: 400 };
        const journey = journeys[chat.id],
          active =
            chat.id === job?.conversationId &&
            !p.paused &&
            ["running", "preparing"].includes(job?.status);
        let point,patrolling=false,
          walking = false;
        if (stopped.has(chat.id)) point = stopped.get(chat.id);
        else if (journey && (!active || saved[chat.id]?.points)) {
          const signature = JSON.stringify(journey.points),
            prior = saved[chat.id];
          const origin = prior?.position || journey.points[0];
          const record =
            prior?.signature === signature
              ? prior
              : {
                  signature,
                  progress: 0,
                  points: [
                    origin,
                    { x: origin.x, y: places[p.id].y + 610 },
                    ...journey.points,
                  ],
                };
          record.points ||= journey.points;
          const checked=checkedJourneys.get(chat.id);
          let blocked=Boolean(terrain&&checked?.blocked);
          if(terrain&&(record!==prior||checked?.terrain!==terrain||checked.signature!==signature)){
            blocked=false;
            if(!islandRouteWalkable(record.points,terrain.island,terrain)){
              const start=dry(record.position||origin,terrain)?record.position||origin:
                {x:places[p.id].x+resting[0].x,y:places[p.id].y+resting[0].y};
              const route=islandLandRoute(start,journey.points.at(-1),terrain.island,terrain);
              if(route.length){record.points=route;record.progress=0;}
              else {blocked=true;record.position=start;}
            }
            // Keep a failed route for a future terrain revision, but never
            // advance along it and relocate a swimmer on every animation tick.
            checkedJourneys.set(chat.id,{terrain,signature,blocked});
          }
          const length = routeLength(record.points);
          if (record !== prior && !prior?.position)
            record.progress = identitySeed(chat.id) / 4294967296 * length * 2;
          if (moving && !blocked) {
            record.progress += moving * 34;
            dirty = true;
          }
          const progress = length ? record.progress % (length * 2) : 0;
          point = blocked ? record.position : routePoint(
            record.points,
            progress > length ? length * 2 - progress : progress,
          );
          saved[chat.id] = { ...record, position: point };
          walking = Boolean(moving && length && !blocked);
        } else {
          const angle = i * 2.4 + (moving && active ? clock / 3500 : 0);
          let restIndex = identitySeed(chat.id) % resting.length;
          for (let n=0; n<resting.length && occupied.some(point=>Math.hypot(point.x-resting[restIndex].x,point.y-resting[restIndex].y)<12); n++)
            restIndex = (restIndex+1)%resting.length;
          const rest = resting[restIndex] || {x:500,y:440};
          if (!saved[chat.id]?.position) occupied.push(rest);
          point =
            (!moving || !active) && saved[chat.id]?.position
              ? saved[chat.id].position
              : !active ? {x:places[p.id].x+rest.x,y:places[p.id].y+rest.y}
              : {
                  x:
                    places[p.id].x +
                    b.x +
                    Math.cos(angle) * (65 + (i % 4) * 14),
                  // The old ellipse entered the front wall at its northern arc.
                  // Keep the whole patrol in front of the same 2D/3D building.
                  y: places[p.id].y + b.y + 45 + Math.sin(angle) * 20,
                };
          walking = active && Boolean(moving);
          patrolling = walking;
          saved[chat.id] = { position: point };
          if (moving) dirty = true;
        }
        if(terrain&&patrolling&&previous&&dry(previous,terrain)&&
          !islandRouteWalkable([previous,point],terrain.island,terrain)){
          point=previous;walking=false;saved[chat.id]={...saved[chat.id],position:point};
        }
        if(terrain&&!dry(point,terrain)){
          const nearest=[...resting].sort((a,b)=>Math.hypot(a.x+places[p.id].x-point.x,a.y+places[p.id].y-point.y)-
            Math.hypot(b.x+places[p.id].x-point.x,b.y+places[p.id].y-point.y))[0];
          if(nearest){point={x:places[p.id].x+nearest.x,y:places[p.id].y+nearest.y};saved[chat.id]={...saved[chat.id],position:point};dirty=true;
            if(stopped.has(chat.id))stopped.set(chat.id,{...stopped.get(chat.id),...point});}
        }
        const dx = previous ? point.x - previous.x : 0,
          dy = previous ? point.y - previous.y : 0;
        const heading = stopped.has(chat.id)
          ? stopped.get(chat.id).heading
          : Math.hypot(dx, dy) > 0.01
            ? Math.atan2(dx, -dy)
            : saved[chat.id]?.heading || 0;
        saved[chat.id] = { ...saved[chat.id], heading };
        result.push({
          ...point,
          kind: "agent",
          identityFocused: chat.id === job?.conversationId,
          conversationId: chat.id,
          name: chat.characterName || chat.title || "住民",
          projectId: p.id,
          seed: chat.id,
          delegation: delegations.get(chat.id)?.value || null,
          heading,
          direction: direction(heading),
          walking,
          activity: active ? "working" : "idle",
          journey: journey && !active ? journey : null,
        });
      }
    }
    if (dirty && clock - lastSave > 1000) {
      lastSave = clock;
      dirty = false;
      try {
        mapStorage.setItem(key, JSON.stringify(saved));
      } catch {}
    }
    return result;
  }
  return {
    get,
    save() { try { mapStorage.setItem(key, JSON.stringify(saved)); } catch {} },
    relocate(id, point, heading = 0) {
      if (!id || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
      // Resume any recorded journey from this real position on its next visit.
      saved[id] = {position:{x:point.x,y:point.y},heading:Number.isFinite(heading)?heading:0};
      checkedJourneys.delete(id);
      stopped.delete(id);
      try {mapStorage.setItem(key,JSON.stringify(saved));} catch {}
      return true;
    },
    stop(person) {
      stopped.set(person.conversationId, {
        x: person.x,
        y: person.y,
        heading: Number.isFinite(person.heading) ? person.heading : 0,
      });
    },
    face(id, heading) {
      const person = stopped.get(id);
      if (person && Number.isFinite(heading)) person.heading = heading;
    },
    release(id) {
      stopped.delete(id);
    },
  };
}
