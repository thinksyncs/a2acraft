import {
  drawVillageWorld,
  drawDevelopmentLandscape,
  drawWorldPerson,
  drawWorldFacility,
  drawWorldDelegates,
  drawWorldHydrology,
  drawWorldHydrologyOutlets,
  drawWorldSettlement,
  drawWorldBridges,
  worldPersonColor,
} from "./village-art.js";
import {
  placeDistricts,
  visibleWorldRoads,
  districtRoute,
  hub,
} from "./world-geography.js";
import { PartyTravel, avoidBuildings, distance } from "./world-travel.js";
import { closestRoadPoint, roadWalkingRoute } from "./world-road-walk.js";
import { drawRoadNetwork } from "./world-road-art.js";
import { projectSceneGeometry } from "./project-scene.js";
import { projectMapGroups } from "./project-map-groups.js";
import { drawIslandWater, clipIslandLand, drawIslandCoast } from "./world-island-art.js";
import { pointInIsland } from "./world-island.js";
import { islandLandRoute, islandRouteWalkable } from "./world-island-travel.js";
import { createResidents } from "./project-residents.js";
import { mapStorage } from "./map-storage.js";
import { mapWheelCamera, createMapInputFrame } from "./map-camera-input.js";
import { characterPose } from "./world-model-descriptors.js";
import { createWorld3D } from "./world-3d.js";
import { villageDelegateActors, addDelegatesToScene } from "./village-delegates.js";
import {
  projectBuildings,
  sceneBuildingObstacles,
  facilities,
  jobLabel,
} from "./project-buildings.js";
export { projectBuildings, jobLabel } from "./project-buildings.js";

function headingBetween(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.hypot(dx, dy) > 0.01 ? Math.atan2(dx, -dy) : 0;
}

// Facility streets approach along the east/west lane. Stop where the facade
// and the street both fit in the leader's field of view.
export function facilityArrival(facility) {
  return {x:facility.x + (facility.x < -100 ? 138 : -138), y:facility.y+50};
}

export function repairProjectPose(previous,geometry) {
  const terrain={water:geometry.water,bridges:geometry.bridges,obstacles:sceneBuildingObstacles(geometry)};
  const safe=p=>islandRouteWalkable([p,p],geometry.island,terrain);
  const legacy=facilities.find(f=>distance(previous,{x:f.x,y:f.y+30})<2);
  if(legacy){
    const point=facilityArrival(legacy);
    if(safe(point))return {point,heading:headingBetween(point,legacy)};
  }
  if(safe(previous)&&!legacy)return null;
  const candidates=[];
  for(const road of geometry.roads||[])for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((previous.x-a.x)*dx+(previous.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    candidates.push({point:{x:a.x+dx*t,y:a.y+dy*t},toward:t<.5?b:a});
    candidates.push({point:a,toward:b},{point:b,toward:a});
  }
  candidates.sort((a,b)=>distance(a.point,previous)-distance(b.point,previous));
  for(const {point,toward} of candidates){
    const gap=distance(point,toward);
    if(gap<24)continue;
    const part=Math.min(1,64/gap),ahead={x:point.x+(toward.x-point.x)*part,y:point.y+(toward.y-point.y)*part};
    if(islandRouteWalkable([point,ahead],geometry.island,terrain))return {point,heading:headingBetween(point,ahead)};
  }
  return null;
}

export function projectOverviewCamera(bounds, width, height) {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    zoom: Math.min(1, Math.max(1, width - 60) / (bounds.right - bounds.left),
      Math.max(1, height - 80) / (bounds.bottom - bounds.top)),
  };
}

// Keep eye contact readable without moving or deleting anyone in the town.
export function projectEncounterSightline(scene, conversationId) {
  const person = scene.people.find((item) => item.id === "resident:" + conversationId),
    leader = scene.leader;
  if (!person || !leader) return scene;
  const dx = person.x - leader.x, dy = person.y - leader.y,
    gap = Math.hypot(dx, dy);
  if (gap < 0.01) return scene;
  return { ...scene, people: scene.people.filter((item) => {
    if (item.id === person.id || item.id === leader.id) return true;
    const x = item.x - leader.x, y = item.y - leader.y,
      along = (x * dx + y * dy) / gap,
      across = (x * -dy + y * dx) / gap;
    return !(along > -10 && along < gap + 12 && Math.abs(across) < 18);
  }) };
}

export function projectLeaderPose(owner, position, heading) {
  return {
    ...(owner ? {...owner, kind:"agent", identityFocused:true, color:worldPersonColor(owner)}
      : {seed:"hero0", color:worldPersonColor({}, {hero:true,index:0})}),
    ...position, heading, id:"leader",
  };
}

// Chat and both map projections share the same held actors, including the
// identity of an agent the user is currently controlling.
export function projectConversationEncounter(scene, conversationId, name) {
  const person = scene.people.find(item => item.id === "resident:" + conversationId);
  if (!person || !scene.leader) return null;
  return {source:"projects",conversationId,name:name || person.name || "住民",
    person,leader:scene.leader,phase:"talking",status:"talking",
    scene:projectEncounterSightline(scene,conversationId)};
}

export function projectConversationApproach(person, origin, geometry, routeTo) {
  const dx=origin.x-person.x,dy=origin.y-person.y,
    angle=Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):Math.PI/2,
    terrain={...geometry,obstacles:[...(geometry.obstacles||[]),...sceneBuildingObstacles(geometry)]};
  // A reachable destination alone does not guarantee eye contact: the wall
  // between it and the resident must also be absent in the shared geometry.
  for(const turn of [0,1,-1,2,-2,3,-3,4]){
    const target={x:person.x+Math.cos(angle+turn*Math.PI/4)*40,
      y:person.y+Math.sin(angle+turn*Math.PI/4)*40};
    if(!islandRouteWalkable([person,target],geometry.island,terrain))continue;
    const route=routeTo(target);
    if(route.length&&distance(route.at(-1),target)<=.01)return {target,route};
  }
  return null;
}

