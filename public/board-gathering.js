import {TOWN_ACTOR_SPACING} from './town-walk.js';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Execution and map feedback share the saved quest, even when it was started
// directly from a TODO. Visual gathering never creates a dispatch or a turn.
export function townQuestActivity(state,now=Date.now()){
  const active=state?.boardDispatch?.active,quest=state?.party?.quest;
  const stopped=active?.questId===quest?.id&&['paused','stopping'].includes(quest?.status);
  if(active?.selection?.party&&['gathering','starting','running'].includes(active.status)&&!stopped)return {...active,origin:'board',visualGathering:active.status==='gathering'};
  if(!quest?.party||!['running','stopping','paused'].includes(quest.status)){
    return active?.selection?.party&&['blocked','uncertain'].includes(active.status)&&(!active.questId||active.questId===quest?.id)?{...active,origin:'board',visualGathering:false}:null;
  }
  const linked=active?.questId===quest.id?active:null;
  const started=Number.isFinite(quest.createdAt)?quest.createdAt:null;
  return {id:linked?.id||'quest:'+quest.id,origin:linked?'board':'party',selection:{party:quest.party},questId:quest.id,todoId:quest.link?.todoId||null,status:quest.status,error:quest.error||null,gatherStartedAt:linked?.gatherStartedAt??started,gatherUntil:linked?.gatherUntil??(started===null?null:started+3200),visualGathering:!linked&&quest.status==='running'&&started!==null&&now>=started&&now<started+3200};
}

export function townQuestStopReason(error){
  if(typeof error!=='string')return '';
  if(/(?:^|: )session [A-Za-z0-9-]+ is archived\./.test(error))return '担当の会話がアーカイブ済みです。酒場で詳細を確認できます。';
  return error;
}

// Positions are normalized when a dispatch is first seen. View changes and
// resizes use the backend timestamps rather than starting another animation.
export function createBoardGathering({ids,starts=[],width,height,gatherStartedAt,gatherUntil}){
  const start=Number.isFinite(gatherStartedAt)?gatherStartedAt:Date.now();
  const duration=Math.max(1,(Number.isFinite(gatherUntil)?gatherUntil:start+3200)-start);
  const origins=ids.map((id,index)=>{
    const point=starts.find(point=>point.id===id)||starts.at(-1)||{x:width*(.38+index*.06),y:height*.5};
    return {id,x:width>0?point.x/width:.5,y:height>0?point.y/height:.5};
  });
  return {
    positions({now=Date.now(),width,height,instant=false}){
      const margin=Math.min(20,width/2,height/2),bounded=(value,size)=>clamp(value,margin,size-margin);
      const gap=Math.min(TOWN_ACTOR_SPACING,Math.max(0,(width-2*margin)/Math.max(1,ids.length-1)));
      return origins.map((origin,index)=>{
        const delay=Math.min(duration*.25,index*140),progress=instant?1:clamp((now-start-delay)/(duration-delay),0,1);
        const target={x:bounded(width*.5+(index-(ids.length-1)/2)*gap,width),y:bounded(height*.8-Math.min(64,height*.25),height)};
        const from={x:bounded(origin.x*width,width),y:bounded(origin.y*height,height)},dx=target.x-from.x,dy=target.y-from.y;
        return {id:origin.id,x:from.x+dx*progress,y:from.y+dy*progress,progress,moving:progress>0&&progress<1&&Math.hypot(dx,dy)>.5,direction:Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down')};
      });
    }
  };
}

export function boardRoleState(active,quest,conversationId){
  if(!active)return '';
  if(active.status==='gathering')return 'gathering';
  if(!active.questId&&['blocked','uncertain'].includes(active.status))return active.status==='blocked'?'blocked':'interrupted';
  if(!active.questId||active.questId!==quest?.id)return 'waiting';
  const step=quest.steps?.find(step=>step.conversationId===conversationId);
  return step?.status||'waiting';
}
