import {ROAD_SURFACE,ROAD_WEAR,ROAD_EARTH,ROAD_VERGE,ROAD_FEATHER,ROAD_GRAVEL} from './road-material.js';
export {villageRoadRects} from './world-terrain.js';

const seedAt=(x,y)=>Math.abs(Math.imul(Math.round(x*3),31)^Math.imul(Math.round(y*3),17));
const edgeWave=(x,y)=>.58+.22*Math.sin(x*.043+y*.037)+.2*Math.cos(x*.079-y*.029);
const sampleCache=new WeakMap(),outlineCache=new WeakMap();
function canvasViewport(ctx,transform){
  const width=ctx.canvas?.width,height=ctx.canvas?.height;
  if(!(width>0&&height>0)||!transform||!['a','b','c','d','e','f'].every(key=>Number.isFinite(transform[key])))return null;
  const {a,b,c,d,e,f}=transform,determinant=a*d-b*c;if(Math.abs(determinant)<1e-12)return null;
  const points=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>({
    x:(d*(x-e)-c*(y-f))/determinant,y:(a*(y-f)-b*(x-e))/determinant}));
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
    top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}
function intersectsView(points,view,padding){
  if(!view)return true;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const point of points){left=Math.min(left,point.x);right=Math.max(right,point.x);top=Math.min(top,point.y);bottom=Math.max(bottom,point.y);}
  return right+padding>=view.left&&left-padding<=view.right&&bottom+padding>=view.top&&top-padding<=view.bottom;
}

// Subdivision only describes a cosmetic shoulder. The recorded centerline and
// its nominal width remain the continuous walking surface in both projections.
function shoulderSamples(points,width){
  const key=width+':'+points.map(point=>point.x+','+point.y).join(';'),cached=sampleCache.get(points);
  if(cached?.key===key)return cached.samples;
  const lengths=points.slice(1).map((point,i)=>Math.hypot(point.x-points[i].x,point.y-points[i].y));
  const spacing=Math.max(18,width*1.2,lengths.reduce((a,b)=>a+b,0)/320),sampled=[{...points[0]}];
  for(let i=1;i<points.length;i++){
    const from=points[i-1],to=points[i],length=lengths[i-1];
    if(length<.001)continue;
    const count=Math.ceil(length/spacing);
    for(let step=1;step<=count;step++)sampled.push({x:from.x+(to.x-from.x)*step/count,y:from.y+(to.y-from.y)*step/count});
  }
  const samples=sampled.map((point,i)=>{
    const before=sampled[Math.max(0,i-1)],after=sampled[Math.min(sampled.length-1,i+1)];
    const a=Math.hypot(point.x-before.x,point.y-before.y),b=Math.hypot(after.x-point.x,after.y-point.y);
    const nx=(a?-(point.y-before.y)/a:0)+(b?-(after.y-point.y)/b:0);
    const ny=(a?(point.x-before.x)/a:0)+(b?(after.x-point.x)/b:0),norm=Math.hypot(nx,ny)||1;
    const nextNormal=b?{x:-(after.y-point.y)/b,y:(after.x-point.x)/b}:{x:nx/norm,y:ny/norm};
    const miter=Math.min(1.4,1/Math.max(.1,nx/norm*nextNormal.x+ny/norm*nextNormal.y));
    return {...point,nx:nx/norm,ny:ny/norm,miter,wave:edgeWave(point.x,point.y)};
  });
  sampleCache.set(points,{key,samples});return samples;
}
function shoulder(ctx,route,padding){
  const {samples,width,rounded}=route;if(samples.length<2)return;
  let shapes=outlineCache.get(samples);if(!shapes){shapes=new Map();outlineCache.set(samples,shapes);}
  const key=padding+':'+rounded;let outline=shapes.get(key);
  if(!outline){
  const radius=point=>width/2+padding*point.wave;
  const left=samples.map(point=>({x:point.x+point.nx*radius(point)*point.miter,y:point.y+point.ny*radius(point)*point.miter}));
  const right=samples.map(point=>({x:point.x-point.nx*radius(point)*point.miter,y:point.y-point.ny*radius(point)*point.miter}));
  outline=[...left];const end=samples.at(-1),start=samples[0];
  if(rounded)for(let i=1;i<8;i++){
    const angle=Math.atan2(end.ny,end.nx)-Math.PI*i/8;
    outline.push({x:end.x+Math.cos(angle)*radius(end),y:end.y+Math.sin(angle)*radius(end)});
  }
  outline.push(...right.reverse());
  if(rounded)for(let i=1;i<8;i++){
    const angle=Math.atan2(-start.ny,-start.nx)-Math.PI*i/8;
    outline.push({x:start.x+Math.cos(angle)*radius(start),y:start.y+Math.sin(angle)*radius(start)});
  }
  shapes.set(key,outline);
  }
  ctx.beginPath();ctx.moveTo(outline[0].x,outline[0].y);
  for(const point of outline.slice(1))ctx.lineTo(point.x,point.y);
  ctx.closePath();ctx.fill();
}
function surfacePath(ctx,route){
  ctx.beginPath();ctx.moveTo(route.points[0].x,route.points[0].y);
  for(const point of route.points.slice(1))ctx.lineTo(point.x,point.y);
  ctx.lineCap=route.rounded?'round':'butt';ctx.lineWidth=route.width;ctx.stroke();
}

