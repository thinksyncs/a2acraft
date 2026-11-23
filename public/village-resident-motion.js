import {worldText} from './i18n-world.js';
import {islandRouteWalkable} from './world-island-travel.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const point=p=>({x:p.x,y:p.y});
const hash=value=>{let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const expand=r=>({left:r.left-7,right:r.right+7,top:r.top-7,bottom:r.bottom+7});
const heading=(a,b)=>Math.abs(b.x-a.x)>Math.abs(b.y-a.y)?b.x>a.x?'right':'left':b.y>a.y?'down':'up';

/** Plan once per terrain/layout change. Per-frame sampling never searches paths. */
export function buildResidentPatrols({homes=new Map(),residents=[],island,obstacles=[],water=[],bridges=[]}={}) {
  const people=new Map(residents.map(resident=>[resident.conversationId,resident]));
  const patrols=new Map();
  for(const [id,home] of homes){
    if(!finite(home))continue;
    const seed=hash(id+':'+(people.get(id)?.seed||0));
    let random=seed||1;
    const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return (random>>>0)/4294967296;};
    const solids=obstacles.filter(r=>r.right>=home.x-120&&r.left<=home.x+120&&r.bottom>=home.y-120&&r.top<=home.y+120).map(expand);
    const terrain={obstacles:solids,water,bridges};
    const safe=points=>islandRouteWalkable(points,island,terrain);
    const stops=[],angle=next()*Math.PI*2,clockwise=next()<.5?1:-1;
    // A resident explores the usable space around their own home. The loop
    // stays local and cannot use a global detour through another neighborhood.
    for(let index=0;index<12&&stops.length<6;index++){
      const turn=angle+clockwise*index*Math.PI/6,radius=62+next()*48;
      const target={x:home.x+Math.cos(turn)*radius,y:home.y+Math.sin(turn)*radius};
      if(safe([home,target]))stops.push(target);
    }
    const points=[point(home)];
    for(const stop of stops){
      if(!safe([points.at(-1),stop]))points.push(point(home));
      points.push(stop);
    }
    if(points.length>1)points.push(point(home));
    // A narrow shore or courtyard may not admit the wider route. Retain a
    // smaller verified walk rather than crossing the water or a building.
    if(points.length===1&&home.patrol?.length&&safe([...home.patrol,home.patrol[0]])){
      points.splice(0,1,...home.patrol.map(point),point(home.patrol[0]));
    }
    const speed=22+seed%11,legs=[];
    for(let index=1;index<points.length;index++){
      const from=points[index-1],to=points[index],length=distance(from,to);
      if(length<.01)continue;
      legs.push({from,to,seconds:length/speed,direction:heading(from,to),walking:true});
      if(index%2===0)legs.push({from:to,to,seconds:.65+next()*.85,direction:heading(from,to),walking:false});
    }
    const duration=legs.reduce((total,leg)=>total+leg.seconds,0);
    patrols.set(id,{home:point(home),points,legs,duration,phase:next()*duration,speed});
  }
  return patrols;
}

/** `elapsedMs` is the visible animation clock minus that resident's held time. */
export function residentPatrolPosition(patrol,elapsedMs,{motion=true}={}) {
  if(!patrol?.legs.length||!patrol.duration)return {...(patrol?.home||{x:490,y:430}),walking:false,direction:'down',motionLabel:worldText('ひと休み')};
  const seconds=Math.max(0,Number(elapsedMs)||0)/1000;
  let time=(seconds+patrol.phase)%patrol.duration;
  for(const leg of patrol.legs){
    if(time<leg.seconds){
      const ratio=leg.walking?time/leg.seconds:0,walking=leg.walking&&motion;
      return {x:leg.from.x+(leg.to.x-leg.from.x)*ratio,y:leg.from.y+(leg.to.y-leg.from.y)*ratio,
        direction:leg.direction,walking,motionLabel:walking?worldText('近所を散策中'):worldText('ひと休み')};
    }
    time-=leg.seconds;
  }
  return {...patrol.home,walking:false,direction:'down',motionLabel:worldText('ひと休み')};
}
