// Small, dependency-free 3D math. Matrices use WebGL column-major layout.
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
export const add = (a, b) => a.map((value, index) => value + b[index]);
export const subtract = (a, b) => a.map((value, index) => value - b[index]);
export const scale = (a, amount) => a.map(value => value * amount);
export const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalize(value) {
  const length = Math.hypot(...value);
  return length > 1e-9 ? scale(value, 1 / length) : value.map(() => 0);
}
export function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0,
    0, 0, (near + far) * range, -1, 0, 0, 2 * near * far * range, 0]);
}
export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize(subtract(eye, target));
  let x = normalize(cross(up, z));
  if (Math.hypot(...x) < 1e-6) x = [1, 0, 0];
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
export function multiply(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++)
    for (let k = 0; k < 4; k++) result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return result;
}
export function transform(matrix, point) {
  return [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
}
export function invert(matrix) {
  const rows = Array.from({length: 4}, (_, row) =>
    [...[0, 1, 2, 3].map(column => matrix[column * 4 + row]), ...[0, 1, 2, 3].map(column => Number(row === column))]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map(value => value / divisor);
    for (let row = 0; row < 4; row++) if (row !== column) {
      const amount = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - amount * rows[column][index]);
    }
  }
  return new Float32Array([0, 1, 2, 3].flatMap(column => rows.map(row => row[column + 4])));
}
export function screenRay(x, y, viewProjection) {
  const inverse = invert(viewProjection);
  if (!inverse || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const near = transform(inverse, [x, y, -1, 1]), far = transform(inverse, [x, y, 1, 1]);
  if (Math.abs(near[3]) < 1e-9 || Math.abs(far[3]) < 1e-9) return null;
  const origin = near.slice(0, 3).map(value => value / near[3]);
  const end = far.slice(0, 3).map(value => value / far[3]);
  return {origin, direction: normalize(subtract(end, origin))};
}
export function rayGround(ray) {
  if (!ray || Math.abs(ray.direction[1]) < 1e-8) return null;
  const distance = -ray.origin[1] / ray.direction[1];
  if (distance < 0 || !Number.isFinite(distance)) return null;
  const point = add(ray.origin, scale(ray.direction, distance));
  return {x: point[0], y: point[2], distance};
}
export function rayBox(ray, box) {
  if (!ray) return null;
  let near = 0, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const origin = ray.origin[axis], direction = ray.direction[axis];
    if (Math.abs(direction) < 1e-9) {
      if (origin < box.min[axis] || origin > box.max[axis]) return null;
      continue;
    }
    const a = (box.min[axis] - origin) / direction, b = (box.max[axis] - origin) / direction;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return Number.isFinite(near) && far >= 0 ? near : null;
}
export function worldBounds(bounds = {}) {
  const left = finite(bounds.left, 0), right = Math.max(left + 20, finite(bounds.right, 1000));
  const top = finite(bounds.top, 0), bottom = Math.max(top + 20, finite(bounds.bottom, 640));
  return {left, right, top, bottom};
}
export function initialCamera(bounds) {
  const b = worldBounds(bounds), diagonal = Math.hypot(b.right - b.left, b.bottom - b.top);
  return {mode: 'overview', targetX: (b.left + b.right) / 2, targetY: (b.top + b.bottom) / 2,
    yaw: 0.35, pitch: 0.82, distance: Math.max(220, diagonal * 0.85),
    lookYaw: 0, lookPitch: 0, followDistance: 100, fov: Math.PI / 3};
}
export function sanitizeCamera(value, fallback = initialCamera()) {
  return {
    mode: ['overview', 'leader', 'follow'].includes(value?.mode) ? value.mode : fallback.mode,
    targetX: clamp(finite(value?.targetX, fallback.targetX), -100000, 100000),
    targetY: clamp(finite(value?.targetY, fallback.targetY), -100000, 100000),
    yaw: finite(value?.yaw, fallback.yaw) % (Math.PI * 2),
    pitch: clamp(finite(value?.pitch, fallback.pitch), 0.15, 1.48),
    distance: clamp(finite(value?.distance, fallback.distance), 45, 100000),
    lookYaw: finite(value?.lookYaw, fallback.lookYaw) % (Math.PI * 2),
    lookPitch: clamp(finite(value?.lookPitch, fallback.lookPitch), -1.1, 0.85),
    followDistance: clamp(finite(value?.followDistance, fallback.followDistance), 35, 260),
    fov: clamp(finite(value?.fov, fallback.fov || Math.PI / 3), Math.PI / 5, Math.PI * 0.48),
  };
}
export function cameraPose(state, leader = {}) {
  const x = finite(leader.x, state.targetX), z = finite(leader.y, state.targetY);
  const yaw = finite(leader.heading) + state.lookYaw;
  if (state.mode === 'leader') {
    const eye = [x, 20, z], forward = [Math.sin(yaw) * Math.cos(state.lookPitch), Math.sin(state.lookPitch), -Math.cos(yaw) * Math.cos(state.lookPitch)];
    return {eye, target: add(eye, scale(forward, 80)), yaw};
  }
  if (state.mode === 'follow') {
    const height = 0.38 + state.lookPitch * 0.4, distance = state.followDistance;
    return {eye: [x - Math.sin(yaw) * distance, 20 + distance * Math.max(0.08, height), z + Math.cos(yaw) * distance], target: [x, 14, z], yaw};
  }
  const radius = state.distance * Math.cos(state.pitch);
  return {eye: [state.targetX + Math.sin(state.yaw) * radius, state.distance * Math.sin(state.pitch), state.targetY + Math.cos(state.yaw) * radius], target: [state.targetX, 0, state.targetY], yaw: -state.yaw};
}
export function movementTarget(leader, yaw, forward, right, amount = 40) {
  const length = Math.hypot(forward, right) || 1;
  return {x: finite(leader?.x) + (Math.sin(yaw) * forward + Math.cos(yaw) * right) * amount / length,
    y: finite(leader?.y) + (-Math.cos(yaw) * forward + Math.sin(yaw) * right) * amount / length};
}
