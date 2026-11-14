export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function routeLength(points) {
  return points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0);
}
export function routePoint(points, progress) {
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (progress <= length) {
      const t = length ? Math.max(0, progress) / length : 1;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    progress -= length;
  }
  return { ...points.at(-1) };
}
const inside = (p, r) =>
  p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
function blocked(a, b, r) {
  if (inside(a, r) || inside(b, r)) return true;
  // Slab intersection against an open rectangle; corners remain walkable.
  let lo = 0,
    hi = 1;
  for (const [key, min, max] of [
    ["x", r.left, r.right],
    ["y", r.top, r.bottom],
  ]) {
    const delta = b[key] - a[key];
    if (!delta) {
      if (a[key] <= min || a[key] >= max) return false;
      continue;
    }
    let t1 = (min - a[key]) / delta,
      t2 = (max - a[key]) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    lo = Math.max(lo, t1);
    hi = Math.min(hi, t2);
  }
  return lo < hi - 1e-8 && hi > 0 && lo < 1;
}
export function avoidBuildings(start, target, obstacles = []) {
  let end = { ...target };
  for (const r of obstacles)
    if (inside(end, r)) {
      const choices = [
        { x: r.left, y: end.y },
        { x: r.right, y: end.y },
        { x: end.x, y: r.top },
        { x: end.x, y: r.bottom },
      ];
      end = choices.sort(
        (a, b) => distance(a, target) - distance(b, target),
      )[0];
    }
  const relevant = obstacles.filter((r) => !inside(start, r));
  const nodes = [
    start,
    end,
    ...relevant.flatMap((r) => [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.left, y: r.bottom },
      { x: r.right, y: r.bottom },
    ]),
  ];
  const costs = nodes.map(() => Infinity),
    previous = [],
    done = new Set();
  costs[0] = 0;
  for (let n = 0; n < nodes.length; n++) {
    let best = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!done.has(i) && (best < 0 || costs[i] < costs[best])) best = i;
    if (best < 0 || !Number.isFinite(costs[best])) return [];
    if (best === 1) {
      const result = [];
      for (let i = 1; i !== undefined; i = previous[i])
        result.unshift(nodes[i]);
      return result;
    }
    done.add(best);
    for (let i = 0; i < nodes.length; i++)
      if (
        !done.has(i) &&
        !relevant.some((r) => blocked(nodes[best], nodes[i], r))
      ) {
        const cost = costs[best] + distance(nodes[best], nodes[i]);
        if (cost < costs[i]) {
          costs[i] = cost;
          previous[i] = best;
        }
      }
  }
  return [];
}
export class PartyTravel {
  constructor(position = { x: 500, y: 610 }, count = 1) {
    this.position = position;
    this.count = count;
    this.version = 0;
    this.route = null;
    this.members = Array.from({ length: count }, () => ({ ...position }));
  }
  cancel() {
    this.version++;
    this.route = null;
    this.onArrival = null;
  }
  go(points, onArrival, { instant = false } = {}) {
    this.cancel();
    if (!points.length) return false;
    if (points.length === 1) {
      this.position = { ...points[0] };
      this.members = Array.from({ length: this.count }, () => ({
        ...points[0],
      }));
      onArrival?.();
      return true;
    }
    this.route = points;
    this.progress = 0;
    this.length = routeLength(points);
    this.onArrival = onArrival;
    if (instant) this.advance(Infinity);
    return true;
  }
  advance(seconds) {
    if (!this.route) return;
    this.progress += seconds * 90;
    this.members = Array.from({ length: this.count }, (_, i) =>
      routePoint(this.route, Math.max(0, this.progress - i * 18)),
    );
    this.position = this.members[0];
    if (this.progress >= this.length + (this.count - 1) * 18) {
      const callback = this.onArrival;
      this.cancel();
      callback?.();
    }
  }
}
