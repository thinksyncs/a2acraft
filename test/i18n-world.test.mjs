import test from 'node:test';
import assert from 'node:assert/strict';
import {getLocale, setLocale} from '../public/i18n.js';
import {roomConversation} from '../public/world-room.js';
import {villageDemoChats, villageDemoActivityState} from '../public/village-demo.js';
import {residentDemoReply} from '../public/resident-demo.js';
import {projectVillage} from '../public/village-model.js';
import {assignCharacterNames} from '../public/character-names.js';
import {villageConversationContext} from '../public/village-context.js';
import {VILLAGE_PLACES} from '../public/village-world.js';
import {createTeamChat} from '../public/village-team-chat.js';
import {buildResidentContext,residentPartyKey,residentSquadParty} from '../public/resident-companions.js';

test('switching languages preserves the sample world, encounter IDs and actual transcripts', async t => {
  const original=getLocale();
  t.after(()=>setLocale(original));
  await setLocale('ja');
  const jp=villageDemoChats(), expected=projectVillage(jp,[]).stats;
  const text='最新の依頼 — 私の原文 {name}';
  const real={id:'real',title:'武器屋',characterName:'リナ',messages:[{role:'user',text}]};
  const partyName='写真工房';
  for (const locale of ['en','ja','en']) {
    await setLocale(locale);
    const english=locale==='en', chats=villageDemoChats(), state=villageDemoActivityState({});
    assert.deepEqual(chats.map(chat=>chat.id),jp.map(chat=>chat.id));
    assert.deepEqual(projectVillage(chats,[]).stats,expected);
    assert.equal(chats.length,168);
    assert.equal(state.todos.items.length,4);
    if(english)assert.doesNotMatch(JSON.stringify([chats,state]),/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    assert.equal(VILLAGE_PLACES[1].shortName,english?'Castle':'お城');
    assert.equal(villageConversationContext(real).text,text);
    assert.equal(villageConversationContext(real).label,english?'Recent request':'直近の依頼');
    const reply=roomConversation('castle',{id:'test',status:'running',party:{name:partyName},steps:[]});
    assert.ok(reply.answer.includes(partyName));
    assert.equal(reply.record.questId,'test');
    const hikingChat=chats.find(chat=>chat.title.startsWith(english?'Packing for a hike':'山歩きの準備'));
    assert.match(residentDemoReply(hikingChat, english?'Where do I pack water?':'水はどこに入れよう？'),english?/side pocket/:/横ポケット/);
    const unnamed={id:'fresh'};assignCharacterNames([real,unnamed],{random:()=>0});
    assert.equal(unnamed.characterName,english?'Rion':'リオン'); assert.equal(real.characterName,'リナ');
  }
});

test('English map composer keeps the original saved draft, speaker name and reply verbatim', async t => {
  const original=getLocale(), savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(async()=>{await setLocale(original); if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete globalThis.document;});
  const ids=new Map();
  function node(tag){return {tag, children:[], set id(v){ids.set(v,this);}, append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this[k]=v;} };}
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:node}});
  await setLocale('en');
  const chat={id:'one',characterName:'武器屋',messages:[{role:'assistant',text:'村人を探す'}]}, draft='送信';
  const {element,render}=createTeamChat({target:()=>({chat,permitted:true}),messaging:{read:()=>({draft,reason:''})}});
  render();
  assert.equal(element.children[0].textContent,'Chat with 武器屋');
  assert.equal(element.children[1].children[0].children[1].textContent,'村人を探す');
  assert.equal(ids.get('village-team-message').value,draft);
  assert.equal(ids.get('village-team-message').placeholder,'Message…');
});

test('English map visits validate on a Japanese backend for solo tasks and old parties without a role', async t => {
  const original=getLocale();
  t.after(()=>setLocale(original));
  const chats=[{id:'worker',title:'My chat'},{id:'resident',title:'My resident'}];
  const state={party:{party:{leaderId:'worker',members:[{conversationId:'worker'}]}},todos:{items:[
    {id:'solo',title:'My task',status:'todo',assignee:{type:'chat',conversationId:'worker'}},
    {id:'legacy',title:'Our task',status:'todo',assignee:{type:'party'}},
  ]}};
  for(const [task,storedRole,display] of [['solo','担当チャット','Assigned chat'],['legacy','担当','Assignee']]){
    const squadId='todo:'+task;
    await setLocale('en');
    const shown=residentSquadParty(squadId,state,chats);
    assert.equal(shown.members[0].role,storedRole);
    assert.equal(shown.members[0].roleLabel,display);
    const visit={source:'village',squadId,partyKey:residentPartyKey(shown)};
    await setLocale('ja');
    const result=buildResidentContext({visit,conversation:chats[1],conversations:chats,getVillageState:()=>state});
    assert.equal(result.metadata.partyKey,visit.partyKey);
    assert.equal(result.metadata.companions[0].role,storedRole);
  }
  await setLocale('en');
  state.party.party.members[0].role='担当';
  const authored=residentSquadParty('todo:legacy',state,chats).members[0];
  assert.equal(authored.role,'担当'); assert.equal(authored.roleLabel,undefined);
});
