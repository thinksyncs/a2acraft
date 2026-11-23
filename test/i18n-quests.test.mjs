import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale} from '../public/i18n.js';
import {questText} from '../public/i18n-quests.js';
import {castleMembers, castleReadiness} from '../public/castle.js';
import {demoEquipmentSkills, equipmentPresentation, skillAppearance, skillTokenEstimate, slotLabels} from '../public/equipment-catalog.js';

test('equipment changes language while its identity, effect, price and user metadata are preserved', async () => {
  await setLocale('ja');
  const bow = structuredClone(demoEquipmentSkills.find(skill => skill.name === 'shared-gmail-workflow'));
  const before = structuredClone(bow);
  const price = skillTokenEstimate(bow);
  assert.equal(equipmentPresentation(bow).itemName, '便りの弓');
  const generated = skillAppearance('custom-build-tool');
  await setLocale('en');
  try {
    const translated = equipmentPresentation(bow);
    assert.equal(translated.itemName, 'Courier’s Bow');
    assert.equal(translated.displayName, 'Email delivery');
    assert.match(translated.description, /recipient/);
    assert.equal(translated.id, bow.id);
    assert.equal(translated.singleUse, true);
    assert.equal(translated.slot, bow.slot);
    assert.equal(slotLabels.weapon, 'Weapon');
    const custom = skillAppearance('custom-build-tool');
    assert.equal(custom.rune, generated.rune);
    assert.equal(custom.icon, generated.icon);
    assert.doesNotMatch(custom.itemName, /[ぁ-ヿ一-龯]/u);
    const currentPrice = skillTokenEstimate(bow);
    assert.deepEqual([currentPrice.minTokens, currentPrice.maxTokens], [price.minTokens, price.maxTokens]);
    assert.doesNotMatch(currentPrice.scope, /[ぁ-ヿ一-龯]/u);
    const own = {...bow, description:'手書きの説明', displayName:'自分の道具'};
    assert.equal(equipmentPresentation(own).description, own.description);
    assert.equal(equipmentPresentation(own).displayName, own.displayName);
    assert.deepEqual(bow, before);
  } finally { await setLocale('ja'); }
  assert.equal(equipmentPresentation(bow).displayName, before.displayName);
});

test('English castle guidance keeps player-provided titles and roles verbatim', async () => {
  await setLocale('en');
  try {
    assert.equal(castleReadiness({connected:false}), 'Connect to Codex before setting out.');
    assert.match(castleReadiness({model:{model:'sample'},chats:[]}), /Choose 2 to 8/);
    const stored = {leaderId:'one',members:[{conversationId:'one',role:'支援と執筆'}]};
    const [member] = castleMembers(stored,[{id:'one', title:'私の工房'}]);
    assert.deepEqual([member.name, member.role],['私の工房','支援と執筆']);
    assert.equal(questText('王城で受けた仕事 · クエスト {order} / {total} · {location}', {order:1,total:2,location:'Workshop'}), 'Castle request · Quest 1 of 2 · Workshop');
  } finally { await setLocale('ja'); }
});

test('English adventure regions and live requests keep IDs, source boundaries and custom text', async () => {
  const {adventureRegions,adventureRegionsFor,adventureProgress}=await import('../public/adventure-world.js');
  const {adventureRequest}=await import('../adventure.mjs');
  const places=adventureRegionsFor('en');
  assert.deepEqual(places.map(region=>region.id),adventureRegions.map(region=>region.id));
  assert.deepEqual(places.map(region=>region.roles.length),[1,2,3,4]);
  for(const region of places)assert.doesNotMatch([region.name,region.prompt,region.ability,...region.roles].join(' '),/[ぁ-ヿ一-龯]/u);
  const input={locale:'en',regionId:'library',text:'私が入力した要望',sourceA:'手書きA',sourceB:'B'};
  const plan=adventureRequest(input,adventureProgress({completed:['village','forest']}),['a','b','c'].map(id=>({id})));
  assert.match(plan.text,/Answer in English/);
  assert.match(plan.text,/permissions or read-only settings/);
  assert.deepEqual(JSON.parse(plan.text.split('\n\n').at(-1)),{request:input.text,sourceA:input.sourceA,sourceB:input.sourceB});
  assert.deepEqual(plan.party.partyOverride.members.map(member=>member.role),places[2].roles);
  assert.equal(adventureRegionsFor('ja')[2].name,'知恵の図書館');
  assert.throws(()=>adventureRequest(input,adventureProgress({}),[]));
});

test('an English daily report preserves the original conversation text and event counts', async () => {
  const {buildDailyReport,dailyReportMarkdown}=await import('../public/daily-report.js');
  await setLocale('en');
  try {
    const report=buildDailyReport({date:'2026-11-22',timeZone:'UTC',conversations:[{id:'a',title:'依頼した人の題名',messages:[{id:'m',role:'user',text:'利用者の原文',createdAt:Date.parse('2026-11-22T12:00:00Z')}]}]});
    const markdown=dailyReportMarkdown(report);
    assert.match(markdown,/^# Daily report 2026-11-22/m);
    assert.match(markdown,/## Report coverage/);
    assert.match(markdown,/## Recorded activity/);
    assert.match(markdown,/依頼した人の題名/);
    assert.match(markdown,/利用者の原文/);
    assert.equal(report.counts.messages,1);
  } finally { await setLocale('ja'); }
});
