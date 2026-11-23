import test from 'node:test';
import assert from 'node:assert/strict';
import {getLocale,setLocale} from '../public/i18n.js';
import {chatError, refreshSampleCopy} from '../public/i18n-chat.js';
import {practiceBusinessFor} from '../public/practice.js';
import {projectDemo} from '../public/project-demo.js';

test('switching language refreshes only the original fictional sample text',async t=>{
  const previous=getLocale();t.after(()=>setLocale(previous));
  await setLocale('ja');
  const japanese=projectDemo(), current=structuredClone(japanese);
  const edited=current.chats[0];
  edited.title='私のタイトル';
  edited.messages[0].text='ユーザーが編集した本文';
  edited.messages.push({id:'user-addition',role:'user',text:'元の本文'});
  edited.status='completed';
  await setLocale('en');
  const english=projectDemo();
  refreshSampleCopy(current.chats,japanese.chats,english.chats);
  assert.equal(edited.title,'私のタイトル');
  assert.deepEqual(edited.messages.map(m=>m.text),['ユーザーが編集した本文','元の本文']);
  assert.equal(edited.status,'completed');
  assert.equal(current.chats[1].title,'Making search easier');
  assert.equal(current.chats[1].messages[0].text,'This conversation is part of the sample town.');
  assert.equal(practiceBusinessFor('en').request.includes('Do not use tools'),true);
  assert.equal(practiceBusinessFor('ja').marker,'業務確認:4827');
});

test('known scope and usage diagnostics follow the chosen language; other details survive verbatim',async t=>{
  const previous=getLocale();t.after(()=>setLocale(previous));
  await setLocale('en');
  assert.match(chatError('残枠が5%以下のため、新規送信を停止しています。'),/at or below 5%/);
  assert.match(chatError('Codexの作業フォルダを確認できません。 指示は送信していません。'),/work folder.*not sent/);
  assert.equal(chatError('Provider returned 独自エラー {reason}'),'Provider returned 独自エラー {reason}');
});

test('Teams stages and plugin notices change language while external messages and roles stay intact',async t=>{
  const before=getLocale();t.after(()=>setLocale(before));
  const {teamsQuestProgress}=await import('../public/teams-quest.js');
  const {toolText}=await import('../public/i18n-tools.js');
  await setLocale('en');
  const ready=teamsQuestProgress(null);
  assert.equal(ready.label,'Ready for the board');
  assert.equal(ready.steps.at(-1),'Send to Teams');
  const task={id:'t',runs:[{id:'work',status:'running'}]};
  const current=teamsQuestProgress(task,{party:{quest:{link:{todoId:'t',runId:'work'},steps:[{role:'担当者が指定した原文',status:'running'}]}}});
  assert.equal(current.detail,'Assigned to 担当者が指定した原文.');
  assert.equal(toolText('確認して送信'),'Confirm and send');
  assert.equal(toolText('キーを解除'),'Forget key');
  await setLocale('ja');
  assert.equal(teamsQuestProgress(null).steps.at(-1),'Teamsへ送信');
});
