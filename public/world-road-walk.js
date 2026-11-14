import { distance } from "./world-travel.js";

const finite = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const coordinateKey = (point) => Math.round(point.x * 1e6) + ":" + Math.round(point.y * 1e6);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const delta = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const epsilon = 1e-9;

function connectIntersection(left, right) {
  const { a, b } = left, c = right.a, d = right.b;
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - epsilon ||
      Math.max(c.x, d.x) < Math.min(a.x, b.x) - epsilon ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) - epsilon ||
      Math.max(c.y, d.y) < Math.min(a.y, b.y) - epsilon) return;
  const r = delta(b, a), s = delta(d, c), offset = delta(c, a), divisor = cross(r, s);
  const add = (segment, point) => {
    const v = delta(segment.b, segment.a), length2 = v.x * v.x + v.y * v.y;
    if (!length2 && distance(point, segment.a) > epsilon) return;
    const t = length2 ? ((point.x - segment.a.x) * v.x + (point.y - segment.a.y) * v.y) / length2 : 0;
    if (t >= -epsilon && t <= 1 + epsilon) segment.splits.push({ point, t: Math.max(0, Math.min(1, t)) });
  };
  if (Math.abs(divisor) > epsilon) {
    const t = cross(offset, s) / divisor, u = cross(offset, r) / divisor;
    if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return;
    const point = { x: a.x + Math.max(0, Math.min(1, t)) * r.x, y: a.y + Math.max(0, Math.min(1, t)) * r.y };
    add(left, point); add(right, point);
  } else if (Math.abs(cross(offset, r)) <= epsilon && Math.abs(cross(offset, s)) <= epsilon) {
    // Collinear streets may overlap after a saved route is retained.
    for (const point of [a, b, c, d]) { add(left, point); add(right, point); }
  }
}

// Project onto the actual road, including its middle, rather than just corners.
export function closestRoadPoint(target, roads) {
  if (!finite(target)) return null;
  let best = null;
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const points = roads[roadIndex]?.points;
    if (!Array.isArray(points)) continue;
    for (let segment = 1; segment < points.length; segment++) {
      const a = points[segment - 1], b = points[segment];
      if (!finite(a) || !finite(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2)) : 0;
      const point = { x: a.x + t * dx, y: a.y + t * dy }, gap = distance(target, point);
      if (!best || gap < best.distance) best = { point, distance: gap, roadIndex, segment, t };
    }
  }
  return best;
}

// A clicked point on a road is a destination along that road. Split the source
// and destination segments and compare real lengths, including saved streets.
export function roadWalkingRoute(start, target, roads) {
  const source = closestRoadPoint(start, roads), destination = closestRoadPoint(target, roads);
  if (!source || !destination) return [];
  const nodes = new Map();
  const node = (point) => {
    const key = coordinateKey(point);
    if (!nodes.has(key)) nodes.set(key, { point: { x: point.x, y: point.y }, edges: new Map() });
    return key;
  };
  const join = (a, b) => {
    const left = node(a), right = node(b), length = distance(a, b);
    if (left === right) return;
    nodes.get(left).edges.set(right, length);
    nodes.get(right).edges.set(left, length);
  };
  const segments = [];
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const points = roads[roadIndex]?.points;
    if (!Array.isArray(points)) continue;
    for (let segment = 1; segment < points.length; segment++) {
      const a = points[segment - 1], b = points[segment];
      if (!finite(a) || !finite(b)) continue;
      const splits = [{ point: a, t: 0 }, { point: b, t: 1 },
        ...[source, destination].filter((p) => p.roadIndex === roadIndex && p.segment === segment)];
      segments.push({ a, b, splits });
    }
  }
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++)
    connectIntersection(segments[i], segments[j]);
  for (const segment of segments) {
    const splits = segment.splits.sort((a, b) => a.t - b.t);
    for (let i = 1; i < splits.length; i++) join(splits[i - 1].point, splits[i].point);
  }
  const from = node(source.point), to = node(destination.point), costs = new Map([[from, 0]]), previous = new Map(), done = new Set();
  while (true) {
    let current = null, cost = Infinity;
    for (const [key, value] of costs) if (!done.has(key) && value < cost) { current = key; cost = value; }
    if (current === null) return [];
    if (current === to) break;
    done.add(current);
    for (const [next, length] of nodes.get(current).edges) {
      const value = cost + length;
      if (value < (costs.get(next) ?? Infinity)) { costs.set(next, value); previous.set(next, current); }
    }
  }
  const path = [];
  for (let key = to; key !== undefined; key = previous.get(key)) path.unshift(nodes.get(key).point);
  return [start, ...path, target].filter((point, i, all) => !i || distance(point, all[i - 1]) > 1e-8);
}
