const EPSILON=0.0001;
export const TOWN_ACTOR_SPACING=32;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const memberIds=ids=>[...new Set((Array.isArray(ids)?ids:[]).filter(id=>typeof id==='string'&&id.length))];

// The route belongs to the leader. Followers sample that same route at fixed
// distances behind it, so a turn is passed down the line rather than cut across.
export function createPartyTrail({ids=[],width=0,height=0,spacing=TOWN_ACTOR_SPACING,speed=140,margin=0}={}){
  let members=memberIds(ids),fieldWidth=Math.max(0,finite(width,0)),fieldHeight=Math.max(0,finite(height,0));
  const gap=Math.max(1,finite(spacing,TOWN_ACTOR_SPACING)),pace=Math.max(1,finite(speed,140)),inset=Math.max(0,finite(margin,0));
  let route=[],actors=[],destination=null,walking=false,formationGap=gap;

  function bounds(){
    const x=Math.min(inset,fieldWidth/2),y=Math.min(inset,fieldHeight/2);
    return {left:x,right:fieldWidth-x,top:y,bottom:fieldHeight-y};
  }
  function bounded(point){
    const area=bounds(),head=route.at(-1)||{x:fieldWidth/2,y:fieldHeight/2};
    return {x:clamp(finite(point?.x,head.x),area.left,area.right),y:clamp(finite(point?.y,head.y),area.top,area.bottom)};
  }
  function snapshot(){return actors.map(actor=>({...actor}));}
  function sample(at){
    if(at<=route[0].d)return {...route[0]};
    if(at>=route.at(-1).d)return {...route.at(-1)};
    let low=0,high=route.length-1;
    while(high-low>1){const middle=(low+high)>>1;if(route[middle].d<at)low=middle;else high=middle;}
    const a=route[low],b=route[high],part=(at-a.d)/(b.d-a.d);
    return {x:a.x+(b.x-a.x)*part,y:a.y+(b.y-a.y)*part,d:at};
  }
  function updateActors(previous=actors){
    const old=new Map(previous.map(actor=>[actor.id,actor])),head=route.at(-1);
    actors=members.map((id,index)=>{
      const point=sample(head.d-index*formationGap),before=old.get(id),dx=before?point.x-before.x:0,dy=before?point.y-before.y:0;
      const changed=Math.hypot(dx,dy)>EPSILON;
      const direction=changed?(Math.abs(dx)>=Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down')):before?.direction||'right';
      return {id,x:point.x,y:point.y,direction,angle:changed?Math.atan2(dy,dx):before?.angle||0,moving:walking&&changed};
    });
  }
  function formation(preferred){
    const area=bounds(),span=Math.min(Math.max(0,members.length-1)*gap,area.right-area.left);
    formationGap=members.length>1?span/(members.length-1):gap;
    const point=bounded(preferred||{x:fieldWidth/2+span/2,y:fieldHeight/2});
    const x=clamp(point.x,area.left+span,area.right),y=point.y;
    route=[{x:area.left,y,d:0}];
    if(x-area.left>EPSILON)route.push({x,y,d:x-area.left});
    destination={x,y};walking=false;updateActors();
  }
  function trimRoute(){
    // Retain some spare history when more members join. Straight travel merges
    // into one segment; trimming bounds storage after long wandering sessions.
    const keep=Math.max(gap*(members.length+2),2048),start=route.at(-1).d-keep;
    if(route.length<3)return;
    if(start>route[0].d){
      const first=sample(start);
      let cut=0;while(cut+1<route.length&&route[cut+1].d<=start)cut++;
      route=[first,...route.slice(cut+1)];
    }
    // Tiny repeated pointer redirects can add many points without much travel.
    // Thin only old samples; retain their traveled distances and recent turns.
    if(route.length>4096)route=route.filter((_,index)=>index===0||index>=route.length-64||index%2===0);
  }
  function append(point){
    const head=route.at(-1),length=distance(head,point);
    if(length<=EPSILON)return;
    const next={x:point.x,y:point.y,d:head.d+length},before=route.at(-2);
    if(before){
      const ax=head.x-before.x,ay=head.y-before.y,bx=next.x-head.x,by=next.y-head.y;
      if(Math.abs(ax*by-ay*bx)<=EPSILON*Math.max(1,Math.hypot(ax,ay)*length)&&ax*bx+ay*by>0)route[route.length-1]=next;
      else route.push(next);
    }else route.push(next);
    trimRoute();
  }
  formation();

  return {
    get positions(){return snapshot();},
    get moving(){return walking;},
    get destination(){return {...destination};},
    get bounds(){return {...bounds()};},
    setMembers(ids){
      const next=memberIds(ids);
      if(next.length===members.length&&next.every((id,index)=>id===members[index]))return snapshot();
      const wasEmpty=!members.length,head={...route.at(-1)};
      members=next;
      const area=bounds();formationGap=members.length>1?Math.min(gap,(area.right-area.left)/(members.length-1)):gap;
      if(wasEmpty||(members.length-1)*formationGap>route.at(-1).d-route[0].d+EPSILON)formation(head);
      else {if(!members.length){walking=false;destination={x:head.x,y:head.y};}updateActors();}
      return snapshot();
    },
    resize(width,height){
      const previousBounds=bounds();
      fieldWidth=Math.max(0,finite(width,fieldWidth));fieldHeight=Math.max(0,finite(height,fieldHeight));
      const area=bounds(),scale=point=>({
        x:area.left+(previousBounds.right>previousBounds.left?(point.x-previousBounds.left)/(previousBounds.right-previousBounds.left):0.5)*(area.right-area.left),
        y:area.top+(previousBounds.bottom>previousBounds.top?(point.y-previousBounds.top)/(previousBounds.bottom-previousBounds.top):0.5)*(area.bottom-area.top)
      });
      destination=bounded(scale(destination));
      let length=0;const resized=[];
      for(const point of route){const next=bounded(scale(point));if(resized.length)length+=distance(resized.at(-1),next);if(!resized.length||length-resized.at(-1).d>EPSILON)resized.push({...next,d:length});}
      route=resized;formationGap=members.length>1?Math.min(gap,(area.right-area.left)/(members.length-1)):gap;
      if((members.length-1)*formationGap>length+EPSILON)formation(route.at(-1));
      else {walking=members.length>0&&distance(route.at(-1),destination)>EPSILON;updateActors();}
      return snapshot();
    },
    moveTo(point,{instant=false}={}){
      destination=bounded(point);walking=members.length>0&&distance(route.at(-1),destination)>EPSILON;
      if(instant&&walking){append(destination);walking=false;updateActors();}
      else if(!walking)updateActors();
      return snapshot();
    },
    step(seconds){
      const elapsed=clamp(finite(seconds,0),0,0.25);
      if(!walking||elapsed===0){if(!walking)updateActors();return snapshot();}
      const head=route.at(-1),remaining=distance(head,destination),travel=Math.min(remaining,pace*elapsed),part=travel/remaining;
      append({x:head.x+(destination.x-head.x)*part,y:head.y+(destination.y-head.y)*part});
      walking=remaining-travel>EPSILON;updateActors();
      return snapshot();
    }
  };
}
