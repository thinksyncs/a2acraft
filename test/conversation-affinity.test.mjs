import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConversationAffinity,CONVERSATION_AFFINITY_LIMITS as limits} from '../public/conversation-affinity.js';

const chat = (id,text,title='続きの確認') => ({id,title,messages:[{role:'user',text}]});
const examples = () => [
  chat('river','大陸の地形に沿って川を流す。川の流路と橋の位置、街道の交差点を整理する。'),
  chat('bridge','川の流路に合わせて橋を設置する。地形に沿って街道を通し、交差点を広くする。'),
  chat('medicine','膵臓がんの検診について偽陽性率と有病率を計算する。検診の陽性的中率を求める。'),
];

test('actual Japanese conversation gives related chats a shorter vector distance',()=>{
  const affinity=buildConversationAffinity(examples());
  assert.ok(affinity.similarity('river','bridge')>.35);
  assert.ok(affinity.distance('river','bridge')<affinity.distance('river','medicine'));
  assert.ok(affinity.similarity('river','medicine')<.05,'generic shared title is not a topic');
  assert.ok(affinity.terms('river').some(({term})=>term==='川'||term==='流路'));
});

test('titles supplement actual content but do not classify empty chats',()=>{
  const affinity=buildConversationAffinity([
    chat('a','river watershed valley','River atlas'),chat('b','pancreas screening prevalence','River atlas'),
    chat('empty','','River atlas'),{id:'tool',title:'River atlas',messages:[{role:'tool',text:'river watershed valley'}]},
  ]);
  assert.ok(affinity.similarity('a','b')<.08);
  assert.equal(affinity.hasContent('empty'),false);assert.equal(affinity.hasContent('tool'),false);
  assert.equal(affinity.similarity('empty','a'),0);assert.equal(affinity.distance('empty','a'),1);
});

test('assistant text contributes but code boilerplate and routine filler do not dominate',()=>{
  const a=chat('a','この変更を確認してください。\n```js\nconst alpha = await beta();\n```');
  a.messages.push({role:'assistant',text:'火山の噴火で溶岩と火山灰が堆積します。'});
  const b=chat('b','火山灰と溶岩の堆積、火山の噴火を調査する。');
  const c=chat('c','この変更を確認してください。\n```js\nconst alpha = await beta();\n```\n膵臓がんの検診と偽陽性率。');
  const affinity=buildConversationAffinity([a,b,c]);
  assert.ok(affinity.similarity('a','b')>affinity.similarity('a','c')+.35);
  assert.ok(!affinity.terms('a',384).some(({term})=>['const','alpha','beta','確認'].includes(term)));
});

test('stable IDs, symmetric scores and input-order-independent results do not mutate histories',()=>{
  const chats=examples(),before=structuredClone(chats);
  const first=buildConversationAffinity(chats),second=buildConversationAffinity([...chats].reverse());
  assert.deepEqual(first.ids,['bridge','medicine','river']);assert.equal(first.signature,second.signature);
  for(const a of first.ids)for(const b of first.ids){
    assert.equal(first.similarity(a,b),first.similarity(b,a));
    assert.equal(first.distance(a,b),second.distance(a,b));
    assert.ok(first.distance(a,b)>=0&&first.distance(a,b)<=1);
  }
  assert.equal(first.distance('river','river'),0);assert.equal(first.similarity('river','river'),1);
  assert.equal(first.similarity({id:'river'},{id:'bridge'}),first.similarity('river','bridge'));
  assert.equal(first.distance('unknown','unknown'),1);
  assert.deepEqual(chats,before);
});

test('long transcripts have bounded sampled text and sparse vectors while retaining recent topics',()=>{
  const large={id:'large',title:'長い履歴',messages:Array.from({length:3000},(_,index)=>({role:index%2?'assistant':'user',text:(index>2800?'川の流路と地形、街道の橋。':'星の観測と望遠鏡。').repeat(3000)}))};
  const affinity=buildConversationAffinity([large]);
  assert.equal(affinity.stats.sampledMessages,limits.messagesPerChat);
  assert.ok(affinity.stats.sampledCharacters<=limits.charactersPerChat);
  assert.ok(affinity.stats.maxDocumentTerms<=limits.termsPerChat);
  assert.ok(affinity.terms('large',384).some(({term})=>term==='川'||term==='流路'));
});

test('Japanese character fallback still relates shared topics without a segmenter',()=>{
  const original=Intl.Segmenter;
  try {
    Intl.Segmenter=undefined;
    const affinity=buildConversationAffinity(examples());
    assert.equal(affinity.stats.tokenizer,'character-bigram');
    assert.ok(affinity.similarity('river','bridge')>affinity.similarity('river','medicine')+.2);
  } finally {Intl.Segmenter=original;}
});

test('invalid records and repeated IDs cannot alter counts based on input order',()=>{
  const chats=[null,{},chat('a','森林の植生と野鳥。'),chat('a','川の流路と橋。'),chat('b','川の流路と橋。')];
  const a=buildConversationAffinity(chats),b=buildConversationAffinity([...chats].reverse());
  assert.deepEqual(a.ids,['a','b']);assert.equal(a.signature,b.signature);
  assert.equal(a.similarity('a','b'),b.similarity('a','b'));
  assert.deepEqual(buildConversationAffinity(null).ids,[]);
});
