import {toolText} from './i18n-tools.js';
const stages=['掲示板に受付','仲間が集合','役割ごとに処理','リーダーのまとめ','返信を確認','Teamsへ送信'];
const sameTarget=(a,b)=>a?.kind===b?.kind&&(a?.kind==='chat'?a.chatId===b.chatId:a?.kind==='channel'&&a.teamId===b.teamId&&a.channelId===b.channelId&&a.messageId===b.messageId);

export function teamsTodoForDraft(items,draft){
  if(!draft)return null;
  return (items||[]).find(item=>item.source?.provider==='teams'&&item.source.configurationKey===draft.configurationKey&&item.source.messageId===draft.source?.id&&sameTarget(item.source.target,draft.target))||null;
}

// Processing a TODO and sending a reply are separate durable events. A reply
// counts toward this quest only after its exact completed run was adopted.
export function teamsQuestProgress(todo,state={}){
  const result={phase:'unregistered',label:toolText('掲示板へ渡せます'),detail:toolText('仲間が依頼を検討し、最後にリーダーが返信案をまとめます。'),error:'',index:-1,steps:stages.map(stage=>toolText(stage)),draftId:todo?.source?.draftId||null};
  if(!todo)return result;
  const run=todo.runs?.at(-1),quest=state.party?.quest,dispatch=state.boardDispatch?.active;
  const activeQuest=quest?.link?.todoId===todo.id&&quest?.link?.runId===run?.id?quest:null;
  const activeDispatch=dispatch?.todoId===todo.id?dispatch:null;
  const draft=state.teamsDrafts?.items?.find(item=>item.id===result.draftId);
  const adopted=run?.status==='completed'&&todo.status==='done'&&draft?.questResult?.todoId===todo.id&&draft.questResult.runId===run.id;
  if(adopted){
    const labels={draft:toolText('返信を確認'),reviewed:toolText('送信前の確認済み'),sending:toolText('送信結果を確認中'),sent:toolText('Teamsへ送信済み'),uncertain:toolText('送信結果が不明'),failed:toolText('返信の処理に失敗'),generating:toolText('返信案を調整中')};
    return {...result,phase:draft.status,label:labels[draft.status]||toolText('返信を確認'),detail:draft.status==='sent'?toolText('確認した返信をTeamsへ送りました。'):toolText('宛先と本文を確認してから送信してください。'),error:draft.error||'',index:['sending','sent','uncertain'].includes(draft.status)?5:4};
  }
  if(todo.status==='done'&&run?.status==='completed')return {...result,phase:'result_ready',label:toolText('成果を確認'),detail:toolText('リーダーのまとめが完成しました。内容を確認して返信案に使えます。'),index:4};
  if(['paused','cancelled','failed'].includes(run?.status)||activeQuest?.status==='paused')return {...result,phase:'paused',label:toolText('処理が中断'),detail:toolText('TODOの実行履歴で停止理由を確認してください。'),error:run?.error||activeQuest?.error||'',index:2};
  if(activeDispatch&&['blocked','uncertain','cancelled'].includes(activeDispatch.status))return {...result,phase:'blocked',label:toolText('募集・開始を停止'),detail:toolText('掲示板で停止理由を確認してください。'),error:activeDispatch.error||'',index:1};
  if(activeDispatch?.status==='gathering')return {...result,phase:'gathering',label:toolText('仲間が集合中'),detail:toolText('マップで掲示板に集まる様子を見られます。'),index:1};
  if(run?.status==='running'||activeQuest&&['running','stopping'].includes(activeQuest.status)){
    const step=activeQuest?.steps?.find(step=>step.status==='running'),summary=step?.kind==='summary';
    return {...result,phase:summary?'summary':'processing',label:summary?toolText('リーダーがまとめ中'):toolText('役割ごとに処理中'),detail:step?.role?toolText('{role}が担当しています。', {role:step.role}):toolText('仲間が順番に依頼を処理しています。'),index:summary?3:2};
  }
  return {...result,phase:'registered',label:toolText('掲示板で受付済み'),detail:state.plugins?.teams?.enabled===false?toolText('TeamsプラグインがOFFです。接続設定でONにすると巡回の対象になります。'):state.boardDispatch?.enabled?toolText('自動巡回が、開始できる依頼から仲間を募集します。'):toolText('掲示板で自動巡回をONにすると、役割の合う仲間が集まります。'),index:0};
}
