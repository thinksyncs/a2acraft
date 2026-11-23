import {ui} from './interface-language.js';
import {characterAppearance} from './character-appearance.js';

export const VILLAGE_SQUAD_LIMIT=12;
const statuses=new Set(['running','stopping','starting','gathering','waiting','paused','completed','cancelled','blocked','uncertain']);
const liveStatuses=new Set(['running','stopping','paused']);
const locations=new Set(['library','workshop','tavern','castle']);
const labels={running:ui('作業中', "Working"),stopping:ui('停止中', "Stopping"),starting:ui('出発準備', "Preparing"),gathering:ui('集合中', "Gathering"),waiting:ui('待機中', "Waiting"),paused:ui('中断中', "Paused"),completed:ui('帰還済み', "Returned"),cancelled:ui('終了', "Finished"),blocked:ui('開始できません', "Cannot start"),uncertain:ui('記録の確認待ち', "Awaiting review")};
const motionFor={running:'working',stopping:'paused',starting:'gathering',gathering:'gathering',waiting:'waiting',paused:'paused',completed:'returned',cancelled:'returned',blocked:'paused',uncertain:'paused'};
const order={working:0,gathering:1,paused:2,waiting:3,returned:4};
const array=value=>Array.isArray(value)?value:[];
const id=value=>typeof value==='string'&&value.trim()&&value.length<=512?value:null;
const text=(value,max)=>typeof value==='string'?Array.from(value.replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim()).slice(0,max).join(''):'';
const time=value=>Number.isFinite(value)&&value>=0?value:0;
const hash=value=>{let result=2166136261;for(const character of value){result^=character.codePointAt(0);result=Math.imul(result,16777619);}return result>>>0;};
const formationKey=party=>JSON.stringify([party?.leaderId,array(party?.members).map(member=>[member.conversationId,member.role]).sort((a,b)=>a[0].localeCompare(b[0]))]);
const stepStatuses=new Set(['pending','running','completed','interrupted','failed','blocked','paused','cancelled','uncertain']);

function taskDetails({todo,record,execution,board,party,status,provisional,isCurrent}){
  const live=Boolean(isCurrent&&status==='running'),members=new Map(party.members.map(member=>[member.conversationId,member]));
  const recordedSteps=provisional?[]:array(record?.steps).filter(step=>step&&id(step.conversationId)).slice(0,8);
  const seen=new Set(),steps=[];
  for(const step of recordedSteps){
    const member=members.get(step.conversationId);if(!member||seen.has(member.conversationId))continue;
    seen.add(member.conversationId);
    const recordedStatus=stepStatuses.has(step.status)?step.status:'uncertain';
    const stepStatus=recordedStatus==='running'&&!live?(['paused','stopping'].includes(status)?'paused':'uncertain'):recordedStatus;
    steps.push({conversationId:member.conversationId,name:member.name,role:text(step.role,120)||member.role,status:stepStatus,output:text(step.output,400),error:text(step.error,240)});
  }
  let progress=null;
  const total=recordedSteps.length||record?.stepCount,completed=recordedSteps.length?recordedSteps.filter(step=>step.status==='completed').length:record?.completedSteps;
  if(!provisional&&Number.isSafeInteger(total)&&total>0&&total<=8&&Number.isSafeInteger(completed)&&completed>=0&&completed<=total)progress={completed,total};
  const running=live?steps.find(step=>step.status==='running'):null;
  const current=running?{conversationId:running.conversationId,name:running.name,role:running.role,status:running.status}:null;
  const finalStep=status==='completed'?recordedSteps.at(-1):null;
  const summary=provisional?'':text(isCurrent?(finalStep?.status==='completed'?finalStep.output:record?.output):execution?.output||record?.output||(finalStep?.status==='completed'?finalStep.output:''),400);
  // A resumed current quest can clear an error before its TODO snapshot is
  // broadcast. Explicit current state, including null, remains authoritative.
  const error=provisional?'':text(board?.error||(isCurrent?record?.error:record?.error||execution?.error),240);
  const note=provisional?ui('開始前です。保存した編成で待機しています。', "Ready to begin with the saved party."):status==='uncertain'?ui('過去の実行記録です。現在の作業状況は確認できません。', "This is a previous run. Its current progress is unavailable."):status==='gathering'||status==='starting'?ui('この依頼を担当する仲間が集まっています。', "The party is gathering for this quest."):!isCurrent&&progress&&!steps.length?ui('保存された進み具合です。担当ごとの記録は元の依頼で確認できます。', "Saved progress. Open the quest to see each member's record."):!progress?ui('進み具合の記録はまだありません。', "No progress recorded yet."):'';
  return {description:text(todo?.description||record?.text,400),criteria:text(todo?.criteria,240),artifact:text(todo?.source?.artifact,240),summary,error,progress,current,steps,live,note};
}

