import {townQuestActivity,townQuestStopReason} from './board-gathering.js';

const WAGON='__town_wagon__',ROAD_Y=.51,HANDOFF_MS=550,REPORT_MS=3200,ASSEMBLE_MS=850;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const point=value=>({x:clamp(finite(value?.x,.5),.04,.96),y:clamp(finite(value?.y,ROAD_Y),.06,.94)});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const copy=value=>value===undefined?undefined:structuredClone(value);

// All sites sit on the plaza or the approaches to existing buildings. The
// routes below stay south of the pond and outside the rooms.
export const TOWN_WORKSITES=Object.freeze({
  research:Object.freeze({x:.37,y:.56,label:'書見台',icon:'book'}),
  craft:Object.freeze({x:.25,y:.48,label:'作業台',icon:'quill'}),
  review:Object.freeze({x:.68,y:.53,label:'相談机',icon:'scroll'}),
  shared:Object.freeze({x:.5,y:.51,label:'まとめの机',icon:'scroll'}),
  board:Object.freeze({x:.5,y:.73,label:'掲示板',icon:'scroll'}),
  castle:Object.freeze({x:.8,y:.44,label:'報告',icon:'report'})
});

export function roleWorkplace(role=''){
  if(/確認|検証|審査|監査|レビュー|review|check|test|audit/i.test(role))return 'review';
  if(/調査|研究|分析|読解|知識|research|investigat|analys|read/i.test(role))return 'research';
  if(/作成|実装|執筆|制作|設計|開発|整理|write|writ|build|creat|develop|implement|design/i.test(role))return 'craft';
  return 'shared';
}

// Presentation order never changes the order saved in the quest. When a
// reserve member takes a turn, one waiting member takes their place in the wagon.
export function activityFormation(party,activeId=null,handoffFromId=null){
  const members=party?.members||[],leader=members.find(member=>member.conversationId===party?.leaderId);
  const ordered=leader?[leader,...members.filter(member=>member!==leader)]:[...members];
  const priority=[leader?.conversationId,activeId,handoffFromId].filter(Boolean);
  const visible=ordered.slice(0,4);
  for(const id of priority){
    const member=ordered.find(member=>member.conversationId===id);
    if(!member||visible.includes(member))continue;
    const replace=visible.findLastIndex(item=>!priority.includes(item.conversationId));
    if(replace>=0)visible[replace]=member;
  }
  const reserve=ordered.filter(member=>!visible.includes(member));
  return {visible,reserve,ids:[...visible.map(member=>member.conversationId),...(reserve.length?[WAGON]:[])]};
}

// Automatic destinations stay on this short street network. A caller's manual
// starting point may be off-road; its first segment returns to the street.
// No diagonal cuts from the board through the pond or a room are introduced.
export function townRoadRoute(from,to){
  const a=point(from),b=point(to),route=[a];
  const add=p=>{if(distance(route.at(-1),p)>.00001)route.push(p);};
  if(a.y>.62){add({x:.5,y:a.y});add({x:.5,y:ROAD_Y});}
  else add({x:a.x,y:ROAD_Y});
  if(b.y>.62){add({x:.5,y:ROAD_Y});add({x:.5,y:b.y});}
  else add({x:b.x,y:ROAD_Y});
  add(b);return route;
}

function routeLength(route){return route.slice(1).reduce((total,p,index)=>total+distance(route[index],p),0);}
function sampleRoute(route,at){
  let remaining=Math.max(0,at),before=route[0];
  for(const next of route.slice(1)){
    const length=distance(before,next);
    if(remaining<=length&&length>0){const fraction=remaining/length;return {x:before.x+(next.x-before.x)*fraction,y:before.y+(next.y-before.y)*fraction,direction:Math.abs(next.x-before.x)>=Math.abs(next.y-before.y)?(next.x<before.x?'left':'right'):(next.y<before.y?'up':'down')};}
    remaining-=length;before=next;
  }
  const last=route.at(-1),previous=route.at(-2)||last;
  return {...last,direction:Math.abs(last.x-previous.x)>=Math.abs(last.y-previous.y)?(last.x<previous.x?'left':'right'):(last.y<previous.y?'up':'down')};
}
const defaultPoint=index=>({x:.35+index*.065,y:ROAD_Y});
const waitingPoint=(index,total)=>({x:.5+(index-(total-1)/2)*.05,y:.64});
const processionRoute=[{x:.2,y:ROAD_Y},{x:.8,y:ROAD_Y},{x:.8,y:.44}];
function processionPoint(index,progress){return sampleRoute(processionRoute,.3+progress*.37-index*.06);}

