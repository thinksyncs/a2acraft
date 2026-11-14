import {randomUUID} from 'node:crypto';
import {verifyThreadPermissions} from './codex-launch.mjs';
import {standingAgentInstructions} from './codex-workspace-policy.mjs';
import {checkPlan} from './policy.mjs';
import {agentBoardTools,agentBoardInstructions,boardSnapshot,callAgentBoard} from './agent-board-tools.mjs';
import {contextInput} from './context-board.mjs';

// Project turns share the authenticated App Server connection, but never a
// thread writer or a completion callback. Legacy chat keeps its existing policy.
export class ProjectCodex{
 constructor({rpc,refresh,getState,getConversation,save,onChange,board,contextBoard,attachContexts}){Object.assign(this,{rpc,refresh,getState,getConversation,save,onChange,board,contextBoard,attachContexts});this.turns=new Map();this.knownThreads=new Set();}
 async execute({project,job,cwd,readOnly,prompt,signal}){
  await this.refresh();let state=this.getState(),gate=checkPlan(state.account,state.limits);
  if(!state.connected||!gate.ok)throw Object.assign(Error(gate.reason||'Codexに接続してください。'),{code:'quota'});
  const model=project.model||state.models[0]?.model;
  if(!state.models.some(m=>m.model===model))throw Error('利用可能なモデルを選択してください。');
  if(signal.aborted)throw Object.assign(Error('停止しました。'),{code:'stopped'});
  const chat=this.getConversation(job.conversationId);if(!chat)throw Error('担当の会話が見つかりません。');
  chat.status='starting';chat.error=null;chat.model=model;chat.turnId=null;await this.save(chat);
  let turn;
  try{
   const result=await this.rpc('thread/start',{cwd,model,approvalPolicy:'never',sandbox:readOnly?'read-only':'workspace-write',...(this.board?{dynamicTools:agentBoardTools}:{}),developerInstructions:'VILLAGE_PROJECT_ENGINE\nこのprojectの目的と工程に沿って作業してください。作業領域以外を変更しないでください。最終回答は指定されたJSONで返してください。'+'\n\n'+standingAgentInstructions+(this.board?'\n'+agentBoardInstructions:'')});
   verifyThreadPermissions(result,{cwd,readOnly});
   chat.threadId=result.thread.id;this.knownThreads.add(chat.threadId);await this.save(chat);
   if(signal.aborted)throw Object.assign(Error('停止しました。'),{code:'stopped'});
   let finish;
   const completed=new Promise(resolve=>{finish=resolve;});
   turn={chat,projectId:project.id,projectName:project.name,jobId:job.id,jobTitle:job.title,attempt:job.attempt,threadId:chat.threadId,turnId:null,finish,checks:[],outputs:new Map(),closed:false,requested:false,signal};
   this.turns.set(turn.threadId,turn);
   const abort=()=>{if(turn.closed)return;if(turn.turnId&&turn.interruptedTurnId!==turn.turnId){turn.interruptedTurnId=turn.turnId;this.rpc('turn/interrupt',{threadId:turn.threadId,turnId:turn.turnId}).catch(()=>{});}chat.status='stopping';this.save(chat).catch(()=>{});if(!turn.abortTimer)turn.abortTimer=setTimeout(()=>{chat.status='failed';chat.turnId=null;this.save(chat).catch(()=>{});this.finish(turn,{failed:true,uncertain:true,error:'停止の完了を確認できません。作業記録を確認してください。'});},5000);};turn.abort=abort;
   signal.addEventListener('abort',abort,{once:true});
   turn.cleanup=()=>{signal.removeEventListener('abort',abort);clearTimeout(turn.abortTimer);};
   state=this.getState();gate=checkPlan(state.account,state.limits);if(!state.connected||!gate.ok)throw Object.assign(Error(gate.reason||'接続が変わりました。'),{code:'quota'});
   const contexts=await this.contextBoard?.reserve(chat.id)||[];
   try{
    state=this.getState();gate=checkPlan(state.account,state.limits);
    if(signal.aborted)throw Object.assign(Error('停止しました。'),{code:'stopped'});
    if(!state.connected||!gate.ok)throw Object.assign(Error(gate.reason||'接続が変わりました。'),{code:'quota'});
    const request={id:randomUUID(),role:'user',text:'目的: '+project.goal+'\n工程: '+job.title+(job.retries?'\n前の結果を調べ、修正を続けてください。':''),createdAt:Date.now(),projectId:project.id,projectJobId:job.id};
    chat.messages.push(request);await this.save(chat);
    if(signal.aborted)throw Object.assign(Error('停止しました。'),{code:'stopped'});
    turn.requested=true;
    const response=await this.rpc('turn/start',{threadId:turn.threadId,input:contextInput(contexts,prompt+(this.board?boardSnapshot(this.board,project.id):'')),cwd,model,effort:project.effort,approvalPolicy:'never'});
    turn.turnId=turn.turnId||response.turn.id;
    if(contexts.length){
     request.contextIds=contexts.map(entry=>entry.id);await this.save(chat);
     if(this.attachContexts)await this.attachContexts(contexts);else await this.contextBoard.attach(request.contextIds);
    }
   }finally{this.contextBoard?.release(contexts);}
   if(!turn.closed){chat.turnId=turn.turnId;chat.status=signal.aborted?'stopping':'running';await this.save(chat);if(signal.aborted)abort();}
   return await completed;
  }catch(error){
   error.uncertain=Boolean(turn?.requested);
   // A turn accepted before a local receipt failed must not be replayed by the
   // project repair loop. Ask that turn to stop while retaining its unknown outcome.
   if(turn?.requested&&!turn.closed&&turn.turnId)turn.abort();
   if(turn&&!turn.closed)this.finish(turn,{failed:true,error:error.message,uncertain:turn.requested});
   chat.status=signal.aborted?'cancelled':'failed';chat.error=error.message;
   try{await this.save(chat);}catch(saveError){saveError.uncertain=error.uncertain;throw saveError;}
   throw error;
  }
 }
 async tool(params){
  const state=this.getState();
  if(!this.board||!state.connected||!checkPlan(state.account,state.limits).ok)return {success:false,contentItems:[{type:'inputText',text:'接続または利用枠を確認してください。'}]};
  return callAgentBoard(this.board,params,this.turns.get(params.threadId));
 }
 message(message){
  const params=message.params||{},turn=this.turns.get(params.threadId);if(!turn)return this.knownThreads.has(params.threadId);
  if(params.turnId&&turn.turnId&&params.turnId!==turn.turnId)return true;
  const chat=turn.chat;
  if(message.method==='turn/started'){turn.turnId=params.turn.id;chat.turnId=turn.turnId;chat.status='running';const state=this.getState();if(turn.signal.aborted||!state.connected||!checkPlan(state.account,state.limits).ok)turn.abort();}
  if(message.method==='item/agentMessage/delta'){
   let item=chat.messages.find(m=>m.id===params.itemId);if(!item){item={id:params.itemId,role:'assistant',text:'',createdAt:Date.now()};chat.messages.push(item);}item.text+=params.delta;turn.outputs.set(item.id,item.text);
  }
  if(message.method==='item/completed'&&params.item?.type==='agentMessage'){
   let item=chat.messages.find(m=>m.id===params.item.id);if(!item){item={id:params.item.id,role:'assistant',text:'',createdAt:Date.now()};chat.messages.push(item);}item.text=params.item.text;turn.outputs.set(item.id,item.text);
   try{const report=JSON.parse(item.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1'));if(typeof report.summary==='string')item.text=[report.summary,report.question,...(Array.isArray(report.steps)?report.steps.map(step=>step.title):[])].filter(Boolean).join('\n\n');}catch{}
  }
  if(message.method==='item/completed'&&params.item?.type==='commandExecution'){
   const item=params.item;if(typeof item.command==='string'&&Number.isInteger(item.exitCode))turn.checks.push({command:item.command.slice(0,2000),exitCode:item.exitCode,at:Date.now()});if(turn.checks.length>200)turn.checks.shift();
  }
  if(message.method==='turn/completed'){
   if(turn.turnId&&params.turn.id!==turn.turnId)return true;
   chat.status=params.turn.status==='completed'?'completed':params.turn.status==='interrupted'?'cancelled':'failed';chat.turnId=null;chat.error=params.turn.error?.message||null;
   this.save(chat).then(()=>this.finish(turn,{output:[...turn.outputs.values()].at(-1)||'',checks:turn.checks,failed:params.turn.status!=='completed',error:chat.error||'工程が停止しました。',interrupted:params.turn.status==='interrupted'})).catch(error=>this.finish(turn,{failed:true,uncertain:true,error:'会話の保存に失敗しました: '+error.message}));return true;
  }
  this.save(chat).catch(error=>this.finish(turn,{failed:true,uncertain:true,error:'会話の保存に失敗しました: '+error.message}));return true;
 }
 finish(turn,result){if(turn.closed)return;turn.closed=true;turn.cleanup?.();this.turns.delete(turn.threadId);turn.finish(result);this.onChange?.();}
 disconnect(reason){for(const turn of this.turns.values()){turn.chat.status='failed';turn.chat.error=reason;this.save(turn.chat).catch(()=>{});this.finish(turn,{failed:true,uncertain:true,error:reason});}}
 stopForQuota(){for(const turn of this.turns.values())turn.abort?.();}
}
