import { placeDistrictsByTopic } from "./world-layout.js";

// Shared, deterministic geography. Saved coordinates always win over inference.
const vocabulary = {
  development:
    /ソフト|開発|実装|コード|repo|アプリ|検索|プレビュー|software|code|feature|search/gi,
  work: /仕事|業務|会議|企画|予定|work|business|task/gi,
  research: /研究|論文|実験|調査|比較|分析|research|science|study/gi,
  folklore: /怪談|お化け|幽霊|妖怪|民俗|伝承|ghost|folklore/gi,
  life: /暮らし|生活|料理|旅行|家族|健康|旅|life|travel/gi,
};
export const topicNames = {
  development: "開発",
  work: "仕事",
  research: "研究",
  folklore: "怪談・民俗",
  life: "暮らし",
};
export function topicEvidence(project, chats = [], override) {
  if (Array.isArray(override))
    return override.map((topic) => ({ topic, source: "user" }));
  const sources = [
    { text: project.goal || "", source: "goal" },
    ...chats
      .filter((c) => c.project?.id === project.id)
      .slice(-30)
      .map((c) => ({
        text: [
          c.title,
          ...(c.messages || [])
            .filter((m) => m.role === "user")
            .slice(-3)
            .map((m) => m.text),
        ].join(" "),
        source: c.id,
      })),
  ];
  const result = [];
  for (const [topic, pattern] of Object.entries(vocabulary)) {
    const match = sources.find((row) => {
      pattern.lastIndex = 0;
      return pattern.test(row.text);
    });
    if (match) result.push({ topic, source: match.source });
  }
  return result;
}
export function affinity(a, b) {
  const aa = new Set(a.map((x) => x.topic || x)),
    bb = new Set(b.map((x) => x.topic || x));
  if (!aa.size || !bb.size) return 0;
  let overlap = [...aa].filter((x) => bb.has(x)).length;
  if (
    !overlap &&
    ((aa.has("work") && bb.has("research")) ||
      (aa.has("research") && bb.has("work")))
  )
    overlap = 0.35;
  return overlap / Math.max(aa.size, bb.size);
}
export function placeDistricts(projects, chats, saved = {}) {
  return placeDistrictsByTopic(projects, chats, saved, { topicEvidence, affinity, worldRoads });
}
export const hub = (place) => ({ x: place.x + 500, y: place.y + 610 });
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const walkingDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + 200;
export function worldRoads(places) {
  const ids = Object.keys(places).sort(compareId), edges = [], candidates = [];
  // A maximum-affinity spanning tree joins related districts before adding
  // longer links between themes. Distance and IDs settle ties deterministically.
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const from = ids[i], to = ids[j];
      candidates.push({
        from, to,
        score: affinity(places[from].evidence || [], places[to].evidence || []),
        distance: walkingDistance(places[from], places[to]),
      });
    }
  candidates.sort((a, b) =>
    b.score - a.score || a.distance - b.distance || compareId(a.from, b.from) || compareId(a.to, b.to),
  );
  const components = new Map(ids.map((id) => [id, id]));
  const root = (id) => {
    while (components.get(id) !== id) id = components.get(id);
    return id;
  };
  for (const { from, to } of candidates) {
    const left = root(from), right = root(to);
    if (left === right) continue;
    components.set(left, right);
    const a = hub(places[from]), b = hub(places[to]);
    edges.push({
      from,
      to,
      points: [
        a,
        { x: a.x, y: Math.max(a.y, b.y) + 100 },
        { x: b.x, y: Math.max(a.y, b.y) + 100 },
        b,
      ],
    });
    if (edges.length === ids.length - 1) break;
  }
  return edges;
}
export function visibleWorldRoads(places, journeys = {}) {
  const roads = worldRoads(places);
  const key = (points) => {
    const forward = JSON.stringify(points), reverse = JSON.stringify([...points].reverse());
    return forward < reverse ? forward : reverse;
  };
  const seen = new Set(roads.map((road) => key(road.points)));
  // Residents keep their recorded journey after an update or a new district.
  // Draw those existing streets in both views without changing their movement.
  for (const journey of Object.values(journeys)) {
    if (!journey || !places[journey.from] || !places[journey.to] ||
        !Array.isArray(journey.points) || journey.points.length < 2 ||
        !journey.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
    const signature = key(journey.points);
    if (seen.has(signature)) continue;
    seen.add(signature);
    roads.push({ from: journey.from, to: journey.to, points: journey.points });
  }
  return roads;
}
export function districtRoute(from, to, places) {
  if (from === to) return [hub(places[from])];
  const roads = worldRoads(places),
    queue = [{ id: from, points: [] }],
    seen = new Set();
  while (queue.length) {
    const row = queue.shift();
    if (row.id === to) return row.points;
    seen.add(row.id);
    for (const road of roads) {
      const next =
        road.from === row.id ? road.to : road.to === row.id ? road.from : null;
      if (!next || seen.has(next)) continue;
      queue.push({
        id: next,
        points: [
          ...row.points,
          ...(road.from === row.id ? road.points : [...road.points].reverse()),
        ],
      });
    }
  }
  return [];
}
