// Explicit display fixture only. No sessions, model calls, jobs, or party membership are created.
export function withAgentDelegationSample(chats, {enabled = false} = {}) {
  if (!enabled || !Array.isArray(chats) || !chats.length) return chats;
  const parent = chats.find(chat => chat.id === 'village-demo-1') ||
    chats.find(chat => chat.id === 'project-resident-0-0') || chats.find(chat => chat.id === 'demo1');
  if (!parent) return chats;
  const rootThreadId = 'subagent-sample-root-' + parent.id;
  const updatedAt = Date.UTC(2026, 10, 8, 0);
  const result = '入力条件と例外時の動作を確認する項目を整理しました。';
  const total = {totalTokens: 1200, inputTokens: 950, cachedInputTokens: 400,
    cacheWriteInputTokens: null, outputTokens: 250, reasoningOutputTokens: 80};
  const delegation = {version: 1, revision: 1, rootThreadId, updatedAt, truncated: false, agents: [
    {threadId: 'subagent-sample-review', parentThreadId: rootThreadId, name: 'ミラ', role: '確認項目を整理する',
      status: 'completed', turnId: 'subagent-sample-turn-review', usage: {total, last: {...total}, modelContextWindow: 128000},
      returnedText: result, returnedCharacters: [...result].length, updatedAt},
    {threadId: 'subagent-sample-research', parentThreadId: rootThreadId, name: 'テオ', role: '画面の使い方を調べる',
      status: 'waiting', turnId: null, usage: null, returnedText: null, returnedCharacters: null, updatedAt},
  ]};
  return chats.map(chat => chat === parent ? {...chat, threadId: rootThreadId, delegation} : chat);
}