export function createProjectWorld({
  canvas,
  overlay,
  getProjects,
  getChats,
  getWorld = () => ({}),
  onDistrict,
  onEvent,
  onResident,
  onRoom,
  onParty,
  onDismissSpeech = () => {},
  notify = () => {},
}) {
  const ctx = canvas.getContext("2d"),
    demo = new URLSearchParams(location.search).get("demo") === "1";
  const key = "chat-ui-project-camera" + (demo ? "-demo" : ""),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  // Keep real saved journeys untouched; old demo crowds have a separate cache.
  const people = createResidents(key + "-residents" + (demo ? "-v2" : ""),{
    buildingsFor:districtBuildings,terrainFor:()=>sceneGeometry(places(),getProjects()),
  });
  let camera = { x: 500, y: 320, zoom: 1 },
    size = { w: 1, h: 1 },
    visible = false,
    frame = 0,
    last = 0,
    clock = 0,
    paused = false,
    saved = false,
    inputSaveTimer = 0;
  const inputFrame = createMapInputFrame(draw);
  let drag = null,
    signature = "",
    hits = [],
    partyHits = [],
    follow = false,
    selected = "hero",
    speechId = null,
    moving = 0,
    destination = null,
    lastPersist = 0,
    restoredPositionChecked = false;
  const travel = new PartyTravel();
  let renderer3D = null, threeDFailed = false,
    insetEnabled = true, insetCamera = null, leaderHeading = 0,
    lastLeader = { ...travel.position }, selection3D = new Map(),
    encounter = null;
  const insetKey = key + "-leader-inset";
  const frameElement = canvas.parentElement;
  const inset = document.createElement("section");
  inset.id = "project-leader-window";
  inset.className = "world-3d-inset";
  inset.hidden = true;
  inset.setAttribute("aria-labelledby", "project-leader-title");
  const insetHeader = document.createElement("header");
  insetHeader.className = "world-3d-inset-header";
  const insetTitle = document.createElement("strong");
  insetTitle.id = "project-leader-title";
  insetTitle.textContent = "リーダー目線";
  insetTitle.title = "操作中のパーティ先頭の目線";
  const insetClose = document.createElement("button");
  insetClose.type = "button";
  insetClose.className = "world-3d-inset-close";
  insetClose.textContent = "×";
  insetClose.setAttribute("aria-label", "目線ウィンドウを閉じる");
  insetClose.onclick = () => { setInset(false); insetToggle.focus(); };
  insetHeader.append(insetTitle, insetClose);
  const insetToggle = document.createElement("button");
  insetToggle.id = "project-leader-toggle";
  insetToggle.type = "button";
  insetToggle.className = "world-3d-inset-toggle";
  insetToggle.setAttribute("aria-controls", inset.id);
  insetToggle.onclick = () => setInset(!insetEnabled);
  const mapControls = frameElement.parentElement.querySelector(".project-map-controls");
  if (mapControls) mapControls.append(insetToggle);
  else frameElement.after(insetToggle);
  const viewHelp = document.createElement("p");
  viewHelp.id = "project-3d-note";
  viewHelp.className = "world-3d-help";
  const viewError = document.createElement("p");
  viewError.id = "project-3d-error";
  viewError.className = "world-3d-error";
  viewError.setAttribute("role", "status");
  viewError.hidden = true;
  frameElement.before(viewHelp, viewError);
  const canvas3D = document.createElement("canvas");
  canvas3D.id = "project-map-3d";
  canvas3D.className = "world-3d-inset-canvas";
  canvas3D.tabIndex = 0;
  canvas3D.setAttribute("aria-label", "操作中のパーティ先頭の目線。WASDで歩き、ドラッグか矢印キーで見回します。地面・建物・住民も選べます。");
  canvas3D.setAttribute("aria-describedby", viewHelp.id);
  inset.append(insetHeader, canvas3D);
  frameElement.append(inset);
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "wheel", "keydown"])
    inset.addEventListener(type, (event) => event.stopPropagation());
  canvas.dataset.viewMode = "2d";
  frameElement.dataset.viewMode = "2d";
  const journeyStatus = document.createElement("p");
  journeyStatus.className = "world-journey-status";
  journeyStatus.setAttribute("role", "status");
  canvas.parentElement.append(journeyStatus);
  try {
    const value = JSON.parse(mapStorage.getItem(key));
    if (
      value &&
      [value.x, value.y, value.zoom].every(Number.isFinite) &&
      value.zoom >= 0.000001 &&
      value.zoom <= 2
    ) {
      camera = value;
      saved = true;
    }
  } catch {}
  try {
    const value = JSON.parse(mapStorage.getItem(key + "-hero")),
      point = value?.point || value;
    if (point && [point.x, point.y].every(Number.isFinite)) {
      travel.position = point;
      leaderHeading = Number.isFinite(value.heading) ? value.heading : 0;
      selected = typeof value.selected === "string" ? value.selected : "hero";
      travel.count = 1;
      travel.members = Array.from({ length: travel.count }, () => ({
        ...point,
      }));
    }
  } catch {}
  lastLeader = { ...travel.position };
  try {
    const value = JSON.parse(mapStorage.getItem(insetKey));
    if (typeof value?.visible === "boolean") insetEnabled = value.visible;
    if (value?.camera && typeof value.camera === "object") insetCamera = value.camera;
  } catch {}
  updateInsetControls();
  let layoutCache = null,
    layoutProjects = null,
    layoutChats = null,
    layoutSaved = null;
  function places() {
    const projects = getProjects(),
      chats = getChats(),
      savedPlaces = getWorld()?.places;
    if (
      !layoutCache ||
      projects !== layoutProjects ||
      chats !== layoutChats ||
      savedPlaces !== layoutSaved
    ) {
      layoutProjects = projects;
      layoutChats = chats;
      layoutSaved = savedPlaces;
      layoutCache = placeDistricts(projects, chats, savedPlaces || {});
    }
    return layoutCache;
  }
  let roadsCache = null, roadsLayout = null, roadsJourneys = null;
  function roads(layout) {
    const journeys = getWorld()?.journeys;
    if (!roadsCache || layout !== roadsLayout || journeys !== roadsJourneys) {
      roadsLayout = layout;
      roadsJourneys = journeys;
      roadsCache = visibleWorldRoads(layout, journeys || {});
    }
    return roadsCache;
  }
  const noMotion = () =>
    paused || reduced.matches || document.body.dataset.motion === "reduced";
  function persist() {
    clearTimeout(inputSaveTimer);
    inputSaveTimer = 0;
    saved = true;
    try {
      mapStorage.setItem(key, JSON.stringify(camera));
      mapStorage.setItem(
        key + "-hero",
        JSON.stringify({
          point: travel.position,
          selected,
          count: travel.count,
          heading: leaderHeading,
        }),
      );
      mapStorage.setItem(insetKey, JSON.stringify({
        visible: insetEnabled,
        camera: renderer3D?.getCameraState?.() || insetCamera,
      }));
    } catch {}
  }
  function fail3D(message) {
    threeDFailed = true;
    inset.hidden = true;
    renderer3D?.setVisible(false);
    insetToggle.disabled = true;
    updateInsetControls();
    viewError.textContent = "目線ウィンドウを表示できません。俯瞰マップはそのまま操作できます。" +
      (typeof message === "string" ? " " + message : "");
    viewError.hidden = false;
  }
  function ensure3D() {
    if (renderer3D) return renderer3D.supported !== false && !threeDFailed;
    if (threeDFailed) return false;
    try {
      renderer3D = createWorld3D({
        canvas: canvas3D,
        onGround: (point) => moveGround(point, true),
        onSelect: ({ id }) => selection3D.get(id)?.(),
        onFailure: fail3D,
        onContextChange: restored => {
          viewError.hidden = restored || !insetEnabled;
          if (!restored) viewError.textContent = "目線の描画を復旧しています。";
          else syncInset();
        },
      });
      if (!renderer3D || renderer3D.supported === false || threeDFailed) {
        if (!threeDFailed) fail3D();
        return false;
      }
      if (insetCamera) renderer3D.setCameraState?.(insetCamera);
      renderer3D.setMode("leader");
      return true;
    } catch (error) {
      fail3D(error.message);
      return false;
    }
  }
  function updateInsetControls() {
    const shown = insetEnabled && !threeDFailed;
    insetToggle.textContent = shown ? "目線を隠す" : "目線を表示";
    insetToggle.setAttribute("aria-expanded", String(shown));
    insetToggle.setAttribute("aria-pressed", String(shown));
    frameElement.dataset.leaderInset = String(shown);
  }
  function resizeInset() {
    if (!renderer3D || inset.hidden) return;
    const rect = canvas3D.getBoundingClientRect();
    if (rect.width && rect.height)
      renderer3D.resize(rect.width, rect.height, Math.min(devicePixelRatio || 1, 2));
  }
  function syncInset() {
    if (visible && insetEnabled && !ensure3D()) return;
    inset.hidden = !insetEnabled || threeDFailed;
    updateInsetControls();
    resizeInset();
    renderer3D?.setVisible(visible && insetEnabled && !threeDFailed && !document.hidden);
  }
  function setInset(value) {
    insetEnabled = Boolean(value);
    syncInset();
    persist();
    draw();
  }
  viewHelp.textContent = "俯瞰マップを操作すると、右上にパーティ先頭の目線が映ります。目線ウィンドウ内はWASDで歩く・ドラッグ／矢印キーで見回す・Escで移動を取り消す。";
  function screen(x, y) {
    return {
      x: (x - camera.x) * camera.zoom + size.w / 2,
      y: (y - camera.y) * camera.zoom + size.h / 2,
    };
  }
  function point(x, y) {
    return {
      x: (x - size.w / 2) / camera.zoom + camera.x,
      y: (y - size.h / 2) / camera.zoom + camera.y,
    };
  }
  function fit(save = true) {
    follow = false;
    const layout = places(), geometry = sceneGeometry(layout, getProjects(), getResidents());
    camera = projectOverviewCamera(geometry.island.seaBounds, size.w, size.h);
    if (save) persist();
    draw();
  }
  function focus(id) {
    const place = places()[id];
    if (!place) return;
    const settlement=sceneGeometry(places(),getProjects()).settlements.find(s=>s.id===id),plots=settlement?.plots||[];
    const bounds=plots.length?{left:Math.min(...plots.map(p=>p.left))-90,right:Math.max(...plots.map(p=>p.right))+90,
      top:Math.min(...plots.map(p=>p.top))-110,bottom:Math.max(...plots.map(p=>p.bottom))+90}:
      {left:place.x,right:place.x+1000,top:place.y,bottom:place.y+640};
    follow = false;
    camera = {
      x: (bounds.left+bounds.right)/2,
      y: (bounds.top+bounds.bottom)/2,
      zoom: Math.min(1.35, (size.w - 50) / (bounds.right-bounds.left), (size.h - 65) / (bounds.bottom-bounds.top)),
    };
    persist();
    draw();
  }
  function zoom(factor) {
    follow = false;
    const geometry = sceneGeometry(places(), getProjects(), getResidents());
    const overview = projectOverviewCamera(geometry.island.seaBounds, size.w, size.h);
    camera.zoom = Math.max(overview.zoom, Math.min(2, camera.zoom * factor));
    if (factor < 1 && camera.zoom <= overview.zoom) {
      camera.x = overview.x;
      camera.y = overview.y;
    }
    persist();
    draw();
  }
  function nearest(p, layout) {
    return Object.keys(layout).sort(
      (a, b) => distance(p, hub(layout[a])) - distance(p, hub(layout[b])),
    )[0];
  }
  function routeTo(target, alongRoad = false) {
    const layout = places(),
      from = nearest(travel.position, layout),
      to = nearest(target, layout);
    let route = [travel.position, target];
    const sourceFacility = facilities.find(
      (f) => distance(travel.position, facilityArrival(f)) < 90,
    );
    const targetFacility = facilities.find(
      (f) => distance(target, facilityArrival(f)) < 5,
    );
    const approach = (f) => [
      { x: 500, y: 610 },
      { x: -100, y: 710 },
      { x: -100, y: f.y + 50 },
      facilityArrival(f),
    ];
    if (alongRoad) {
      const prefix = sourceFacility ? [travel.position, ...[...approach(sourceFacility)].reverse()] : [travel.position];
      const street = roadWalkingRoute(prefix.at(-1), target, roads(layout));
      if (!street.length) return [];
      route = [...prefix, ...street.slice(1)];
    } else if (sourceFacility || targetFacility) {
      const home = Object.keys(layout)[0],
        source = sourceFacility ? home : from,
        dest = targetFacility ? home : to;
      route = [
        travel.position,
        ...(sourceFacility ? [...approach(sourceFacility)].reverse() : []),
        ...(source && dest && source !== dest
          ? districtRoute(source, dest, layout)
          : []),
        ...(targetFacility ? approach(targetFacility) : []),
        target,
      ];
    } else if (from && to && from !== to)
      route = [travel.position, ...districtRoute(from, to, layout), target];
    const geometry=sceneGeometry(layout,getProjects(),getResidents());
    const obstacles=sceneBuildingObstacles(geometry);
    const terrain={water:geometry.water,bridges:geometry.bridges,obstacles};
    const result = [route[0]];
    for (const end of route.slice(1)) {
      const start = result.at(-1),
        relevant = obstacles.filter(
          (r) =>
            r.right >= Math.min(start.x, end.x) - 100 &&
            r.left <= Math.max(start.x, end.x) + 100 &&
            r.bottom >= Math.min(start.y, end.y) - 100 &&
            r.top <= Math.max(start.y, end.y) + 100,
        );
      let segment = avoidBuildings(start, end, relevant);
      if(segment.length&&!islandRouteWalkable(segment,geometry.island,terrain))
        segment=islandLandRoute(start,end,geometry.island,{obstacles,...terrain});
      if (!segment.length) return [];
      result.push(...segment.slice(1));
    }
    return result;
  }
  function release() {
    if (speechId) people.release(speechId);
    speechId = null;
    encounter = null;
    delete canvas.dataset.encounter;
    delete canvas.dataset.encounterPhase;
    delete canvas.dataset.encounterPose;
  }
  function endEncounter() {
    release();
    draw();
  }
  function getEncounter() {
    return encounter?.phase === "talking" ? structuredClone(encounter) : null;
  }
  function cancel() {
    onDismissSpeech();
    travel.cancel();
    destination = null;
    canvas.dataset.travel = "idle";
    canvas.dataset.destination = "";
    follow = false;
    release();
    draw();
  }
  function walk(target, arrival, label, fromInset = false, onStart, alongRoad = false, plannedRoute) {
    const geometry=sceneGeometry(places(),getProjects(),getResidents());
    if (!islandRouteWalkable([target,target],geometry.island,{water:geometry.water,bridges:geometry.bridges})) return false;
    const route = plannedRoute || routeTo(target, alongRoad);
    if (!route.length) {
      notify("そこへ通じる道が見つかりません。道か建物の入口を選んでください。");
      return false;
    }
    onDismissSpeech();
    release();
    onStart?.();
    destination = label || "移動先";
    follow = true;
    if (!fromInset) renderer3D?.setMode("leader");
    if (distance(route.at(-1), target) > 4)
      notify("建物や水辺の手前にある、通れる場所へ向かいます。");
    canvas.dataset.destination = destination;
    canvas.dataset.travel = "walking";
    travel.go(
      route,
      () => {
        destination = null;
        canvas.dataset.travel = "arrived";
        if (follow) {
          camera.x = travel.position.x;
          camera.y = travel.position.y;
        }
        persist();
        arrival?.();
        draw();
      },
      { instant: noMotion() },
    );
    draw();
    return true;
  }
  function visit(facility) {
    walk(
      facilityArrival(facility),
      () => {
        leaderHeading=headingBetween(travel.position,facility);lastLeader={...travel.position};
        persist();onRoom?.(facility, travel.count);
      },
      facility.name,
    );
  }
  function enter(project, building) {
    const place = places()[project.id];
    walk(
      { x: place.x + building.x, y: place.y + building.y + 18 },
      () =>
        onRoom?.(
          {
            id: "building",
            name: building.name,
            host: "建物の管理人",
            project: getProjects().find((p) => p.id === project.id) || project,
            building,
          },
          travel.count,
        ),
      building.name,
    );
  }
  function talk(person) {
    if (person.conversationId === controlledChat()?.id) {
      notify("いま操作しているエージェントです。会話は地区の記録から開けます。");
      return false;
    }
    const geometry = sceneGeometry(places(), getProjects(), getResidents());
    // A riverbank or doorway may block the near side of a resident. Find a
    // reachable dry side before cancelling the current trip or holding them.
    const approach = projectConversationApproach(person,travel.position,geometry,routeTo);
    if (!approach) {
      notify("この住民の近くに立てる道が見つかりません。別の場所から話しかけてください。");
      return false;
    }
    return walk(
      approach.target,
      () => {
        if (speechId !== person.conversationId) return;
        leaderHeading = headingBetween(travel.position, person);
        const personHeading = headingBetween(person, travel.position);
        people.face(person.conversationId, personHeading);
        lastLeader = { ...travel.position };
        const scene = buildScene3D(places(), getProjects(), residentPoses(people.get({
          projects: getProjects(), chats: getChats(), places: places(),
          journeys: getWorld()?.journeys || {}, clock, moving: 0,
        })), false);
        encounter = projectConversationEncounter(scene, person.conversationId,
          person.name || getChats().find(chat => chat.id === person.conversationId)?.characterName);
        if (!encounter) {
          cancel();
          notify("この住民は現在の地区にいません。住民の一覧から選び直してください。");
          return;
        }
        canvas.dataset.encounterPhase = "talking";
        canvas.dataset.encounterPose = JSON.stringify({ person: encounter.person, leader: encounter.leader });
        renderer3D?.setMode("leader");
        renderer3D?.reset();
        renderer3D?.setCameraState({ lookPitch: -0.04 });
        persist();
        draw();
        onResident(person.conversationId, person.journey, getEncounter());
      },
      "住民と話す",
      false,
      () => {
        speechId = person.conversationId;
        people.stop(person);
        encounter = { conversationId: person.conversationId, phase: "approaching", status: "approaching" };
        canvas.dataset.encounter = person.conversationId;
        canvas.dataset.encounterPhase = "approaching";
      },
      false,
      approach.route,
    );
  }
  function getResidents() {
    return residentPoses(people.get({
      projects: getProjects(), chats: getChats(), places: places(),
      journeys: getWorld()?.journeys || {}, clock, moving: 0,
    })).map((person) => ({ ...person }));
  }
  function talkTo(conversationId) {
    const person = getResidents().find((resident) => resident.conversationId === conversationId);
    if (!person) return false;
    return talk(person) !== false;
  }
  function control(projectId, jobId) {
    const p = getProjects().find((p) => p.id === projectId),
      job = p?.jobs.find((j) => j.id === jobId);
    if (job && !job.conversationId) {
      notify("この工程には操作するエージェントがいません。");
      return false;
    }
    if (
      job &&
      ["running", "preparing", "queued", "blocked"].includes(job.status)
    ) {
      notify("この隊は仕事を担当しています。会話から進み具合を確認できます。");
      return false;
    }
    const previousOwner = controlledChat();
    const nextOwner = job ? getResidents().find(person=>person.conversationId===job.conversationId) : null;
    if (job && !nextOwner) return false;
    cancel();
    // Cancellation redraws the old selection and holds it once more. Release
    // that final hold before selecting the next owner, preserving its location.
    if (previousOwner) people.relocate(previousOwner.id, travel.position, leaderHeading);
    selected = job ? projectId + ":" + jobId : "hero";
    travel.count = 1;
    if (job) {
      travel.position = { x: nextOwner.x, y: nextOwner.y };
      leaderHeading = nextOwner.heading;
      people.stop(nextOwner);
    }
    travel.members = Array.from({ length: travel.count }, (_, i) => ({
      x: travel.position.x - i * 18,
      y: travel.position.y,
    }));
    lastLeader = { ...travel.position };
    canvas.dataset.party = selected;
    draw();
    return true;
  }
  function projectDelegates(residents) {
    // Both views use the same nearby parents before the global drawing limit.
    // Prioritize the held conversation, then the party's actual location.
    const anchor = encounter?.person || travel.position;
    return villageDelegateActors([...residents].sort((a,b) =>
      Math.hypot(a.x-anchor.x,a.y-anchor.y)-Math.hypot(b.x-anchor.x,b.y-anchor.y))
      .map(person => ({...person,color:worldPersonColor(person)})));
  }
  function controlledChat() {
    for (const project of getProjects()) {
      const job = project.jobs.find(job => project.id + ":" + job.id === selected);
      if (job) return getChats().find(chat => chat.id === job.conversationId) || null;
    }
    return null;
  }
  function residentPoses(residents) {
    const chat = controlledChat();
    if (chat) people.stop({conversationId:chat.id,...travel.position,heading:leaderHeading});
    return residents.map(person => person.conversationId === chat?.id
      ? {...person, ...travel.position, heading:leaderHeading, walking:Boolean(travel.route), identityFocused:true}
      : {...person, identityFocused:person.identityFocused || person.conversationId === speechId});
  }
  let geometryCache = null, geometryLayout = null, geometryRoads = null, geometryKey = "";
  function sceneGeometry(layout, projects, residents) {
    residents ||= projects.flatMap(project=>getChats().filter(chat=>chat.project?.id===project.id).slice(0,180)
      .map(()=>({projectId:project.id})));
    const links = roads(layout);
    const key = JSON.stringify(projects.map(p=>[p.id,projectBuildings(p),residents.filter(r=>r.projectId===p.id).length]));
    if (!geometryCache || geometryLayout !== layout || geometryRoads !== links || geometryKey !== key) {
      geometryLayout=layout;geometryRoads=links;geometryKey=key;
      geometryCache=projectSceneGeometry(layout,projects,residents,links);
    }
    return geometryCache;
  }
  function districtBuildings(project){
    return sceneGeometry(places(),getProjects()).settlements.find(plan=>plan.id===project.id)?.buildings||projectBuildings(project);
  }
  function buildScene3D(layout, projects, residents, motion) {
    selection3D = new Map();
    const controlled = controlledChat();
    const inhabitants = residents.filter(person => person.conversationId !== controlled?.id).map(resident => {
      const id = "resident:" + resident.conversationId;
      selection3D.set(id, () => talk(resident));
      return {...characterPose(resident,{time:clock,motion}), id, kind:"agent", color:worldPersonColor(resident)};
    });
    for (const project of projects) for (const building of districtBuildings(project))
      selection3D.set("building:" + JSON.stringify([project.id, building.id]), () => enter(project, building));
    for (const facility of facilities)
      selection3D.set("facility:" + facility.id, () => visit(facility));
    const owner = residents.find(person => person.conversationId === controlled?.id);
    const leader = characterPose({...projectLeaderPose(owner, travel.position, leaderHeading),walking:Boolean(travel.route)},{time:clock,motion});
    inhabitants.push(leader);
    const geometry = sceneGeometry(layout, projects, residents);
    const scene = {...geometry, staticGeometry:geometry, people:inhabitants, leader};
    const delegatedScene = addDelegatesToScene(scene, projectDelegates(residents));
    return encounter?.phase === "talking"
      ? projectEncounterSightline(delegatedScene, encounter.conversationId) : delegatedScene;
  }
  function update3D(layout, projects, residents, motion) {
    if (!insetEnabled || threeDFailed || !renderer3D) return;
    const scene = buildScene3D(layout, projects, residents, motion);
    renderer3D.update(scene);
    canvas3D.dataset.hero = JSON.stringify(travel.position);
    canvas3D.dataset.party = selected;
    canvas3D.dataset.buildings = String(scene.buildings.length);
    canvas3D.dataset.people = String(scene.people.length);
  }
  function draw() {
    inputFrame.cancel();
    if (!visible || !size.w) return;
    const layout = places(),
      projects = getProjects(),
      motion = !noMotion() && !document.hidden;
    if(!restoredPositionChecked){
      restoredPositionChecked=true;
      const repaired=repairProjectPose(travel.position,sceneGeometry(layout,projects));
      if(repaired){
        travel.position=repaired.point;leaderHeading=repaired.heading;
        travel.members=Array.from({length:travel.count},()=>({...travel.position}));lastLeader={...travel.position};
        insetCamera={...(renderer3D?.getCameraState()||insetCamera||{}),lookYaw:0,lookPitch:0};
        renderer3D?.setCameraState(insetCamera);persist();
      }
    }
    if (selected !== "hero") {
      const [pid, jid] = selected.split(":"),
        job = projects
          .find((p) => p.id === pid)
          ?.jobs.find((j) => j.id === jid);
      if (
        !job || !job.conversationId ||
        ["running", "preparing", "queued", "blocked"].includes(job.status)
      ) {
        const owner = controlledChat();
        if (owner) people.relocate(owner.id, travel.position, leaderHeading);
        selected = "hero";
        travel.count = 1;
        travel.members = [{ ...travel.position }];
        cancel();
      }
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const dx = travel.position.x - lastLeader.x, dy = travel.position.y - lastLeader.y;
    if (Math.hypot(dx, dy) > 0.01) leaderHeading = Math.atan2(dx, -dy);
    lastLeader = { ...travel.position };
    if (follow && travel.route) {
      camera.x = travel.position.x;
      camera.y = travel.position.y;
    }
    ctx.translate(size.w / 2, size.h / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const residents = residentPoses(people.get({
      projects, chats:getChats(), places:layout, journeys:getWorld()?.journeys || {}, clock, moving,
    }));
    moving = 0;
    const geometry = sceneGeometry(layout, projects, residents);
    frameElement.dataset.mapScale = camera.zoom < .25 ? "island" : "district";
    const viewport = {
      left: camera.x - size.w / 2 / camera.zoom,
      right: camera.x + size.w / 2 / camera.zoom,
      top: camera.y - size.h / 2 / camera.zoom,
      bottom: camera.y + size.h / 2 / camera.zoom,
      zoom: camera.zoom,
    };
    drawIslandWater(ctx, geometry.island, viewport);
    ctx.save();
    clipIslandLand(ctx, geometry.island);
    drawDevelopmentLandscape(ctx, {...viewport, scenery:geometry.landscape, biomes:geometry.biomes});
    ctx.restore();
    drawIslandCoast(ctx, geometry.island);
    ctx.save();clipIslandLand(ctx,geometry.island);
    for(const settlement of geometry.settlements)drawWorldSettlement(ctx,settlement,{...viewport,layer:'ground'});
    drawWorldHydrology(ctx,geometry.hydrology,viewport);
    drawRoadNetwork(ctx, geometry.roads);
    for(const settlement of geometry.settlements)drawWorldSettlement(ctx,settlement,{...viewport,layer:'scenery'});
    hits = [];
    partyHits = [];
    for (const p of projects) {
      const place = layout[p.id],
        { x, y } = place,
        view = screen(x, y);
      const plots=geometry.settlements.find(s=>s.id===p.id)?.plots||[];
      const visiblePlots=plots.length?plots.some(plot=>{
        const a=screen(plot.left-40,plot.top-80),b=screen(plot.right+40,plot.bottom+40);
        return a.x<size.w&&b.x>0&&a.y<size.h&&b.y>0;
      }):false;
      if (
        !visiblePlots&&(
        view.x > size.w ||
        view.y > size.h ||
        view.x + 1000 * camera.zoom < 0 ||
        view.y + 640 * camera.zoom < 0
      ))
        continue;
      const buildings = districtBuildings(p);
      ctx.save();
      ctx.translate(x, y);
      drawVillageWorld(ctx, {
        time: clock,
        projects: buildings,
        population: residents.filter((r) => r.projectId === p.id).length,
        motion,
        outskirtsVisible: false,
        terrainVisible: false,
      });
      ctx.restore();
    }
    for (const f of facilities) drawWorldFacility(ctx, f);
    drawWorldBridges(ctx,geometry.bridges,viewport);
    const stride =
      camera.zoom < 0.15 ? Math.max(1, Math.ceil(residents.length / 600)) : 1;
    const controlled = controlledChat();
    const owner = residents.find(person => person.conversationId === controlled?.id);
    for (const [index, resident] of residents.entries()) {
      if (resident.conversationId === controlled?.id) continue;
      if (index % stride && resident.conversationId !== speechId) continue;
      const s = screen(resident.x, resident.y);
      if (s.x < 0 || s.x > size.w || s.y < 0 || s.y > size.h) continue;
      drawWorldPerson(ctx, resident, { time: clock, motion });
      hits.push({ ...resident, screen: s });
    }
    travel.members.forEach((member, i) =>
      drawWorldPerson(
        ctx,
        { ...(owner || {}), ...member, seed: owner?.seed || "hero" + i, walking: Boolean(travel.route), heading: leaderHeading,
          direction: ["up", "right", "down", "left"][((Math.round(leaderHeading / (Math.PI / 2)) % 4) + 4) % 4] },
        { hero: !owner, index: i, time: clock, motion },
      ),
    );
    const delegates = projectDelegates(residents);
    drawWorldDelegates(ctx, delegates);
    canvas.dataset.nativeSubagents = String(delegates.badges.reduce((count, badge) => count + badge.count, 0));
    canvas.dataset.renderedSubagents = String(delegates.helpers.length);
    if (travel.route) {
      const end = travel.route.at(-1);
      ctx.strokeStyle = "#fff1a8";
      ctx.lineWidth = 3 / camera.zoom;
      ctx.beginPath();
      ctx.ellipse(
        end.x,
        end.y,
        10 / camera.zoom,
        5 / camera.zoom,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
    drawWorldHydrologyOutlets(ctx,geometry.hydrology,viewport);
    const selectedJob = projects
      .flatMap((p) =>
        p.jobs.map((j) => ({ id: p.id + ":" + j.id, title: j.title })),
      )
      .find((j) => j.id === selected);
    const journeyLabel =
      (selectedJob?.title || "主人公") +
      (encounter?.phase === "talking"
        ? " · " + encounter.name + "と向き合って話しています"
        : destination
        ? " · " + destination + "へ歩いています"
        : canvas.dataset.travel === "arrived"
          ? " · 全員が到着しました"
          : " · 地面か行き先を選ぶ");
    if (journeyStatus.textContent !== journeyLabel)
      journeyStatus.textContent = journeyLabel;
    canvas.dataset.party = selected;
    canvas.dataset.hero = JSON.stringify(travel.position);
    canvas.dataset.members = JSON.stringify(travel.members);
    const atlas = camera.zoom < .065;
    const mapGroups = atlas ? projectMapGroups(projects, layout, camera.zoom) : [];
    const grouped = new Set(mapGroups.filter(group=>group.ids.length>1).flatMap(group=>group.ids));
    const sig =
      (atlas ? "world" : camera.zoom >= 0.65 ? "near" : "far") +
      JSON.stringify(mapGroups.map(group=>[group.ids,group.x,group.y])) +
      JSON.stringify(
        projects.map((p) => [
          p.id,
          p.name,
          p.paused,
          p.events,
          p.jobs.map((j) => [j.id, j.status]),
        ]),
      );
    if (sig !== signature) {
      signature = sig;
      overlay.replaceChildren();
      const label = (name, className, data, action) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = className;
        b.textContent = name;
        Object.assign(b.dataset, data);
        b.onclick = action;
        overlay.append(b);
        return b;
      };
      for (const f of facilities)
        label(
          f.name,
          "project-building-label project-facility",
          { facility: f.id },
          () => visit(f),
        );
      for (const group of mapGroups.filter(group=>group.ids.length>1)) {
        const title = label(
          "仕事の街 · " + group.ids.length + "地区",
          "project-district-label project-cluster-label",
          {cluster:JSON.stringify(group.ids),clusterX:String(group.x),clusterY:String(group.y)},
          () => {
            follow = false;
            camera = {x:group.x,y:group.y,zoom:Math.min(2,Math.max(.12,camera.zoom*3))};
            persist();
            draw();
          },
        );
        title.style.minHeight = "44px";
        title.style.minWidth = "110px";
        const waiting = group.projects.filter(project=>project.jobs.some(job=>job.status==="blocked") ||
          project.events.some(event=>event.status==="open"&&event.kind!=="progress")).length;
        const progress = group.projects.filter(project=>project.events.some(event=>event.status==="open"&&event.kind==="progress"&&!event.seen)).length;
        const attention = waiting ? "相談 " + waiting + "地区" : progress ? "進展 " + progress + "地区" : "";
        if (attention) title.append(Object.assign(document.createElement("small"),{textContent:"! " + attention}));
        title.setAttribute("aria-label",group.ids.length + "地区の仕事の街を拡大" + (attention?" · " + attention:""));
      }
      for (const p of projects) {
        if (grouped.has(p.id)) continue;
        const title = label(
          p.name,
          "project-district-label",
          { project: p.id },
          () => {
            focus(p.id);
            onDistrict(p.id);
          },
        );
        const stage = document.createElement("small");
        stage.textContent = p.paused
          ? "休止中"
          : p.jobs.some((j) => j.status === "blocked")
            ? "相談待ち"
            : p.jobs.every((j) => j.status === "done")
              ? p.pullRequests?.length ? "PR到着" : "工程完了"
              : jobLabel(
                  p.jobs.find((j) =>
                    ["running", "preparing"].includes(j.status),
                  ) || p.jobs[0],
                );
        title.append(stage);
        for (const b of districtBuildings(p))
          label(
            b.name,
            "project-building-label",
            { project: p.id, building: b.id },
            () => enter(p, b),
          );
        const events = p.events.filter(
          (e) => e.status === "open" && (e.kind !== "progress" || !e.seen),
        );
        for (const [index, event] of (camera.zoom >= 0.65
          ? events
          : events.slice(0, 1)
        ).entries()) {
          const kind =
            event.kind === "progress"
              ? "進展"
              : event.kind === "question"
                ? "相談"
                : "問題";
          const b = label(
            "!",
            "project-attention",
            {
              project: p.id,
              attention: "true",
              ...(camera.zoom >= 0.65
                ? { event: event.id, eventIndex: String(index) }
                : {}),
            },
            () => {
              cancel();
              onEvent(p, event);
            },
          );
          b.setAttribute(
            "aria-label",
            p.name + " · " + kind + "：" + event.question,
          );
          b.title = kind + "：" + event.question;
          const caption = document.createElement("small");
          caption.textContent = kind;
          b.append(caption);
        }
      }
    }
    for (const button of overlay.children) {
      let target,
        detail = false;
      if (button.dataset.cluster) {
        target = {x:Number(button.dataset.clusterX),y:Number(button.dataset.clusterY)};
      } else if (button.dataset.facility) {
        const f = facilities.find((f) => f.id === button.dataset.facility);
        target = { x: f.x, y: f.y + 65 };
      } else {
        const p = projects.find((p) => p.id === button.dataset.project),
          place = layout[p.id],
          b =
            button.dataset.building &&
            districtBuildings(p).find((b) => b.id === button.dataset.building);
        const townCenter=geometry.settlements.find(s=>s.id===p.id)?.center||{x:place.x+500,y:place.y+140};
        target = b
          ? { x: place.x + b.x, y: place.y + b.y - 92 }
          : {
              x: townCenter.x + (button.dataset.attention ? 180 : 0),
              y: townCenter.y - (button.dataset.attention ? 20 : 100),
            };
        if (button.dataset.event) {
          const event = p.events.find((e) => e.id === button.dataset.event),
            job = p.jobs.find((j) => j.id === event?.jobId),
            site =
              districtBuildings(p).find((b) => b.jobId === job?.id) ||
              districtBuildings(p).find((b) => b.id === job?.repoId);
          if (site)
            target = {
              x:
                place.x +
                site.x +
                70 +
                (Number(button.dataset.eventIndex) * 48) / camera.zoom,
              y: place.y + site.y - 45,
            };
        }
        detail = Boolean(b);
      }
      const s = screen(target.x, target.y);
      button.style.left = s.x + "px";
      button.style.top = s.y + "px";
      button.hidden =
        (detail && camera.zoom < 0.65) ||
        s.x < 24 ||
        s.x > size.w - 24 ||
        s.y < 22 ||
        s.y > size.h - 22;
    }
    update3D(layout, projects, residents, motion);
  }
  function loop(time) {
    frame = 0;
    if (!visible || noMotion() || document.hidden) return;
    if (time - last > 80) {
      moving = Math.min(time - last, 100) / 1000;
      clock += moving * 1000;
      last = time;
      travel.advance(moving);
      draw();
      if (travel.route && clock - lastPersist > 1000) {
        lastPersist = clock;
        persist();
      }
    }
    frame = requestAnimationFrame(loop);
  }
  function animate() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (noMotion() && travel.route && visible && !document.hidden)
      travel.advance(Infinity);
    if (visible && !noMotion() && !document.hidden) {
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
    renderer3D?.setVisible(visible && insetEnabled && !threeDFailed && !document.hidden);
    draw();
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    size = { w: rect.width, h: rect.height };
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(size.w * dpr), pixelHeight = Math.round(size.h * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    resizeInset();
    if (!saved) fit(false);
    draw();
  }
  new ResizeObserver(resize).observe(canvas);
  new ResizeObserver(resizeInset).observe(canvas3D);
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    drag = {
      x: e.clientX,
      y: e.clientY,
      cx: camera.x,
      cy: camera.y,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) {
      follow = false;
      camera.x = drag.cx - dx / camera.zoom;
      camera.y = drag.cy - dy / camera.zoom;
      draw();
    }
  };
  canvas.onpointerup = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) {
      persist();
      return;
    }
    const rect = canvas.getBoundingClientRect(),
      p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const person = hits
      .filter((h) => distance(h.screen, p) < 15)
      .sort((a, b) => distance(a.screen, p) - distance(b.screen, p))[0];
    if (person) {
      talk(person);
      return;
    }
    const party = partyHits.find((h) => distance(h, p) < 18);
    if (party) {
      onParty?.(party.projectId, party.jobId);
      return;
    }
    const clicked=point(p.x,p.y),land=places();
    const facility=facilities.find(f=>Math.abs(clicked.x-f.x)<90&&clicked.y>f.y-100&&clicked.y<f.y+20);
    if(facility){visit(facility);return;}
    for(const project of getProjects()){
      const place=land[project.id],building=districtBuildings(project).find(b=>Math.abs(clicked.x-place.x-b.x)<55&&clicked.y>place.y+b.y-65&&clicked.y<place.y+b.y+12);
      if(building){enter(project,building);return;}
    }
    moveGround(clicked);
  };
  function moveGround(clicked, fromInset = false) {
    if(!pointInIsland(clicked,sceneGeometry(places(),getProjects(),getResidents()).island))return false;
    let target = clicked,
      layout = places(),
      id = nearest(target, layout),
      alongRoad = false;
    const district = id && layout[id];
    if (
      district &&
      (target.x < district.x ||
        target.x > district.x + 1000 ||
        target.y < district.y ||
        target.y > district.y + 640)
    ) {
      const road = closestRoadPoint(target, roads(layout));
      const facility = facilities.map((f) => ({ x: f.x, y: f.y + 60 }))
        .sort((a, b) => distance(a, target) - distance(b, target))[0];
      const onRoad = Boolean(road && (!facility || road.distance <= distance(facility, target)));
      const nearestPoint = onRoad ? road.point : facility;
      if (nearestPoint && distance(nearestPoint, target) <= 300) {
        target = nearestPoint;
        alongRoad = onRoad;
      }
    }
    return walk(target, null, "選んだ場所", fromInset, undefined, alongRoad);
  }
  canvas3D.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  });
  canvas.onpointercancel = () => {
    drag = null;
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      follow = false;
      const rect = canvas.getBoundingClientRect();
      const geometry = geometryCache || sceneGeometry(places(), getProjects(), getResidents());
      const overview = projectOverviewCamera(geometry.island.seaBounds, size.w, size.h);
      camera = mapWheelCamera(camera, e, { width: size.w, height: size.h,
        minZoom: overview.zoom, maxZoom: 2,
        anchor: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
      saved = true;
      clearTimeout(inputSaveTimer);
      inputSaveTimer = setTimeout(persist, 300);
      inputFrame.request();
    },
    { passive: false },
  );
  canvas.onkeydown = (e) => {
    const moves = {
      ArrowLeft: [-80, 0],
      ArrowRight: [80, 0],
      ArrowUp: [0, -80],
      ArrowDown: [0, 80],
    };
    if (moves[e.key]) {
      e.preventDefault();
      follow = false;
      camera.x += moves[e.key][0] / camera.zoom;
      camera.y += moves[e.key][1] / camera.zoom;
      persist();
      draw();
    }
    if (e.key === "Home") {
      e.preventDefault();
      fit();
    }
    if (e.key === "Escape") cancel();
  };
  reduced.addEventListener("change", animate);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persist();
    animate();
  });
  window.addEventListener("chat-ui-motion", animate);
  window.addEventListener("pagehide", persist);
  return {
    render: draw,
    saveView() { people.save(); persist(); },
    fit,
    focus,
    zoom,
    visit,
    enter,
    control,
    release,
    getEncounter,
    endEncounter,
    getResidents,
    talkTo,
    cancel,
    pause(value) {
      paused = value;
      animate();
    },
    setVisible(value, { preserveEncounter = false } = {}) {
      if (!value && visible) {
        if (preserveEncounter && encounter?.phase === "talking") travel.cancel();
        else cancel();
        persist();
      } else if (!value && !preserveEncounter && encounter) cancel();
      visible = value;
      if (value) {
        resize();
      }
      syncInset();
      animate();
    },
  };
}
