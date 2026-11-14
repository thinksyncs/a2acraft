import { avoidBuildings, routeLength } from "./world-travel.js";
import { buildingObstacles, facilities } from "./project-buildings.js";

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const walkingDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + 200;

function treeDistances(ids, edges) {
  const neighbors = new Map(ids.map((id) => [id, []]));
  for (const { from, to, length } of edges) {
    neighbors.get(from).push({ to, length });
    neighbors.get(to).push({ to: from, length });
  }
  return ids.map((from) => {
    const distances = new Map([[from, 0]]), queue = [from];
    for (const at of queue)
      for (const { to, length } of neighbors.get(at))
        if (!distances.has(to)) {
          distances.set(to, distances.get(at) + length);
          queue.push(to);
        }
    return ids.map((id) => distances.get(id) ?? Infinity);
  });
}

function scoreDistances(distances, rankings) {
  let violations = 0, gap = 0;
  for (let from = 0; from < rankings.length; from++) {
    const row = distances[from];
    let stronger = [], group = [], score = Infinity, longest = -Infinity;
    for (const item of rankings[from]) {
      if (item.score !== score) {
        stronger.push(...group);
        stronger.sort((a, b) => a - b);
        if (stronger.length) longest = stronger.at(-1);
        group = [];
        score = item.score;
      }
      // Count every inverted strong/weak pair, without comparing equal topics.
      let low = 0, high = stronger.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (stronger[middle] < row[item.index]) low = middle + 1;
        else high = middle;
      }
      violations += stronger.length - low;
      const difference = longest + 40 - row[item.index];
      if (difference > 0) gap += difference * difference;
      group.push(row[item.index]);
    }
  }
  return { violations, gap };
}

function prepareOrder(ids, scoreFor) {
  return ids.map((from) => ids.flatMap((to, index) =>
    from === to ? [] : [{ index, score: scoreFor(from, to) }],
  ).sort((a, b) => b.score - a.score));
}

// Candidate scoring uses the same affinity-first tree and visible road lengths.
// Topic scores and row ordering are prepared once per placement, not per point.
function prepareCandidateScore(ids, scoreFor) {
  const rankings = prepareOrder(ids, scoreFor);
  if (!rankings.some((row) => row.length && row[0].score !== row.at(-1).score))
    return () => ({ violations: 0, gap: 0 });
  const pairs = ids.flatMap((from, i) => ids.slice(i + 1).map((to) => ({
    from, to, score: scoreFor(from, to),
  })));
  return (places) => {
    const candidates = pairs.map((pair) => ({
      ...pair, length: walkingDistance(places[pair.from], places[pair.to]),
    })).sort((a, b) => b.score - a.score || a.length - b.length ||
      compareId(a.from, b.from) || compareId(a.to, b.to));
    const components = new Map(ids.map((id) => [id, id])), edges = [];
    const root = (id) => {
      while (components.get(id) !== id) id = components.get(id);
      return id;
    };
    for (const edge of candidates) {
      const a = root(edge.from), b = root(edge.to);
      if (a === b) continue;
      components.set(a, b);
      edges.push(edge);
      if (edges.length === ids.length - 1) break;
    }
    return scoreDistances(treeDistances(ids, edges), rankings);
  };
}

