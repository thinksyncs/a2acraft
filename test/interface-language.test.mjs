import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeInterfaceLanguage, resolveInterfaceLanguage, interfaceLink, sampleChanges, restoreSampleChanges, ui} from '../public/interface-language.js';

test('a locale link overrides a saved choice; a fresh install uses the first supported browser language', () => {
  assert.equal(resolveInterfaceLanguage({requested:'en', saved:'ja', languages:['ja-JP']}), 'en');
  assert.equal(resolveInterfaceLanguage({requested:'de', saved:'ja', languages:['en-US']}), 'ja');
  assert.equal(resolveInterfaceLanguage({saved:'invalid', languages:['de', 'ja-JP', 'en-GB']}), 'ja');
  assert.equal(resolveInterfaceLanguage({languages:['en-AU', 'ja-JP']}), 'en');
  assert.equal(resolveInterfaceLanguage({languages:['de-DE']}), 'en');
  assert.equal(interfaceLink('/?demo=1&village=sample','http://localhost:4317/?lang=ja'), '/?demo=1&village=sample&lang=ja');
  assert.equal(interfaceLink('/','http://localhost:4317/?lang=invalid'), '/');
});

test('English village fixtures retain the same sixteen buildings and all four quest states', async () => {
  initializeInterfaceLanguage({requested:'en'});
  const {villageDemoChats, villageDemoActivityState} = await import('../public/village-demo.js');
  const {projectVillage} = await import('../public/village-model.js');
  const rows = villageDemoChats(), map = projectVillage(rows);
  assert.equal(rows.length, 168);
  assert.deepEqual(map.projects.map(p => p.stage), Array(4).fill(['planned','building','testing','complete']).flat());
  const sample = villageDemoActivityState({});
  assert.deepEqual(sample.todos.items.map(task => task.status), ['doing','todo','doing','done']);
  assert.equal(sample.todos.items[1].title, 'Design a recipe search site');

  const own = {id:'personal',title:'日報',characterName:'王様',messages:[{role:'user',text:'このまま保存'}]};
  assert.equal(projectVillage([own]).residents[0].name, own.characterName);
  const {encounterContextRows} = await import('../public/conversation-details.js');
  assert.ok(encounterContextRows(own).some(row => row.label === 'Latest request' && row.text === own.messages[0].text));
  assert.equal(ui('王様', 'King'), 'King');
  initializeInterfaceLanguage({requested:'ja'});
  assert.equal(ui('王様', 'King'), '王様');
});

test('switching sample language rebuilds authored fixtures and carries player chats and replies verbatim', () => {
  const initial = new Map([['sample',1]]);
  const player = {id:'user-1',role:'user',text:'日本語の入力を保持'};
  const added = {id:'custom',title:'自分の会話',messages:[player],status:'completed'};
  const changes = sampleChanges([{id:'sample',messages:[{text:'旧サンプル'},player],status:'completed'},added],initial);
  const next = [{id:'sample',messages:[{text:'New sample fixture'}]}];
  restoreSampleChanges(next,changes);
  assert.deepEqual(next[0].messages, [{text:'New sample fixture'}, player]);
  assert.deepEqual(next[1], added);
});
