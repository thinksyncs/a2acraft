// Survey cells reserve dry ground for a biome. Only the paint blends across
// their shared edges; roads, rivers and settlement placement use the survey.
const fields = new WeakMap();
const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const ease = t => t * t * (3 - 2 * t);

export function biomeColorField(biomes) {
  if (!biomes?.ground?.length || !(biomes.step > 0)) return null;
  if (fields.has(biomes)) return fields.get(biomes);
  const {step} = biomes;
  const grass = rgb(biomes.landColor || '#78924f');
  const patches = biomes.ground;
  const left = Math.round(Math.min(...patches.map(p => p.x)) / step);
  const top = Math.round(Math.min(...patches.map(p => p.y)) / step);
  const width = Math.round(Math.max(...patches.map(p => p.x + p.width)) / step) - left;
  const height = Math.round(Math.max(...patches.map(p => p.y + p.depth)) / step) - top;
  // The generator fits its survey into 48 cells along the longer axis.
  if (width <= 0 || height <= 0 || width > 64 || height > 64) return null;
  const cells = new Array(width * height);
  const key = (x, y) => (y - top) * width + x - left;
  const cell = (x, y) => x >= left && x < left + width && y >= top && y < top + height ? cells[key(x,y)] : null;
  for (const p of patches) {
    const shade = rgb(p.color);
    for (let y = Math.round(p.y / step); y < Math.round((p.y+p.depth) / step); y++)
      for (let x = Math.round(p.x / step); x < Math.round((p.x+p.width) / step); x++) cells[key(x,y)] = shade;
  }
  // At half-cell intervals, an uncovered neighbour contributes plain grass
  // at the outer rim. Adjacent woods and mountains instead share a saddle.
  const knots = new Map();
  function knot(i, j) {
    const id = (j - 2*top) * (2*width + 1) + i - 2*left;
    if (knots.has(id)) return knots.get(id);
    const colors = [];
    for (let y = Math.ceil(j/2)-1; y <= Math.floor(j/2); y++)
      for (let x = Math.ceil(i/2)-1; x <= Math.floor(i/2); x++) colors.push(cell(x,y));
    let value = grass;
    if (colors.every(Boolean)) {
      // A woodland's fringe and a scree slope occupy several survey cells.
      // Blend the density of the surrounding terrain as well as its palette:
      // a staircase of occupied cells then reads as one rounded hillside.
      const cx = i / 2, cy = j / 2;
      const sum = [0, 0, 0];
      let occupied = 0, total = 0;
      for (let y = Math.floor(cy)-2; y <= Math.floor(cy)+2; y++) {
        for (let x = Math.floor(cx)-2; x <= Math.floor(cx)+2; x++) {
          const d2 = (x+.5-cx)**2 + (y+.5-cy)**2;
          const weight = Math.max(0, 1-d2/4)**2;
          total += weight;
          const shade = cell(x,y);
          if (!shade || !weight) continue;
          occupied += weight;
          for (let k=0; k<3; k++) sum[k] += shade[k]*weight;
        }
      }
      const coverage = occupied / total;
      const blend = ease(Math.max(0, Math.min(1, (coverage-.16)/.77)));
      const local = colors[0].map((_, k) => colors.reduce((s, c) => s+c[k], 0)/colors.length);
      const shade = mix(sum.map(channel => channel/occupied), local, .30);
      value = mix(grass, shade, blend);
    }
    knots.set(id, value);
    return value;
  }
  function sample(x, y) {
    const gx = x / step, gy = y / step;
    // Warp inside each cell. The displacement vanishes on its corresponding
    // boundary so neighbouring tiles meet, including on the negative axes.
    const u = gx + .14 * Math.sin(Math.PI * (gx - Math.floor(gx))) * Math.sin(2.3*gy + .8*gx);
    const v = gy + .15 * Math.sin(Math.PI * (gy - Math.floor(gy))) * Math.cos(1.7*gx - 1.1*gy);
    const i = Math.min(2*(left+width)-1, Math.floor(2*u));
    const j = Math.min(2*(top+height)-1, Math.floor(2*v));
    const tx = ease(2*u-i), ty = ease(2*v-j);
    return mix(mix(knot(i,j), knot(i+1,j), tx), mix(knot(i,j+1), knot(i+1,j+1), tx), ty);
  }
  const field = {step, left, top, width, height, cell, sample};
  fields.set(biomes, field);
  return field;
}