function deriveScene(state,now){
  const activity=townQuestActivity(state,now),quest=state?.party?.quest;
  if(!activity&&quest?.status!=='completed')return null;
  const matched=Boolean(quest?.party&&(!activity||activity.questId===quest.id));
  const steps=matched?copy(quest.steps||[]):[],running=steps.find(step=>step.status==='running');
  const failed=steps.find(step=>['failed','blocked','interrupted'].includes(step.status));
  const next=steps.find(step=>step.status!=='completed');
  const party=copy(matched?quest.party:activity.selection.party),status=matched?quest.status:activity.status;
  const todoId=matched?quest.link?.todoId||activity?.todoId:activity?.todoId;
  const runId=matched?quest.link?.runId||null:null;
  const todo=state?.todos?.items?.find(item=>item.id===todoId);
  const key=matched?'quest:'+quest.id+':'+(runId||''):'board:'+activity.id;
  let phase='working';
  if(status==='gathering'||status==='starting')phase='gathering';
  else if(status==='completed')phase='reported';
  else if(status==='paused')phase='paused';
  else if(status==='stopping')phase='stopping';
  else if(['blocked','uncertain'].includes(status))phase='blocked';
  else if(running?.kind==='summary')phase='summary';
  const disconnected=state?.connected===false&&['running','stopping','gathering','starting'].includes(status);
  if(disconnected)phase='paused';
  const report=status==='completed'&&steps.length&&steps.every(step=>step.status==='completed'&&typeof step.output==='string'&&step.output.trim())?{
    questId:quest.id,todoId:todoId||null,runId,title:todo?.title||activity?.title||'',request:todo?.source?.request||todo?.description||todo?.title||quest.text||'',
    output:steps.find(step=>step.kind==='summary')?.output||steps.at(-1)?.output||'',
    completedAt:quest.completedAt||null,source:copy(todo?.source||null)
  }:null;
  if(status==='completed'&&!report)phase='blocked';
  return {key,phase,party,activeId:(running||failed||next)?.conversationId||party.leaderId,
    questId:matched?quest.id:null,todoId:todoId||null,runId,
    completedCount:steps.filter(step=>step.status==='completed').length,totalCount:steps.length,
    roleCompletedCount:steps.filter(step=>step.kind!=='summary'&&step.status==='completed').length,
    roleTotalCount:steps.filter(step=>step.kind!=='summary').length,
    steps,report,status,disconnected,origin:activity?.origin||'party',title:todo?.title||activity?.title||'',
    gatherStartedAt:activity?.gatherStartedAt,gatherUntil:activity?.gatherUntil,
    error:disconnected?'接続を待っています。進行状況は接続後に確認します。':townQuestStopReason(activity?.error||(matched?quest?.error:null))||(!report&&status==='completed'?'完了記録を確認してください。':''),
    ownsParty:phase!=='reported'};
}

function decorate(scene){
  if(!scene)return null;
  const step=scene.steps.find(step=>step.conversationId===scene.activeId);
  scene.label=scene.disconnected?'接続待ち · 進行を確認中':({gathering:'仲間が掲示板へ集合中',working:step?.status==='running'?(step.role||'担当')+'が作業中':'次の担当を準備中',handoff:'成果を次の仲間へ引き継ぎ中',summary:'リーダーが成果をまとめ中',reporting:'成果完成 · お城へ報告中',reported:'成果を確認できます',paused:'処理が中断しています',stopping:'処理の停止を待っています',blocked:'開始を停止しました'})[scene.phase];
  scene.formation=activityFormation(scene.party,scene.activeId,scene.handoffFromId);
  scene.ownsParty=scene.phase!=='reported';return scene;
}