// Paint every shoulder before every surface. At crossings the joined earth
// covers the grass transition, so no verge or outline cuts through the junction.
export function drawRoadNetwork(ctx,roads,{edge=ROAD_VERGE,surface=ROAD_SURFACE,edgeWidth=36,width=25}={}){
  const transform=ctx.getTransform?.(),pixelRatio=ctx.canvas?.clientWidth?ctx.canvas.width/ctx.canvas.clientWidth:1;
  const scale=(transform?Math.hypot(transform.a,transform.b):1)/Math.max(1,pixelRatio);
  const view=canvasViewport(ctx,transform),fringe=Math.max(0,Math.min(6,(edgeWidth-width)/2));
  const routes=roads.map(road=>({points:Array.isArray(road)?road:road.points,
    width:Math.max(3,Math.min(80,Number.isFinite(road.width)?road.width:width)),rounded:road.rounded!==false}))
    .filter(({points})=>Array.isArray(points)&&points.length>1&&points.every(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)))
    // Include the full shoulder/miter beyond the centerline at the viewport edge.
    .filter(route=>intersectsView(route.points,view,(route.width/2+fringe)*1.5+2))
    .map(route=>({...route,samples:scale>=.3?shoulderSamples(route.points,route.width):[]}));
  if(!routes.length)return;
  ctx.save();ctx.lineJoin='round';
  for(const [shade,padding]of [[ROAD_FEATHER,fringe],[edge,fringe*.62],[surface,Math.min(.85,fringe*.2)]]){
    ctx.fillStyle=shade;ctx.strokeStyle=shade;
    for(const route of routes){if(scale>=.3)shoulder(ctx,route,padding);else surfacePath(ctx,{...route,width:route.width+padding*1.1});}
  }
  ctx.strokeStyle=surface;for(const route of routes)surfacePath(ctx,route);
  // Wear is made of irregular patches, never a second continuous center stripe.
  // Tiny stones disappear at atlas scale; the budget bounds close-view work.
  if(scale>=.3){
    let remaining=700;const opacity=Number.isFinite(ctx.globalAlpha)?ctx.globalAlpha:1;
    for(const route of routes){
      if(route.width<7)continue;
      for(let i=1;i<route.samples.length&&remaining>0;i++){
        const a=route.samples[i-1],b=route.samples[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
        if(length<3||!intersectsView([a,b],view,route.width/2+fringe+4))continue;
        remaining--;
        const x=(a.x+b.x)/2,y=(a.y+b.y)/2,seed=seedAt(x,y),nx=-dy/length,ny=dx/length;
        const offset=((seed%19)/18-.5)*route.width*.56,cx=x+nx*offset,cy=y+ny*offset;
        if(seed%5<3){
          const along=Math.min(length*.22,2.5+seed%4),across=Math.min(route.width*.19,1.8+(seed>>>4)%4*.55),ux=dx/length,uy=dy/length;
          ctx.fillStyle=seed%3?ROAD_WEAR:ROAD_EARTH;ctx.globalAlpha=opacity*.3;
          ctx.beginPath();ctx.moveTo(cx-ux*along,cy-uy*along);
          ctx.lineTo(cx-ux*along*.45+nx*across*.8,cy-uy*along*.45+ny*across*.8);
          ctx.lineTo(cx+ux*along*.35+nx*across,cy+uy*along*.35+ny*across);
          ctx.lineTo(cx+ux*along,cy+uy*along);
          ctx.lineTo(cx+ux*along*.5-nx*across*.65,cy+uy*along*.5-ny*across*.65);
          ctx.lineTo(cx-ux*along*.4-nx*across,cy-uy*along*.4-ny*across);
          ctx.closePath();ctx.fill();ctx.globalAlpha=opacity;
        }
        if(scale>=.65&&seed%3===0){
          ctx.fillStyle=ROAD_GRAVEL[seed%2];ctx.fillRect(cx+nx*route.width*.14,cy+ny*route.width*.14,1.3+(seed%3)*.4,.9);
          if(seed%4===0)ctx.fillRect(cx+3,cy-2,.9,1.3);
        }
      }
    }
  }
  ctx.restore();
}

// Older village lanes are rectangles. Their original square ends must stop at
// the riverbank rather than adding a rounded dirt cap over the timber bridge.
export function drawVillageRoadNetwork(ctx,roads,decorate=()=>{}){
  const routes=roads.map(road=>({rounded:false,width:road.vertical?road.w:road.h,points:road.vertical?
    [{x:road.x+road.w/2,y:road.y},{x:road.x+road.w/2,y:road.y+road.h}]:
    [{x:road.x,y:road.y+road.h/2},{x:road.x+road.w,y:road.y+road.h/2}]}));
  drawRoadNetwork(ctx,routes,{edgeWidth:35,width:25});for(const road of roads)decorate(road);
}
