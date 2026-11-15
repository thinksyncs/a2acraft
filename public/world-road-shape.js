const MAX_POINTS=256;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const hash=value=>{let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);
 n=Math.imul(n^(n>>>16),0x85ebca6b);n=Math.imul(n^(n>>>13),0xc2b2ae35);return (n^(n>>>16))>>>0;};
const fade=t=>t*t*t*(t*(t*6-15)+10);
const noise=(position,seed)=>{
 const cell=Math.floor(position),t=fade(position-cell);
 const a=hash(seed+':'+cell)/0xffffffff*2-1,b=hash(seed+':'+(cell+1))/0xffffffff*2-1;
 return a+(b-a)*t;
};

/** Add gentle deterministic bends without moving a route's original vertices.
 * isSafe checks the entire candidate, including its segments/road clearance.
 * If all shaped candidates fail, retain the original route; callers must supply
 * an already valid base route. Large input paths are retained without growth.
 */
export function meanderRoad(points,{seed='',amplitude=24,step=64,isSafe}={}) {
 if(!Array.isArray(points)||!points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)))return [];
 const original=points.map(p=>({x:p.x,y:p.y}));
 if(original.length<2||original.length>=MAX_POINTS)return original;
 const amount=clamp(Number.isFinite(amplitude)?amplitude:24,0,64);
 if(!amount)return original;
 const spacing=clamp(Number.isFinite(step)?step:64,12,256);
 // Canonical orientation gives one street when callers reverse a journey.
 const first=original[0],last=original.at(-1),reversed=first.x>last.x||first.x===last.x&&first.y>last.y;
 const source=reversed?[...original].reverse():original;
 const segments=source.slice(1).map((to,i)=>{
  const from=source[i],dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  return {from,to,dx,dy,length,extra:Math.max(0,Math.ceil(length/spacing)-1)};
 });
 const desired=segments.reduce((sum,s)=>sum+s.extra,0),budget=MAX_POINTS-source.length;
 if(desired>budget){
  let remaining=budget;
  for(const segment of segments){
   const share=segment.extra*budget/desired;
   segment.extra=Math.floor(share);segment.remainder=share-segment.extra;remaining-=segment.extra;
  }
  for(const segment of [...segments].sort((a,b)=>b.remainder-a.remainder).slice(0,remaining))segment.extra++;
 }
 const build=factor=>{
  const result=[{...source[0]}];
  segments.forEach((segment,index)=>{
   const {from,to,dx,dy,length}=segment,pieces=segment.extra+1;
   const height=Math.min(amount,length*.06)*factor,wavelength=Math.max(180,spacing*4,height*24);
   const key=String(seed)+':'+index,phase=hash(key+':phase')/0xffffffff*10;
   for(let part=1;part<pieces;part++){
    const t=part/pieces,envelope=Math.sin(Math.PI*t)**2;
    const offset=height*envelope*noise(length*t/wavelength+phase,key);
    result.push({x:from.x+dx*t-dy/length*offset,y:from.y+dy*t+dx/length*offset});
   }
   result.push({...to});
  });
  return reversed?result.reverse():result;
 };
 for(const factor of [1,.5,.25,.125,.0625]){
  const candidate=build(factor);
  if(typeof isSafe!=='function'||isSafe(candidate))return candidate;
 }
 return original;
}