// This controller only reads snapshots and computes presentation. It never
// starts a turn, changes a TODO, retries a failure, or sends a Teams message.
export function createTownActivity(){
  let scene=null,latest=null,lastObserved=null,lastReport=null,plans=new Map(),reportOrigins=new Map(),phaseUntil=0,reportStartedAt=0,initialized=false;

  function targets(value){
    const ids=value.formation.ids;
    return new Map(ids.map((id,index)=>{
      const step=value.steps.find(step=>step.conversationId===id);
      let destination=waitingPoint(index,ids.length);
      if(value.phase==='gathering')destination=waitingPoint(index,ids.length);
      else if(['working','summary'].includes(value.phase)&&id===value.activeId)destination=TOWN_WORKSITES[value.phase==='summary'?'shared':roleWorkplace(step?.role)];
      else if(value.phase==='handoff'&&[value.activeId,value.handoffFromId].includes(id))destination={x:.5+(id===value.handoffFromId?-.028:.028),y:ROAD_Y};
      return [id,destination];
    }));
  }
  function samplePlans(now,reduced=false){
    const result=new Map();
    for(const [id,plan] of plans){
      const progress=reduced||plan.length<=.0001?1:clamp((now-plan.start)/plan.duration,0,1);
      result.set(id,{...sampleRoute(plan.route,plan.length*progress),progress,moving:progress<1&&plan.length>.0001});
    }
    return result;
  }
  function settlePlans(now){
    for(const [id,plan] of plans)if(plan.length>.0001)plans.set(id,{route:[plan.route.at(-1)],length:0,start:now,duration:1});
  }
  function transition(value,now,origins,{instant=false,gather=false}={}){
    plans=new Map();
    for(const [index,[id,destination]] of [...targets(value)].entries()){
      const origin=origins.get(id)||origins.get(WAGON)||defaultPoint(index),route=townRoadRoute(origin,destination),length=routeLength(route);
      const start=gather?finite(value.gatherStartedAt,now)+Math.min(index*100,400):now;
      const duration=gather?Math.max(1,finite(value.gatherUntil,start+2200)-start):Math.min(value.phase==='handoff'?HANDOFF_MS:1800,Math.max(150,length*4200));
      plans.set(id,{route:instant?[destination]:route,length:instant?0:length,start,duration:instant?1:duration});
    }
  }
  function sample(now,reduced=false){
    if(!scene)return new Map();
    if(scene.phase==='reporting'){
      const elapsed=now-reportStartedAt;
      return new Map(scene.formation.ids.map((id,index)=>{
        if(elapsed<ASSEMBLE_MS&&!reduced){
          const route=townRoadRoute(reportOrigins.get(id)||defaultPoint(index),processionPoint(index,0));
          const progress=clamp(elapsed/ASSEMBLE_MS,0,1);
          return [id,{...sampleRoute(route,routeLength(route)*progress),progress,moving:routeLength(route)>.0001}];
        }
        const progress=reduced?1:clamp((elapsed-ASSEMBLE_MS)/(REPORT_MS-ASSEMBLE_MS),0,1);
        return [id,{...processionPoint(index,progress),progress,moving:progress<1}];
      }));
    }
    return samplePlans(now,reduced);
  }
  function expire(now,reduced=false){
    if(scene?.phase==='handoff'&&(now>=phaseUntil||reduced)){
      const at=reduced?now:phaseUntil,origins=sample(at,reduced);
      scene=decorate({...latest});phaseUntil=0;transition(scene,at,origins,{instant:reduced});
    }
    if(scene?.phase==='reporting'&&(now>=reportStartedAt+REPORT_MS||reduced)){
      const origins=sample(reportStartedAt+REPORT_MS,true);
      scene=decorate({...scene,phase:'reported'});
      plans=new Map([...origins].map(([id,p])=>[id,{route:[p],length:0,start:now,duration:1}]));
    }
  }
  function update(state,{now=Date.now(),visible=true,reduced=false,starts=[]}={}){
    now=finite(now,Date.now());expire(now,reduced);if(reduced)settlePlans(now);const hydrated=!initialized;initialized=true;
    const prior=scene,origins=sample(now,reduced);
    // After a report the manual trail owns the actors again. Its current
    // coordinates supersede the retained report scene when another job starts.
    for(const p of starts)if(p?.id&&(!prior?.ownsParty||!origins.has(p.id)))origins.set(p.id,point(p));
    const next=deriveScene(state,now);
    if(!next){scene=null;latest=null;lastObserved=null;plans=new Map();return null;}
    latest=decorate(next);
    if(next.report)lastReport=copy(next.report);
    const same=lastObserved?.key===next.key;
    const priorStatuses=new Map((lastObserved?.steps||[]).map(step=>[step.id||step.conversationId,step.status]));
    const newlyCompleted=same?next.steps.filter(step=>step.kind!=='summary'&&step.status==='completed'&&priorStatuses.has(step.id||step.conversationId)&&priorStatuses.get(step.id||step.conversationId)!=='completed'):[];
    const observedCompletion=next.report&&same&&['running','stopping','paused'].includes(lastObserved.status)&&!lastObserved.disconnected&&!next.disconnected;
    const stopped=['paused','stopping','blocked'].includes(next.phase);
    const continuingReport=prior?.key===next.key&&prior.phase==='reporting'&&next.report;
    const continuingHandoff=prior?.key===next.key&&prior.phase==='handoff'&&!stopped&&['working','summary'].includes(next.phase);
    if(continuingReport){scene=decorate({...next,phase:'reporting'});}
    else if(observedCompletion&&visible&&!reduced){
      scene=decorate({...next,phase:'reporting'});reportStartedAt=now;reportOrigins=origins;
    }else if(continuingHandoff){
      scene=decorate({...next,phase:'handoff',handoffFromId:prior.handoffFromId});
      // A very fast next turn must supersede the old handoff, not queue behind it.
      if(next.activeId!==prior.activeId){scene=decorate({...next});phaseUntil=0;transition(scene,now,origins,{instant:!visible||reduced});}
    }else if(newlyCompleted.length&&visible&&!reduced&&['working','summary'].includes(next.phase)&&next.activeId&&newlyCompleted.at(-1).conversationId!==next.activeId){
      scene=decorate({...next,phase:'handoff',handoffFromId:newlyCompleted.at(-1).conversationId});phaseUntil=now+HANDOFF_MS;transition(scene,now,origins);
    }else{
      scene=decorate({...next});
      const changed=!prior||prior.key!==scene.key||prior.phase!==scene.phase||prior.activeId!==scene.activeId||prior.formation.ids.join('|')!==scene.formation.ids.join('|');
      if(stopped){
        // Stop at the currently displayed coordinates, including mid-path.
        if(changed){const defaults=targets(scene);plans=new Map(scene.formation.ids.map((id,index)=>{const p=origins.get(id)||defaults.get(id)||defaultPoint(index);return [id,{route:[p],length:0,start:now,duration:1}];}));}
      }else if(changed){
        transition(scene,now,origins,{instant:reduced||!visible||(hydrated&&scene.phase!=='gathering')||scene.phase==='reported',gather:scene.phase==='gathering'});
      }
    }
    lastObserved={key:next.key,status:next.status,steps:copy(next.steps),disconnected:next.disconnected};
    return scene;
  }
  function frame({now=Date.now(),width=1,height=1,reduced=false}={}){
    now=finite(now,Date.now());expire(now,reduced);if(reduced)settlePlans(now);
    if(!scene)return null;
    const coords=sample(now,reduced),stopped=['paused','stopping','blocked'].includes(scene.phase);
    const positions=scene.formation.ids.map(id=>{
      const p=coords.get(id)||point(),step=scene.steps.find(step=>step.conversationId===id);
      const roleState=step?.status||(scene.phase==='gathering'?'gathering':'waiting');
      let action='waiting',icon='';
      if(stopped&&id===scene.activeId){action='paused';icon='question';}
      else if(scene.phase==='reporting'){action='carrying';icon=id===scene.party.leaderId?'report':'';}
      else if(scene.phase==='handoff'&&[scene.activeId,scene.handoffFromId].includes(id)){action='carrying';icon='scroll';}
      else if(id===scene.activeId&&step?.status==='running'){
        const workplace=scene.phase==='summary'?'shared':roleWorkplace(step.role);
        action=scene.phase==='summary'?'summarizing':({research:'reading',craft:'writing',review:'reviewing',shared:'writing'})[workplace];
        icon=scene.phase==='summary'?'report':TOWN_WORKSITES[workplace].icon;
      }else if(step?.status==='completed'){action='complete';icon='scroll';}
      const moving=Boolean(!stopped&&!reduced&&p.moving&&scene.ownsParty);
      return {id,x:clamp(p.x*width,Math.min(24,width/2),Math.max(width-24,width/2)),y:clamp(p.y*height,Math.min(27,height/2),Math.max(height-27,height/2)),direction:p.direction||'down',moving,action,icon,roleState,progress:p.progress??1};
    });
    const handoff=scene.phase==='handoff'?{fromId:scene.handoffFromId,toId:scene.activeId,progress:clamp((now-(phaseUntil-HANDOFF_MS))/HANDOFF_MS,0,1)}:null;
    return {...scene,positions,handoff,moving:positions.some(p=>p.moving)||scene.phase==='handoff'||scene.phase==='reporting'};
  }
  return {update,frame,get scene(){return scene;},get lastReport(){return lastReport;}};
}