function createPlacement(projects, chats, saved, { topicEvidence, affinity }) {
  const items = projects.map((project) => ({
    id: project.id, evidence: topicEvidence(project, chats, saved[project.id]?.topics),
  })).sort((a, b) => compareId(a.id, b.id));
  const scores = new Map(items.map((a) => [a.id, new Map(items.map((b) =>
    [b.id, affinity(a.evidence, b.evidence)],
  ))]));
  const scoreFor = (a, b) => scores.get(a).get(b);
  const centralities = new Map(items.map((item) =>
    [item.id, [...scores.get(item.id).values()].reduce((sum, score) => sum + score, 0)],
  ));
  function build(ranked) {
    const places = {}, pending = [...items];
    // Saved locations, pins and the existing home district keep their positions.
    for (const id of Object.keys(saved)) {
      const item = pending.find((item) => item.id === id), prior = saved[id];
      if (!item || !prior || !Number.isFinite(prior.x) || !Number.isFinite(prior.y)) continue;
      places[id] = { ...prior, evidence: item.evidence };
      pending.splice(pending.indexOf(item), 1);
    }
    while (pending.length) {
      const ids = Object.keys(places).sort(compareId), existing = ids.map((id) => places[id]);
      const connections = new Map(pending.map((item) =>
        [item.id, Math.max(0, ...ids.map((id) => scoreFor(item.id, id)))],
      ));
      pending.sort((a, b) => connections.get(b.id) - connections.get(a.id) ||
        centralities.get(b.id) - centralities.get(a.id) || compareId(a.id, b.id));
      const item = pending.shift(), evidence = item.evidence;
      if (!existing.length) {
        places[item.id] = { x: 0, y: 0, evidence };
        continue;
      }
      const anchorId = [...ids].sort((a, b) => scoreFor(item.id, b) - scoreFor(item.id, a))[0];
      const anchor = places[anchorId], score = scoreFor(item.id, anchorId),
        distance = score ? 1180 + (1 - score) * 700 : 3200;
      const evaluate = ranked ? prepareCandidateScore([...ids, item.id].sort(compareId), scoreFor) : null;
      const baseline = ranked ? prepareCandidateScore(ids, scoreFor)(places).violations : 0;
      let best = null;
      // Search extra nearby rings only when topic ordering still needs work.
      // If the local area is full, keep searching until a free position exists.
      for (let ring = 1; ring <= (ranked ? 3 : 1) || !best; ring++) {
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6, candidate = {
            x: Math.round(anchor.x + Math.cos(angle) * distance * ring),
            y: Math.round(anchor.y + Math.sin(angle) * distance * ring), evidence,
          };
          if (!existing.every((p) => Math.abs(p.x - candidate.x) > 1080 || Math.abs(p.y - candidate.y) > 760)) continue;
          const quality = evaluate ? evaluate({ ...places, [item.id]: candidate }) : { violations: 0, gap: 0 };
          const cost = ids.reduce((sum, id) => {
            const score = scoreFor(item.id, id), desired = (score ? 1180 + (1 - score) * 700 : 3200) + 200;
            const difference = walkingDistance(candidate, places[id]) - desired;
            return sum + difference * difference * (difference < 0 ? 4 : 1);
          }, 0);
          const value = { ...quality, cost, candidate };
          if (!best || (value.violations - best.violations || value.gap - best.gap ||
            value.cost - best.cost || best.candidate.x - candidate.x || best.candidate.y - candidate.y) < 0) best = value;
        }
        if (best && (!ranked || best.violations <= baseline)) break;
      }
      places[item.id] = best.candidate;
    }
    return places;
  }
  return { build, scoreFor };
}

function walkingQuality(places, projects, roads, scoreFor) {
  const ids = Object.keys(places).sort(compareId);
  const obstacles = buildingObstacles(places, projects.map((project) => ({
    ...project, repositories: project.repositories || [], jobs: project.jobs || [],
  })));
  obstacles.push(...facilities.map((f) => ({
    left: f.x - 70, right: f.x + 70, top: f.y - 75, bottom: f.y + 15,
  })));
  const edges = roads(places).map((road) => {
    const walked = [road.points[0]];
    for (const end of road.points.slice(1)) {
      const start = walked.at(-1), relevant = obstacles.filter((r) =>
        r.right >= Math.min(start.x, end.x) - 100 && r.left <= Math.max(start.x, end.x) + 100 &&
        r.bottom >= Math.min(start.y, end.y) - 100 && r.top <= Math.max(start.y, end.y) + 100,
      );
      const segment = avoidBuildings(start, end, relevant);
      if (!segment.length) return { ...road, length: Infinity };
      walked.push(...segment.slice(1));
    }
    return { ...road, length: routeLength(walked) };
  });
  const distances = treeDistances(ids, edges), positions = Object.values(places);
  const width = Math.max(...positions.map((p) => p.x + 1000)) - Math.min(...positions.map((p) => p.x));
  const height = Math.max(...positions.map((p) => p.y + 640)) - Math.min(...positions.map((p) => p.y));
  return {
    ...scoreDistances(distances, prepareOrder(ids, scoreFor)),
    maximumWalk: Math.max(0, ...distances.flat()), diagonal: Math.hypot(width, height),
  };
}

export function placeDistrictsByTopic(projects, chats, saved, context) {
  const { build, scoreFor } = createPlacement(projects, chats, saved, context);
  const compact = build(false);
  if (projects.length < 3 || projects.every((project) =>
    Number.isFinite(saved[project.id]?.x) && Number.isFinite(saved[project.id]?.y))) return compact;
  const ranked = build(true);
  if (Object.keys(compact).every((id) => compact[id].x === ranked[id].x && compact[id].y === ranked[id].y)) return compact;
  // Judge the finished worlds using real obstacle detours. A nicer local
  // ranking must not make the whole world worse or turn travel into a long trek.
  const before = walkingQuality(compact, projects, context.worldRoads, scoreFor);
  const after = walkingQuality(ranked, projects, context.worldRoads, scoreFor);
  return after.violations < before.violations &&
    Number.isFinite(after.maximumWalk) && after.maximumWalk <= before.maximumWalk * 2 &&
    Number.isFinite(after.diagonal) && after.diagonal <= before.diagonal * 2 ? ranked : compact;
}
