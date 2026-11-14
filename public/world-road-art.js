export {villageRoadRects} from './world-terrain.js';

// Roads are painted as a network: every verge first, every road surface last.
// Drawing a complete bordered road at a time leaves a verge across each T/X.
export function drawRoadNetwork(ctx, roads, {
  edge = '#526d3e', surface = '#cbb77b', edgeWidth = 36, width = 25,
} = {}) {
  const routes = roads.map(road => ({points:Array.isArray(road) ? road : road.points,
    width:Math.max(3,Math.min(80,Number.isFinite(road.width)?road.width:width))}))
    .filter(({points}) => Array.isArray(points) && points.length > 1 &&
      points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y)));
  if (!routes.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Width belongs to the shared road, including narrow lanes and wider town
  // entrances. Keep both passes across the whole network so different widths
  // never paint a verge over the surface at their junction.
  for(const [shade,padding] of [[edge,Math.max(0,edgeWidth-width)],['#a79263',Math.min(3,Math.max(0,edgeWidth-width))],[surface,0]]){
    ctx.strokeStyle=shade;
    for (const {points,width:roadWidth} of routes) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.lineWidth=roadWidth+padding;
      ctx.stroke();
    }
  }
  // Sparse worn earth and small stones follow the recorded centerlines. The
  // full surface is already joined, so texture cannot introduce intersection
  // borders. At continent scale it fades out instead of becoming visual noise.
  const transform=ctx.getTransform?.(),pixelRatio=ctx.canvas?.clientWidth?ctx.canvas.width/ctx.canvas.clientWidth:1,
    scale=(transform?Math.hypot(transform.a,transform.b):1)/Math.max(1,pixelRatio);
  if(scale>=.35){
    let remaining=900;
    for(const {points,width:roadWidth} of routes){
      if(roadWidth<8)continue;
      for(let i=1;i<points.length&&remaining>0;i++){
        const from=points[i-1],to=points[i],dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
        if(!length)continue;
        const nx=-dy/length,ny=dx/length;
        for(let step=11;step<length-3&&remaining-->0;step+=23){
          const seed=Math.abs(Math.imul(Math.round(from.x+dx*step/length),31)^Math.imul(Math.round(from.y+dy*step/length),17));
          const offset=((seed%13)/12-.5)*Math.max(0,roadWidth-7),x=from.x+dx*step/length+nx*offset,y=from.y+dy*step/length+ny*offset;
          ctx.fillStyle=seed%3?'#b5a16f':'#e0cc96';ctx.fillRect(Math.round(x),Math.round(y),seed%2+1,1);
          if(seed%4===0){ctx.fillStyle='#d8c58e';ctx.fillRect(Math.round(x)-2,Math.round(y)+2,4,1);}
        }
      }
    }
  }
  ctx.restore();
}

// Only the exposed perimeter gets edge highlights. Shared edges disappear into
// the intersection instead of drawing a bright/dark stripe across the road.
export function drawVillageRoadNetwork(ctx, roads, decorate = () => {}) {
  const fill = (color, pad) => {
    ctx.fillStyle = color;
    for (const road of roads) ctx.fillRect(road.x-pad, road.y-pad, road.w+pad*2, road.h+pad*2);
  };
  fill('#5d7840', 5);
  fill('#b4a774', 2);
  fill('#d0bd86', 0);
  for (const road of roads) decorate(road);
  const insideOther = (x,y,road) => roads.some(other => other !== road &&
    x >= other.x && x < other.x+other.w && y >= other.y && y < other.y+other.h);
  for (const road of roads) {
    const {x,y,w,h,vertical} = road;
    for (const side of [0,1]) {
      ctx.fillStyle = side ? '#a29163' : '#e2cc8f';
      const extent = vertical ? h : w;
      let run = -1;
      for (let offset=0; offset<=extent; offset++) {
        const px = vertical ? x+(side?w-1:0) : x+offset;
        const py = vertical ? y+offset : y+(side?h-1:0);
        const outerX = vertical ? px+(side?1:-1) : px;
        const outerY = vertical ? py : py+(side?1:-1);
        const exposed = offset<extent && !insideOther(outerX,outerY,road);
        if (exposed && run<0) run=offset;
        if (!exposed && run>=0) {
          if (vertical) ctx.fillRect(x+(side?w-2:0),y+run,2,offset-run);
          else ctx.fillRect(x+run,y+(side?h-2:0),offset-run,2);
          run=-1;
        }
      }
    }
  }
}
