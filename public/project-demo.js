import {ui} from './interface-language.js';
import { affinity, districtRoute } from './world-geography.js';

export function projectDemoJourneys(projects,chats,places){
 const journeys={}, counts=new Map();
 const assigned=new Set(projects.flatMap(p=>p.jobs.map(j=>j.conversationId).filter(Boolean)));
 for(const chat of chats){
  const from=chat.project?.id;
  if(!chat.demoTravel||assigned.has(chat.id)||!places[from]||(counts.get(from)||0)>=2)continue;
  const to=Object.keys(places).find(id=>id!==from&&affinity(places[from].evidence,places[id].evidence)>0);
  if(!to)continue;
  journeys[chat.id]={from,to,points:districtRoute(from,to,places)};
  counts.set(from,(counts.get(from)||0)+1);
 }
 return journeys;
}

export function projectDemo(){
 const chats=[],items=[ui('旅の手帳', "Travel journal"),ui('空の図書館', "Sky library"),ui('星見の工房', "Stargazer workshop")].map((name,i)=>{
  const id='sample-project-'+i,jobId='task-1',chatId='project-chat-'+i;
  const decision=ui('共有範囲の指定がないため、本人だけで使う設定で実装を進めます。', "No sharing scope was specified, so I am implementing the personal setting.");
  const jobs=[{id:'plan',kind:'plan',title:ui('調査と計画', "Research and plan"),status:'done',output:ui('目的と既存コードを調べました。', "Reviewed the goal and existing code."),dependencies:[]},{id:jobId,repoId:'r1',kind:i===1?'verify':'implement',title:[ui('履歴を探す機能', "History search"),ui('検索の動作確認', "Search verification"),ui('本人用の保存機能', "Personal storage")][i],status:i===1?'done':'running',conversationId:chatId,dependencies:['plan'],output:i===2?decision:i===1?ui('検索の動作確認を終えました。', "Search verification is complete."):ui('履歴を探す機能を実装しています。', "Implementing history search."),...(i===2?{decisions:[decision]}:{})}];
  chats.push({id:chatId,title:jobs[1].title,characterName:[ui('アルト', "Alto"),ui('ミラ', "Mira"),ui('セナ', "Sena")][i],status:i===1?'completed':'running',project:{id,jobId,repoId:'r1'},messages:[{id:'sample-msg-'+i,role:'assistant',text:i===2?decision:i===1?ui('検索の動作確認を終えました。', "Search verification is complete."):ui('この隊は', "This party is working on ")+jobs[1].title+ui('を担当しています。', ".")}]});
  for(let n=0;n<28;n++)chats.push({id:'project-resident-'+i+'-'+n,title:[ui('検索の使いやすさ', "Search usability"),ui('キーボード操作', "Keyboard navigation"),ui('会話の保存', "Saving conversations"),ui('読みやすい表示', "Readable layouts")][n%4],status:'completed',demoTravel:n===6||n===19,project:{id,jobId,repoId:'r1'},messages:[{id:'resident-msg-'+i+'-'+n,role:'user',text:ui('画面確認用の会話です。', "A sample conversation.")}]});
  return {id,name,goal:ui('使いやすく、毎日使いたくなる道具を作る', "Build a tool you'll enjoy using every day"),automatic:true,paused:false,repositories:[{id:'r1',name:['journal','library','studio'][i]}],jobs,events:[],pullRequests:[]};
 });return {chats,projects:{version:1,revision:0,items,activeCount:2,concurrency:2}};
}
