import {cross, normalize, subtract, clamp} from './world-3d-math.js';

export function hash(value) {
  let result = 2166136261;
  for (const char of String(value ?? '')) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function color(value, fallback = '#b99a72') {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite))
    return value.slice(0, 3).map(v => clamp(v, 0, 1));
  const text = typeof value === 'string' ? value.trim() : fallback;
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(text);
  if (short) return short.slice(1).map(v => parseInt(v + v, 16) / 255);
  if (/^#[\da-f]{6}$/i.test(text)) return [1, 3, 5].map(i => parseInt(text.slice(i, i + 2), 16) / 255);
  return color(fallback);
}
export function triangle(out, a, b, c, shade) {
  const normal = normalize(cross(subtract(b, a), subtract(c, a)));
  for (const point of [a, b, c]) out.push(...point, ...normal, ...shade);
}
export function quad(out, a, b, c, d, shade) {
  triangle(out, a, b, c, shade); triangle(out, a, c, d, shade);
}
export function positioned(point, x, y, z, heading) {
  const cosine = Math.cos(heading), sine = Math.sin(heading);
  return [x + point[0] * cosine - point[2] * sine, y + point[1], z + point[0] * sine + point[2] * cosine];
}
export function box(out, x, y, z, width, height, depth, shade, heading = 0) {
  const w = width / 2, d = depth / 2;
  const vertices = [[-w, 0, -d], [w, 0, -d], [w, height, -d], [-w, height, -d],
    [-w, 0, d], [w, 0, d], [w, height, d], [-w, height, d]]
    .map(p => positioned(p, x, y, z, heading));
  for (const face of [[1, 0, 3, 2], [4, 5, 6, 7], [0, 4, 7, 3], [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4]])
    quad(out, ...face.map(i => vertices[i]), shade);
}
export function roof(out, x, y, z, width, rise, depth, shade) {
  const w = width / 2, d = depth / 2;
  const [a, b, c, e, f, g] = [[-w, 0, -d], [w, 0, -d], [0, rise, -d], [-w, 0, d], [w, 0, d], [0, rise, d]]
    .map(p => [p[0] + x, p[1] + y, p[2] + z]);
  triangle(out, b, a, c, shade); triangle(out, e, f, g, shade);
  // Tile courses are part of the original slopes, not coplanar overlays.
  // This gives the roof depth up close without changing its footprint or
  // introducing flickering extra surfaces at the island overview distance.
  const rows=Math.max(3,Math.min(9,Math.round(Math.hypot(w,rise)/9)));
  for(let row=0;row<rows;row++){
    const start=row/rows,end=(row+1)/rows,seam=start+.08/rows;
    for(const [low,high,tint]of [[start,seam,.83],[seam,end,row%3===0?.96:1.03]]){
      const rowShade=shade.map(channel=>Math.min(1,channel*tint));
      for(const side of [-1,1]){
        const outer=[x+side*w*(1-low),y+rise*low],inner=[x+side*w*(1-high),y+rise*high];
        const front=[outer[0],outer[1],z-d],back=[outer[0],outer[1],z+d],
          upperFront=[inner[0],inner[1],z-d],upperBack=[inner[0],inner[1],z+d];
        if(side<0)quad(out,front,back,upperBack,upperFront,rowShade);
        else quad(out,front,upperFront,upperBack,back,rowShade);
      }
    }
  }
}
export function cone(out, x, y, z, radius, height, shade) {
  const tip = [x, y + height, z];
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7, b = (i + 1) * Math.PI * 2 / 7;
    triangle(out, [x + Math.sin(a) * radius, y, z + Math.cos(a) * radius],
      [x + Math.sin(b) * radius, y, z + Math.cos(b) * radius], tip, shade);
  }
}