function formation(input,chats){
  const seen=new Set(),members=[];
  for(const member of array(input?.members).slice(0,8)){
    const conversationId=id(member?.conversationId),chat=chats.get(conversationId);
    if(!chat||seen.has(conversationId))continue;
    seen.add(conversationId);
    const role=text(member.role,120)||ui('担当', "Assigned"),title=text(chat.title,120)||text(member.title,120)||ui('会話', "Chat");
    members.push({conversationId,name:text(chat.characterName,80)||title,title,role,appearance:characterAppearance(role).id,seed:hash(conversationId),isLeader:conversationId===input.leaderId});
  }
  // A missing leader is not replaced by an invented assignment.
  const leaderId=members.some(member=>member.isLeader)?input.leaderId:null;
  return {name:text(input?.name,80)||ui('クエストの仲間', "Quest companions"),leaderId,members};
}

/**
 * Read-only projection of existing quest records. Only the live PartyRunner
 * may be shown as working. Waiting formations are explicitly provisional;
 * their movement must never be presented as an additional model execution.
 */
export function projectVillageActivities(state,chats){
  state=state&&typeof state==='object'?state:{};
  const chatById=new Map();
  for(const chat of array(chats))if(id(chat?.id)&&!chatById.has(chat.id))chatById.set(chat.id,chat);
  const saved=formation(state.party?.party,chatById),current=state.party?.quest;
  const todos=array(state.todos?.items).filter(todo=>id(todo?.id)),todoById=new Map(todos.map(todo=>[todo.id,todo]));
  const boardRows=[...array(state.boardDispatch?.history),state.boardDispatch?.active].filter(row=>row&&id(row.id));
  const references=new Map();
  for(const todo of todos)for(const run of array(todo.runs))if(id(run?.questId))references.set(run.questId,{todoId:todo.id,runId:id(run.id)});
  for(const row of boardRows)if(id(row.questId)&&id(row.todoId)&&!references.has(row.questId))references.set(row.questId,{todoId:row.todoId,runId:id(row.runId)});
  const candidates=[];
  function add(input){
    if(!statuses.has(input.status))return;
    const questId=id(input.questId),reference=references.get(questId),todoId=id(input.todoId)||reference?.todoId||null;
    const key=todoId?'todo:'+todoId:questId?'quest:'+questId:id(input.boardId)?'board:'+input.boardId:null;
    if(!key)return;
    const party=formation(input.party,chatById),todo=todoById.get(todoId);
    // An old run is a record, not evidence that another AI is still executing.
    const staleActivity=['running','starting','gathering'].includes(input.status)&&!input.live&&!input.gathering;
    const status=staleActivity?'uncertain':input.status;
    const title=text(todo?.title,120)||text(input.title,120)||party.name;
    const runningMember=input.live?array(current?.steps).find(step=>step?.status==='running'&&party.members.some(member=>member.conversationId===step.conversationId)):null;
    const targetConversationId=runningMember?.conversationId||party.leaderId||party.members[0]?.conversationId||null;
    const provisional=Boolean(input.provisional);
    const runId=id(input.runId)||reference?.runId||null;
    // A task may have several runs, and the current runner may already belong
    // to a different task. Never combine records by task title or party alone.
    const matchingCurrent=questId&&questId===id(current?.id)&&(!runId||!id(current?.link?.runId)||runId===current.link.runId)&&(!todoId||!id(current?.link?.todoId)||todoId===current.link.todoId);
    const execution=provisional?null:input.source==='todo'?input.record:array(todo?.runs).find(run=>run&&((runId&&run.id===runId&&(!questId||run.questId===questId))||(!runId&&questId&&run.questId===questId)))||null;
    const record=provisional?null:matchingCurrent?current:execution;
    const details=taskDetails({todo,record,execution,board:input.source==='board'?input.record:null,party,status,provisional,isCurrent:Boolean(matchingCurrent)});
    candidates.push({
      id:key,questId,todoId,runId,title,status,details,
      statusLabel:provisional&&status==='waiting'?ui('編成予定・待機中', "Party ready · waiting"):labels[status],motion:motionFor[status],
      members:party.members,leaderId:party.leaderId,partyName:party.name,source:input.source,provisional,
      location:locations.has(input.location)?input.location:locations.has(todo?.source?.location)?todo.source.location:null,
      targetConversationId,targetKeywords:[...new Set(title.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]{1,59}/gu)||[])].slice(0,12),
      updatedAt:time(input.updatedAt),seed:hash(key),isProtagonist:false,
      _priority:input.priority||0,_live:Boolean(input.live)
    });
  }

  // TODO public snapshots retain the saved run's party, even after a later
  // quest has replaced PartyRunner's current slot.
  for(const todo of todos){
    if(!['party','chat'].includes(todo.assignee?.type))continue;
    const runs=array(todo.runs),run=runs.at(-1);
    const reopened=todo.status==='todo'&&run?.status==='completed';
    if(run&&!reopened){
      const status=run.status==='running'&&!id(run.questId)?'starting':run.status;
      const knownParty=run.party;
      add({todoId:todo.id,questId:run.questId,runId:run.id,title:todo.title,status,
        party:knownParty,source:'todo',record:run,location:todo.source?.location,
        updatedAt:Math.max(time(todo.updatedAt),time(run.completedAt),time(run.failedAt),time(run.createdAt)),priority:60});
    }else if(todo.status!=='done'){
      const party=todo.assignee.type==='chat'?{name:todo.title,leaderId:todo.assignee.conversationId,members:[{conversationId:todo.assignee.conversationId,role:ui('担当チャット', "Assigned conversation")}]}:state.party?.party;
      add({todoId:todo.id,title:todo.title,status:'waiting',party,provisional:true,source:'todo',location:todo.source?.location,updatedAt:todo.updatedAt,priority:60});
    }
  }

  for(const row of boardRows){
    const active=row===state.boardDispatch?.active,unfinished=active&&['gathering','starting','running','blocked','uncertain'].includes(row.status);
    add({boardId:row.id,todoId:row.todoId,questId:row.questId,runId:row.runId,title:row.title,status:row.status,
      party:row.selection?.party,source:'board',record:row,location:row.selection?.location,gathering:active&&['starting','gathering'].includes(row.status),
      updatedAt:Math.max(time(row.updatedAt),time(row.finishedAt),time(row.gatherStartedAt)),priority:unfinished?80:40});
  }

  if(id(current?.id)){
    const live=liveStatuses.has(current.status);
    add({questId:current.id,todoId:current.link?.todoId,runId:current.link?.runId,title:current.text,status:current.status,
      party:current.party,source:'party',live,updatedAt:Math.max(time(current.updatedAt),time(current.completedAt),time(current.createdAt)),priority:live?100:50});
  }

  // A manually resumed quest can finish while the board still retains its
  // earlier blocked attempt. A terminal record for that exact execution wins;
  // completion from an older run must not clear a newly blocked recruitment.
  const finishedByQuest=new Map();
  for(const candidate of candidates)if(candidate.source!=='board'&&candidate.questId&&['completed','cancelled'].includes(candidate.status)){
    const records=finishedByQuest.get(candidate.questId)||[];records.push(candidate);finishedByQuest.set(candidate.questId,records);
  }
  for(const candidate of candidates)if(candidate.source==='board'&&candidate.questId&&['blocked','uncertain'].includes(candidate.status)){
    const finished=finishedByQuest.get(candidate.questId)||[];
    if(finished.some(record=>record.id===candidate.id&&(!record.runId||!candidate.runId||record.runId===candidate.runId)))candidate._priority=30;
  }
  const byId=new Map();
  for(const candidate of candidates){
    const previous=byId.get(candidate.id);
    if(!previous||candidate._priority>previous._priority||candidate._priority===previous._priority&&candidate.updatedAt>previous.updatedAt)byId.set(candidate.id,candidate);
  }
  const allSquads=[...byId.values()];
  let protagonist=saved.members.length?{...saved,id:'protagonist',status:'exploring',statusLabel:ui('あなたのパーティ', "Your party"),motion:'exploring',activityId:null,seed:hash('protagonist')}:null;
  if(protagonist){
    const bound=allSquads.find(squad=>squad._live&&formationKey(squad)===formationKey(saved));
    if(bound){protagonist.activityId=bound.id;protagonist.status=bound.status;protagonist.statusLabel=bound.statusLabel;protagonist.motion=bound.motion;bound.isProtagonist=true;}
  }
  allSquads.sort((a,b)=>Number(b._live)-Number(a._live)||order[a.motion]-order[b.motion]||b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
  for(const squad of allSquads){delete squad._priority;delete squad._live;}
  const squads=allSquads.slice(0,VILLAGE_SQUAD_LIMIT),stats={total:allSquads.length,shown:squads.length,running:0,gathering:0,waiting:0,paused:0,returned:0};
  for(const squad of allSquads){if(squad.motion==='working')stats.running++;else stats[squad.motion]++;}
  return {protagonist,squads,allSquads,stats};
}
