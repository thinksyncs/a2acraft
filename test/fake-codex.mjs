#!/usr/bin/env node
// Protocol fixture only. Never connects to OpenAI.
import {createInterface} from 'node:readline';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const emit=m=>{process.stdout.write(JSON.stringify(m)+'\n');if(m.method==='turn/completed')log({event:m.method,threadId:m.params.threadId,turnId:m.params.turn.id,status:m.params.turn.status});};
const controls=()=>process.env.A2ACRAFT_FIXTURE_CONTROL?JSON.parse(readFileSync(process.env.A2ACRAFT_FIXTURE_CONTROL,'utf8')):{};
const log=value=>{if(process.env.A2ACRAFT_FIXTURE_LOG)appendFileSync(process.env.A2ACRAFT_FIXTURE_LOG,JSON.stringify(value)+'\n');};
assert.equal(process.argv[2],'app-server');
const isolatedConfig=readFileSync(path.join(process.env.CODEX_HOME,'config.toml'),'utf8');
assert(isolatedConfig.includes('sandbox_mode = "read-only"'));
assert(isolatedConfig.includes('approval_policy = "never"'));
assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.CODEX_API_KEY,undefined);
log({args:process.argv.slice(2),cwd:process.cwd()});
let loggedIn=controls().loggedIn??true,loginNumber=0,loginId=null,threadNumber=0,turnNumber=0,completedTurns=0,accountUpdateSent=false;
const activeTurns=new Map();
const toolReplies=new Map();let toolNumber=0;
function boardTool(threadId,turnId,tool,args){
 const id='board-call-'+ ++toolNumber;
 return new Promise(resolve=>{toolReplies.set(id,resolve);const request={id,method:'item/tool/call',params:{threadId,turnId,callId:id,tool,arguments:args}};log({event:'board-request',...request});emit(request);});
}
let closedThreadId=null;
if(process.env.A2ACRAFT_FIXTURE_CONTROL)setInterval(()=>{
 const control=controls();
 if(control.closedThreadId&&closedThreadId!==control.closedThreadId){closedThreadId=control.closedThreadId;emit({method:'thread/closed',params:{threadId:closedThreadId}});}
 if(control.disconnect)process.exit(0);
 if(loginId&&control.completion?.loginId===loginId){
  const id=loginId;loginId=null;loggedIn=control.completion.success;
  emit({method:'account/login/completed',params:{loginId:id,success:loggedIn,error:control.completion.error||null}});
  emit({method:'account/updated',params:{authMode:loggedIn?'chatgpt':null}});
 }
},25);
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 log(m);
 if(!m.method){const resolve=toolReplies.get(m.id);if(resolve){toolReplies.delete(m.id);resolve(m.result);}return;}
 const control=controls(),error=m.method==='initialize'?control.initializeError:m.method==='account/read'?control.accountError:m.method==='account/rateLimits/read'?control.quotaError:m.method==='skills/list'?control.skillsError:m.method==='thread/resume'?control.threadResumeError:m.method==='thread/fork'?control.threadForkError:['turn/start','turn/steer'].includes(m.method)?control.turnError:null;
 if(error)return emit({id:m.id,error:{code:-1,message:error}});
 const p=m.params||{};let result={};
 if(m.method==='config/read')result={config:{forced_login_method:'chatgpt',cli_auth_credentials_store:'file',allow_login_shell:false,mcp_servers:{},hooks:{},features:{apps:false,plugins:false,remote_plugin:false,hooks:false,shell_snapshot:false,skill_mcp_dependency_install:false}}};
 if(m.method==='thread/list'){
  if(control.historyListError)return emit({id:m.id,error:{code:-1,message:control.historyListError}});
  const rows=(control.historyThreads||[]).filter(thread=>Boolean(thread.archived)===Boolean(p.archived)).sort((a,b)=>b.updatedAt-a.updatedAt);
  const offset=Number(String(p.cursor||'history:0').split(':').at(-1)),limit=control.historyPageSize||p.limit||50;
  result={data:rows.slice(offset,offset+limit).map(thread=>({...thread,turns:[]})),nextCursor:offset+limit<rows.length?'history:'+(offset+limit):null};
 }
 if(m.method==='thread/read'){
  const thread=(control.historyThreads||[]).find(thread=>thread.id===p.threadId);
  if(!thread||control.historyReadErrorId===p.threadId)return emit({id:m.id,error:{code:-1,message:'Fixture history could not be read'}});
  result={thread:{...thread,turns:p.includeTurns?thread.turns:[]}};
 }
 if(m.method==='account/read')result={account:loggedIn?{type:'chatgpt',planType:'pro',email:'fixture@example.com'}:null};
 if(m.method==='account/login/start'){loggedIn=false;loginId='login-'+ ++loginNumber;result={type:'chatgpt',loginId,authUrl:'https://auth.openai.com/fixture-login'};}
 if(m.method==='account/login/cancel'){
  const cancelled=p.loginId;loginId=null;
  setTimeout(()=>emit({method:'account/login/completed',params:{loginId:cancelled,success:false,error:'Cancelled old login'}}),80);
 }
 if(m.method==='account/logout'){loggedIn=false;loginId=null;}
 if(m.method==='account/rateLimits/read')result={rateLimits:{limitId:'codex',primary:{usedPercent:Number.isInteger(control.quotaAfter)&&completedTurns>=control.quotaAfter?99:turnNumber>0&&control.quotaUpdateBeforeTurnStarted!==undefined?control.quotaUpdateBeforeTurnStarted:control.quotaUsedPercent??20,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}}};
 if(m.method==='model/list')result={data:[{model:'fixture-model',displayName:'Fixture',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:null};
 if(m.method==='skills/list')result={data:[{cwd:p.cwds[0],errors:[],skills:(control.skills||[
  {name:'code-review',description:'コードを読んで調べる。',path:'/fixture/skills/code-review/SKILL.md'},
  {name:'shared-gmail-workflow',description:'一通ずつメールを送信する。',path:'/fixture/skills/mail/SKILL.md'},
  {name:'pdf',description:'文書をPDFにまとめる。',path:'/fixture/skills/pdf/SKILL.md'},
  {name:'openai-docs',description:'公式資料を調べる。',path:'/fixture/skills/docs/SKILL.md'},
  {name:'disabled-skill',description:'Disabled',path:'/fixture/skills/disabled/SKILL.md',enabled:false}
 ]).map(skill=>({enabled:true,scope:'user',...skill}))}]};
 if(['thread/start','thread/resume'].includes(m.method)){if(control.projects&&p.developerInstructions?.includes('VILLAGE_PROJECT_ENGINE'))assert(['read-only','workspace-write'].includes(p.sandbox));else if(control.localWork&&p.developerInstructions?.includes('LOCAL_WORKSPACE_TASK')){assert.equal(p.sandbox,'workspace-write');assert.match(p.cwd,/[/\\]workspace[/\\]chats[/\\][A-Za-z0-9_-]+$/);}else assert.equal(p.sandbox,'read-only');assert.equal(p.approvalPolicy,'never');const number=m.method==='thread/start'?++threadNumber:null;result={thread:{id:p.threadId||(control.autoComplete?'thread-fixture-'+process.pid+'-'+number:'thread-fixture'+(number===1?'':'-'+number))}};}
 if(m.method==='thread/fork'){assert.equal(p.sandbox,control.localWork&&p.developerInstructions?.includes('LOCAL_WORKSPACE_TASK')?'workspace-write':'read-only');assert.equal(p.approvalPolicy,'never');result={thread:{id:'thread-fork-fixture-'+process.pid+'-'+ ++threadNumber}};}
 if(['thread/start','thread/resume','thread/fork'].includes(m.method)){
  result.cwd=control.effectiveCwd??p.cwd;result.approvalPolicy=control.effectiveApprovalPolicy??'never';
  result.sandbox=Object.hasOwn(control,'effectiveSandbox')?control.effectiveSandbox:p.sandbox==='workspace-write'?{type:'workspaceWrite',writableRoots:[p.cwd],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}:{type:'readOnly',networkAccess:false};
 }
 if(m.method==='turn/start'){
  const projectInput=control.projects&&(p.input||[]).find(i=>i.text?.startsWith('VILLAGE_PROJECT '));
  const projectContext=projectInput?JSON.parse(projectInput.text.split('\n')[1]):null;
  assert.equal(p.sandboxPolicy,undefined);assert.equal(p.permissions,undefined);assert.equal(p.approvalPolicy,'never');
  const workQuestPlan=(p.input||[]).some(input=>input.type==='text'&&input.text.includes('WORK_QUEST_PLAN'));
  turnNumber++;result={turn:{id:control.autoComplete?'turn-fixture-'+process.pid+'-'+turnNumber:'turn-fixture',status:'inProgress'}};
  const current={id:result.turn.id,number:turnNumber,timer:null};activeTurns.set(p.threadId,current);
  if(control.quotaUpdateBeforeTurnStarted!==undefined)emit({method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:control.quotaUpdateBeforeTurnStarted,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}}}});
  emit({method:'turn/started',params:{threadId:p.threadId,turn:result.turn}});
  if(projectContext&&control.agentBoardTools)current.boardTask=(async()=>{
   const read=await boardTool(p.threadId,current.id,'agent_board_read',{scope:'project',after:0});assert.equal(read.success,true);
   const posted=await boardTool(p.threadId,current.id,'agent_board_post',{scope:'project',kind:'handoff',title:projectContext.phase+': '+projectContext.task,summary:'Fixture note for '+projectContext.task+'; review actual files before integrating.'});assert.equal(posted.success,true);
   if(projectContext.phase==='implement'){
    const initial=JSON.parse(read.contentItems[0].text),hasSibling=entries=>entries.some(e=>e.author.jobId.startsWith('task-')&&e.author.threadId!==p.threadId);
    let seen=hasSibling(initial.entries);
    for(let i=0;i<100&&!seen;i++){
     await new Promise(resolve=>setTimeout(resolve,25));
     const live=await boardTool(p.threadId,current.id,'agent_board_read',{scope:'project',after:initial.nextCursor});assert.equal(live.success,true);
     seen=hasSibling(JSON.parse(live.contentItems[0].text).entries);
    }
    assert(seen,'Fixture worker must observe its sibling note before completing');
   }
  })();
  if(control.autoComplete)current.timer=setTimeout(async()=>{
   await current.boardTask;
   if(activeTurns.get(p.threadId)!==current)return;activeTurns.delete(p.threadId);completedTurns++;
   const options=controls(),failed=options.failTurnNumber===current.number;
   let output=(failed?'Fixture partial ':'Fixture result ')+current.number+'.'.repeat(options.outputLength||0);
   if(projectContext){
    const context=projectContext;
    if(context.phase==='plan')output=JSON.stringify({status:'done',summary:'Two independent changes',steps:[0,1].map(i=>({title:'Feature '+i,task:'Write feature '+i,criteria:'File and test pass',role:'Builder',repoId:'r1',dependsOn:[]}))});
    else if(context.phase==='implement'&&options.projectQuestion&&context.task==='Write feature 0'&&!context.answers.length)output=JSON.stringify({status:'needs_input',summary:'Investigated existing formats',question:'Which format?',options:['JSON','Text']});
    else{
     if(context.phase==='implement')writeFileSync(path.join(p.cwd,context.task.endsWith('0')?'feature0.js':'feature1.js'),'export const feature = true;\n');
     if(context.phase==='verify'){
      let exitCode=0;try{execFileSync(process.execPath,['--test'],{cwd:p.cwd,stdio:'pipe'});}catch{exitCode=1;}
      emit({method:'item/completed',params:{threadId:p.threadId,turnId:current.id,item:{type:'commandExecution',id:'check-'+current.number,command:'node --test',exitCode}}});
     }
     output=JSON.stringify({status:'done',summary:'Fixture actual files and test results'});
    }
   }
   if(workQuestPlan){
    const plan=Object.hasOwn(options,'workQuestOutput')?options.workQuestOutput:{steps:[
     {title:'資料館で週次報告の材料を集める',task:'週次報告に必要な実績、未完了の仕事、確認が必要な点を元の依頼から整理する。',artifact:'週次報告の材料一覧',criteria:'実績と未完了事項が分かれ、確認が必要な点が明記されている。',location:'library'},
     {title:'工房で報告書の下書きを作る',task:'先行クエストの材料一覧を参照して週次報告の下書きを作る。',artifact:'レビュー用の週次報告下書き',criteria:'実績、課題、次の行動が含まれ、未確認事項を事実として書いていない。',location:'workshop'},
     {title:'お城へ提出する報告を整える',task:'前のクエストの下書きを見直し、提出前に確認する点を整理する。',artifact:'最終報告案と確認事項',criteria:'元の依頼と照合され、送信や外部更新をせず確認用の案として完成している。',location:'castle'}
    ]};
    output=typeof plan==='string'?plan:JSON.stringify(plan);
   }
   if(options.emptyTurnNumber!==current.number)emit({method:'item/completed',params:{threadId:p.threadId,turnId:current.id,item:{type:'agentMessage',id:'fixture-result-'+process.pid+'-'+current.number,text:output}}});
   emit({method:'turn/completed',params:{threadId:p.threadId,turn:{id:current.id,status:failed?'failed':'completed',error:failed?{message:'Fixture failed turn '+current.number}:null}}});
  },(workQuestPlan?control.workQuestDelay:undefined)??control.turnDelay??80);
 }
 if(m.method==='turn/steer'){if(p.expectedTurnId!=='turn-fixture')return emit({id:m.id,error:{code:-1,message:'Wrong turn'}});result={turnId:'turn-fixture'};}
 const reply=()=>{
  if(m.method==='thread/start'&&control.quotaUpdateOnThreadStart!==undefined)emit({method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:control.quotaUpdateOnThreadStart,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}}}});
  if(m.method==='account/read'&&control.accountUpdateOnRead&&!accountUpdateSent){
   accountUpdateSent=true;
   process.stdout.write(JSON.stringify({id:m.id,result})+'\n'+JSON.stringify({method:'account/updated',params:{authMode:loggedIn?'chatgpt':null}})+'\n');
  }else emit({id:m.id,result});
 };
 const replyDelay=m.method==='initialize'?control.initializeDelay:m.method==='turn/start'?control.turnStartDelay:m.method==='thread/start'?control.threadStartDelay:m.method==='thread/fork'?control.threadForkDelay:m.method==='skills/list'?control.skillsDelay:m.method==='account/rateLimits/read'?control.quotaReadDelay:0;
 if(replyDelay)setTimeout(reply,replyDelay);else reply();
 if(m.method==='turn/interrupt'){
  const current=activeTurns.get(p.threadId);if(current){clearTimeout(current.timer);activeTurns.delete(p.threadId);}
  if(current||!control.autoComplete)emit({method:'turn/completed',params:{threadId:p.threadId,turn:{id:current?.id||'turn-fixture',status:'interrupted'}}});
 }
});
