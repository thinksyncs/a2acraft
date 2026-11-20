import {coastLoops} from './world-coast.js';
// Both map scales draw the same coast. Zoom changes the view, not the island.
function coastPath(ctx, island) {
  const coast = island?.coast || [];
  if (coast.length < 3) return false;
  ctx.beginPath();
  for(const ring of coastLoops(island)){
    ctx.moveTo(ring[0].x,ring[0].y);
    for(let i=1;i<ring.length;i++)ctx.lineTo(ring[i].x,ring[i].y);
    ctx.closePath();
  }
  return true;
}

export function drawIslandWater(ctx, island, {left, right, top, bottom, zoom = 1}) {
  ctx.fillStyle = island?.seaColor || '#376977';
  ctx.fillRect(left, top, right - left, bottom - top);
  // A viewport-sized, bounded grid keeps a distant ocean cheap to draw.
  const step = Math.max(180, Math.ceil(48 / zoom / 180) * 180);
  ctx.save();
  ctx.strokeStyle = '#8bc3c145';
  ctx.lineWidth = Math.max(1, 1 / zoom);
  for (let y = Math.floor(top / step) * step; y < bottom; y += step) {
    for (let x = Math.floor(left / step) * step; x < right; x += step) {
      const offset = ((Math.imul(Math.trunc(x / step), 31) ^ Math.trunc(y / step)) >>> 0) % 37;
      ctx.beginPath();
      ctx.moveTo(x + offset, y + step * .35);
      ctx.lineTo(x + offset + step * .15, y + step * .35);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (coastPath(ctx, island)) {
    ctx.fillStyle = island.landColor || '#6e8a48';
    ctx.fill();
  }
}

// Call between save/restore, so roads, people and scenery stay on this land.
export function clipIslandLand(ctx, island) {
  if (coastPath(ctx, island)) ctx.clip();
}

export function drawIslandCoast(ctx, island) {
  if (!coastPath(ctx, island)) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = '#8bc3bb';
  ctx.lineWidth = 25;
  ctx.stroke();
  ctx.strokeStyle = island.sandColor || '#cfbe84';
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.restore();
}
