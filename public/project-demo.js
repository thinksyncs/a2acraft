import {chatText} from './i18n-chat.js';
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
 const chats=[],items=[chatText('旅の手帳'),chatText('空の図書館'),chatText('星見の工房')].map((name,i)=>{
  const id='sample-project-'+i,jobId='task-1',chatId='project-chat-'+i;
  const decision=chatText('共有範囲の指定がないため、本人だけで使う設定で実装を進めます。');
  const jobs=[{id:'plan',kind:'plan',title:chatText('調査と計画'),status:'done',output:chatText('目的と既存コードを調べました。'),dependencies:[]},{id:jobId,repoId:'r1',kind:i===1?'verify':'implement',title:[chatText('履歴を探す機能'),chatText('検索の動作確認'),chatText('本人用の保存機能')][i],status:i===1?'done':'running',conversationId:chatId,dependencies:['plan'],output:i===2?decision:i===1?chatText('検索の動作確認を終えました。'):chatText('履歴を探す機能を実装しています。'),...(i===2?{decisions:[decision]}:{})}];
  chats.push({id:chatId,title:jobs[1].title,characterName:[chatText('アルト'),chatText('ミラ'),chatText('セナ')][i],status:i===1?'completed':'running',project:{id,jobId,repoId:'r1'},messages:[{id:'sample-msg-'+i,role:'assistant',text:i===2?decision:i===1?chatText('検索の動作確認を終えました。'):chatText('この隊は{title}を担当しています。',{title:jobs[1].title})}]});
  for(let n=0;n<28;n++)chats.push({id:'project-resident-'+i+'-'+n,title:[chatText('検索の使いやすさ'),chatText('キーボード操作'),chatText('会話の保存'),chatText('読みやすい表示')][n%4],status:'completed',demoTravel:n===6||n===19,project:{id,jobId,repoId:'r1'},messages:[{id:'resident-msg-'+i+'-'+n,role:'user',text:chatText('画面確認用の会話です。')}]});
  return {id,name,goal:chatText('使いやすく、毎日使いたくなる道具を作る'),automatic:true,paused:false,repositories:[{id:'r1',name:['journal','library','studio'][i]}],jobs,events:[],pullRequests:[]};
 });return {chats,projects:{version:1,revision:0,items,activeCount:2,concurrency:2}};
}
