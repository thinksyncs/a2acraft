// Local lexical affinity, not a remote embedding or a classification by title.
// Sampling keeps old imported transcripts from monopolising the UI thread.
export const CONVERSATION_AFFINITY_LIMITS = Object.freeze({
  messagesPerChat: 64, charactersPerChat: 24000, charactersPerMessage: 2400,
  titleCharacters: 240, termsPerChat: 384, cachedPairs: 4096,
});
const VERSION = 'tfidf-ja-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const stop = new Set((
  'the a an and or of to for from with without in on at by as is are was were be been being ' +
  'it its this that these those i me my we our you your they their he she not no yes can could ' +
  'would should will do does did have has had if else then than when where which what how ' +
  'please thanks thank ok done next continue change changes update fix implement implementation ' +
  'check checked confirm confirmation result results task work code file files function return ' +
  'const let var import export default async await null undefined true false string number object ' +
  'array error test tests console log new chat conversation assistant user codex chatgpt ' +
  'これ それ あれ この その あの こちら そちら 私 自分 あなた 今回 前回 現在 次 最後 最初 ' +
  '内容 作業 対応 確認 修正 変更 実装 実行 完了 結果 手順 方法 続き 続行 継続 必要 可能 ' +
  '問題 不具合 場合 予定 以下 以上 部分 ため こと もの よう とき ところ お願い ありがとう ' +
  '了解 承知 はい いいえ コード ファイル テスト チャット 会話 ソース アシスタント ユーザー ' +
  'する した して です ます ください 欲しい ほしい できる できた ない ある いる なる ' +
  '方 中 後 前 上 下 等 他 件 点 名 分 日 月 年 度 先 今 全て 全体 一部 同じ 新しい 古い'
).split(/\s+/));

function segmenter() {
  try { return typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('ja', {granularity:'word'}) : null; }
  catch { return null; }
}

function clean(value) {
  return value.normalize('NFKC').toLowerCase()
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/<[^>\n]{0,300}>/g, ' ')
    .replace(/https?:\/\/[^\s<>]+/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\b[a-f0-9]{12,}\b/g, ' ');
}

function useful(term) {
  if (!term || stop.has(term) || /^\p{Number}+$/u.test(term)) return false;
  if (/^\p{Script=Hiragana}+$/u.test(term)) return false;
  if (term.length === 1) return /\p{Script=Han}/u.test(term);
  return term.length <= 48 && /[\p{Letter}\p{Number}]/u.test(term);
}

function words(value, tokenizer) {
  const text = clean(value), terms = [];
  if (tokenizer) {
    for (const part of tokenizer.segment(text)) {
      if (!part.isWordLike) continue;
      for (const term of part.segment.split(/[_\-+]+/)) if (useful(term)) terms.push(term);
    }
    return terms;
  }
  // No dictionary is required on runtimes without Intl.Segmenter. Character
  // bigrams preserve Japanese overlaps; Latin words remain whole words.
  for (const match of text.matchAll(/[\p{Script=Latin}\p{Number}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu)) {
    const term = match[0];
    if (/^[\p{Script=Latin}\p{Number}]+$/u.test(term)) { if (useful(term)) terms.push(term); continue; }
    if (stop.has(term)) continue;
    if (term.length <= 2) { if (useful(term)) terms.push(term); continue; }
    for (let i = 0; i + 1 < term.length; i++) {
      const pair = term.slice(i, i + 2);
      if (useful(pair) && !/^\p{Script=Hiragana}+$/u.test(pair)) terms.push(pair);
    }
  }
  return terms;
}

function documentFor(chat, tokenizer) {
  const limits = CONVERSATION_AFFINITY_LIMITS;
  const messages = (Array.isArray(chat.messages) ? chat.messages : []).filter(message =>
    ['user','assistant'].includes(message?.role) && typeof message.text === 'string' && message.text.length);
  const count = Math.min(limits.messagesPerChat, messages.length);
  const budget = Math.min(limits.charactersPerMessage, Math.floor(limits.charactersPerChat / Math.max(1, count)));
  const counts = new Map(); let sampledCharacters = 0;
  const add = (text, weight) => {
    for (const term of words(text, tokenizer)) counts.set(term, Math.min(64, (counts.get(term) || 0) + weight));
  };
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? messages.length - 1 : Math.round(i * (messages.length - 1) / (count - 1));
    const text = messages[index].text.slice(0, budget);
    sampledCharacters += text.length; add(text, 1);
  }
  // A shared generic title must not manufacture a relationship between empty
  // chats. Titles only supplement substantive user/assistant content.
  if (counts.size && typeof chat.title === 'string') add(chat.title.slice(0, limits.titleCharacters), .2);
  const terms = [...counts].sort((a,b) => b[1] - a[1] || compare(a[0],b[0]))
    .slice(0, limits.termsPerChat).sort((a,b) => compare(a[0],b[0]));
  return {terms, sampledCharacters, sampledMessages:count, sourceMessages:messages.length};
}

