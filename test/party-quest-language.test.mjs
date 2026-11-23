import test from 'node:test';
import assert from 'node:assert/strict';
import {getLocale, setLocale} from '../public/i18n.js';
import {initParty} from '../public/party.js';
import {PartyRunner, partyPrompt} from '../public/party-runner.js';
import {villageDemoActivityState} from '../public/village-demo.js';
import {villageInvitation, assertVillageInvitation} from '../public/village-initiative.js';
import {TodoStore} from '../todos.mjs';

test('an accepted sample quest keeps its language on resume and preserves player text across a switch', async t => {
  const original = getLocale();
  t.after(() => setLocale(original));
  await setLocale('en');
  const sample = villageDemoActivityState({});
  const task = structuredClone(sample.todos.items.find(item => item.id === 'village-sample-wait'));
  const party = structuredClone(sample.party.party);
  task.description = '利用者の依頼文';
  party.members[0].role = '私の役割';
  const accepted = villageInvitation(task, party);
  assertVillageInvitation(task, party, accepted.version);

  const chats = party.members.map(member => ({id:member.conversationId, title:member.conversationId}));
  const prompts = [];
  const runner = new PartyRunner({getConversations:() => chats, execute:async ({prompt}) => {
    prompts.push(prompt);
    return {output:'利用者の成果'};
  }});
  const store = new TodoStore('.');
  const text = store.prompt(task, getLocale());
  assert.match(text, /Completion criteria:/);
  await runner.start({partyOverride:party, model:'demo', text, locale:getLocale()});
  await runner.task;
  const saved = runner.public().quest;
  assert.equal(saved.status, 'completed');
  assert.match(prompts[0], /Your role: 私の役割/);
  assert.match(prompts[0], /利用者の依頼文/);
  assert.match(prompts.at(-1), /Leader’s final report/);
  assert.match(prompts.at(-1), /利用者の成果/);

  await setLocale('ja');
  const checkpoint = structuredClone(saved);
  checkpoint.status = 'paused';
  checkpoint.steps.at(-1).status = 'pending';
  checkpoint.steps.at(-1).output = '';
  const resumedPrompts = [];
  const resumed = await new PartyRunner({getConversations:() => chats,
    read:async () => ({...runner.public(), quest:checkpoint}),
    execute:async ({prompt}) => {resumedPrompts.push(prompt); return {output:'確認済み'};},
  }).load();
  await resumed.resume();
  await resumed.task;
  assert.equal(resumed.public().quest.status, 'completed');
  assert.equal(resumedPrompts.length, 1);
  assert.match(resumedPrompts[0], /Your role: Leader’s final report/);
  assert.match(resumedPrompts[0], /利用者の依頼文/);
  assert.equal(saved.party.members[0].role, '私の役割');
  assert.equal(saved.text, text);
  const legacy = {...saved};
  delete legacy.locale;
  assert.match(partyPrompt(legacy, saved.steps[0]), /あなたの役割: 私の役割/);
  assert.match(store.prompt(task, 'ja'), /達成条件:/);
});

test('the castle and tavern start and validate the original quest draft', async t => {
  const original = getLocale();
  await setLocale('en');
  const element = () => ({dataset:{}, children:[], value:'', append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;}, addEventListener(){}});
  const bySelector = new Map();
  const doc = {createElement:element, querySelector(selector){
    if (!bySelector.has(selector)) bySelector.set(selector, element());
    return bySelector.get(selector);
  }};
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true,value:doc});
  t.after(async () => {
    await setLocale(original);
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const requests = [];
  const state = {party:{name:'My party', members:[]}, quest:null};
  const controller = initParty({demo:false, getChats:() => [], getState:() => state, getModel:() => ({model:'demo'}),
    canConnect:() => true, onState(){}, api:async (route, body) => {requests.push({route,body}); return state;}});
  await assert.rejects(controller.startQuest(''), /Enter a quest/);
  await controller.startQuest('作者の依頼');
  doc.querySelector('#party-quest').value = '入力した依頼';
  await doc.querySelector('#party-start').onclick();
  assert.deepEqual(requests.map(req => req.route), ['party/configure','party/start','party/configure','party/start']);
  assert.deepEqual(requests.filter(req => req.route==='party/start').map(req => req.body), [
    {text:'作者の依頼', model:'demo', locale:'en'}, {text:'入力した依頼', model:'demo', locale:'en'},
  ]);
  assert.equal(doc.querySelector('#party-notice').textContent, 'Quest given to the party.');
});