function fingerprint(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8,'0');
}

export function buildConversationAffinity(chats) {
  const tokenizer = segmenter(), documents = new Map();
  for (const chat of Array.isArray(chats) ? chats : []) {
    if (typeof chat?.id !== 'string' || !chat.id) continue;
    const document = documentFor(chat, tokenizer), key = JSON.stringify(document.terms);
    // Duplicate IDs should not double their influence or depend on input order.
    const prior = documents.get(chat.id);
    if (!prior || compare(key, prior.key) > 0) documents.set(chat.id, {...document,key});
  }
  const ids = [...documents.keys()].sort(compare), frequency = new Map(), vectors = new Map();
  const active = ids.filter(id => documents.get(id).terms.length);
  for (const id of active) for (const [term] of documents.get(id).terms)
    frequency.set(term, (frequency.get(term) || 0) + 1);
  for (const id of ids) {
    const entries = documents.get(id).terms.map(([term,count]) =>
      [term, Math.log1p(count) * (1 + Math.log((active.length + 1) / (frequency.get(term) + 1)))]);
    const length = Math.hypot(...entries.map(([,weight]) => weight));
    vectors.set(id, new Map(entries.map(([term,weight]) => [term, weight / length])));
  }
  const idOf = value => typeof value === 'string' ? value : value?.id;
  const cache = new Map();
  function similarity(a, b) {
    let left = idOf(a), right = idOf(b);
    if (compare(left, right) > 0) [left,right] = [right,left];
    let x = vectors.get(left), y = vectors.get(right);
    if (!x?.size || !y?.size) return 0;
    if (left === right) return 1;
    const key = JSON.stringify([left,right]);
    if (cache.has(key)) return cache.get(key);
    if (x.size > y.size) [x,y] = [y,x];
    let dot = 0;
    for (const [term,weight] of x) dot += weight * (y.get(term) || 0);
    const result = Math.max(0, Math.min(1, dot));
    if (cache.size >= CONVERSATION_AFFINITY_LIMITS.cachedPairs) cache.delete(cache.keys().next().value);
    cache.set(key,result); return result;
  }
  return {
    version:VERSION,
    signature:fingerprint(JSON.stringify(ids.map(id => [id,documents.get(id).terms]))),
    ids,
    similarity,
    distance(a,b) { return idOf(a) === idOf(b) && vectors.has(idOf(a)) ? 0 : Math.sqrt(1 - similarity(a,b)); },
    hasContent(id) { return Boolean(vectors.get(idOf(id))?.size); },
    terms(id,limit=8) { return [...(vectors.get(idOf(id)) || [])]
      .sort((a,b) => b[1] - a[1] || compare(a[0],b[0])).slice(0,Math.max(0,Math.min(384,limit)))
      .map(([term,weight]) => ({term,weight})); },
    stats:{chats:ids.length,contentChats:active.length,vocabulary:frequency.size,
      sampledMessages:ids.reduce((sum,id) => sum + documents.get(id).sampledMessages,0),
      sampledCharacters:ids.reduce((sum,id) => sum + documents.get(id).sampledCharacters,0),
      maxDocumentTerms:ids.reduce((max,id) => Math.max(max,documents.get(id).terms.length),0),
      tokenizer:tokenizer ? 'intl-ja-word' : 'character-bigram'},
  };
}
