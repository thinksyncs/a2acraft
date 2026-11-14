const statusLabels = {
  pendingInit: '準備中', running: '作業中', waiting: '待機中', completed: '完了',
  interrupted: '中断', errored: 'エラー', shutdown: '終了', notFound: '見つかりません', unknown: '状態未確認',
};
const tokenFields = [
  ['totalTokens', '合計'], ['inputTokens', '入力'], ['cachedInputTokens', 'キャッシュ入力'],
  ['cacheWriteInputTokens', 'キャッシュ書込'], ['outputTokens', '出力'], ['reasoningOutputTokens', '推論出力'],
];
const knownCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const words = value => typeof value === 'string' && value.trim() ? value : null;
const count = value => value.toLocaleString('ja-JP');

// Missing provider measurements stay missing; no summing subtotals or estimating savings.
export function delegationUsageRows(usage) {
  if (!usage || typeof usage !== 'object') return [];
  const rows = [];
  for (const [key, label] of [['total', '累計トークン'], ['last', '直近のトークン']]) {
    const values = tokenFields.filter(([field]) => knownCount(usage[key]?.[field]))
      .map(([field, title]) => `${title} ${count(usage[key][field])}`);
    if (values.length) rows.push({label, value: values.join(' / ') + ' tokens'});
  }
  if (knownCount(usage.modelContextWindow)) rows.push({label: 'コンテキスト上限', value: count(usage.modelContextWindow) + ' tokens'});
  return rows;
}

// Only the explicit App Server delegation projection is considered. Party members are separate peers.
export function delegationViewModel(chat) {
  const source = chat?.delegation;
  if (source?.version !== 1 || !words(source.rootThreadId) || source.rootThreadId !== chat.threadId || !Array.isArray(source.agents)) return null;
  const unique = new Map();
  for (const agent of source.agents.slice(0, 100)) {
    if (!words(agent?.threadId) || agent.threadId === source.rootThreadId || unique.has(agent.threadId)) continue;
    unique.set(agent.threadId, agent);
  }
  const ordered = [], visited = new Set();
  function visit(agent, depth) {
    if (visited.has(agent.threadId)) return;
    visited.add(agent.threadId);
    ordered.push({agent, depth: Math.min(depth, 8)});
    for (const child of unique.values()) if (child.parentThreadId === agent.threadId) visit(child, depth + 1);
  }
  for (const agent of unique.values()) if (!unique.has(agent.parentThreadId)) visit(agent, 0);
  // Malformed cycles must never hang the interface or silently hide an agent.
  for (const agent of unique.values()) if (!visited.has(agent.threadId)) visit(agent, 0);
  if (!ordered.length) return null;
  const agents = ordered.map(({agent, depth}, index) => ({
    id: agent.threadId,
    name: words(agent.name) || `補助エージェント ${index + 1}`,
    role: words(agent.role) || '役割未取得',
    status: Object.hasOwn(statusLabels, agent.status) ? agent.status : 'unknown',
    statusLabel: Object.hasOwn(statusLabels, agent.status) ? statusLabels[agent.status] : statusLabels.unknown,
    parentLabel: unique.has(agent.parentThreadId) ? words(unique.get(agent.parentThreadId).name) || '別の補助エージェント' :
      agent.parentThreadId === source.rootThreadId ? 'この会話' : '親スレッド未取得',
    depth,
    result: words(agent.returnedText),
    resultTruncated: agent.returnedTextTruncated === true,
    returnedCharacters: knownCount(agent.returnedCharacters) ? agent.returnedCharacters : null,
    usage: delegationUsageRows(agent.usage),
  }));
  const truncated = source.truncated === true || source.agents.length > 100;
  return {agents, truncated, title: `補助エージェント ${agents.length}人${truncated ? 'を表示 · 一部省略' : ''}`};
}

const panels = new WeakMap();
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function renderAgentDelegation(host, chat, {sample = false} = {}) {
  const model = delegationViewModel(chat);
  let panel = panels.get(host);
  if (!model) {
    panel?.root.remove(); panels.delete(host); return;
  }
  const messages = host.querySelector('.messages');
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
  if (!panel) {
    const root = element('details', 'agent-delegation');
    const summary = element('summary', 'agent-delegation-summary');
    const body = element('div', 'agent-delegation-body');
    root.append(summary, body);
    panel = {root, summary, body, snapshot: ''}; panels.set(host, panel);
  }
  // The parent renderer may append new messages or progress on every update.
  // Keep this separate section last in the same scroll area, even for unchanged telemetry.
  if (messages.lastElementChild !== panel.root) {
    const focused = panel.root.contains(document.activeElement) ? document.activeElement : null;
    messages.append(panel.root);
    focused?.focus({preventScroll: true});
  }
  const snapshot = JSON.stringify([model, sample]);
  if (snapshot === panel.snapshot) return;
  panel.snapshot = snapshot;
  panel.summary.textContent = model.title;
  const content = document.createDocumentFragment();
  content.append(element('p', 'agent-delegation-note', 'この会話を手伝うエージェントと、その結果です。'));
  const list = element('ol', 'agent-delegation-list');
  for (const agent of model.agents) {
    const item = element('li', 'agent-delegation-agent');
    item.dataset.agentThread = agent.id;
    item.style.setProperty('--agent-depth', String(agent.depth));
    const heading = element('div', 'agent-delegation-heading');
    heading.append(element('strong', '', agent.name));
    const status = element('span', 'agent-delegation-status', agent.statusLabel);
    status.dataset.status = agent.status; heading.append(status);
    item.append(heading, element('p', 'agent-delegation-role', agent.role),
      element('p', 'agent-delegation-parent', '委任元：' + agent.parentLabel));
    item.append(element('h4', '', agent.resultTruncated ? '結果（一部表示）' : '結果'), element('p', 'agent-delegation-result', agent.result || '結果はまだ取得していません。'));
    if (agent.returnedCharacters !== null) item.append(element('p', 'agent-delegation-characters', `結果本文 ${count(agent.returnedCharacters)}文字`));
    const usage = element('dl', 'agent-delegation-usage');
    if (!agent.usage.some(row => row.label !== 'コンテキスト上限')) usage.append(element('dt', '', '使用量'), element('dd', '', '未取得'));
    for (const row of agent.usage) usage.append(element('dt', '', row.label), element('dd', '', row.value));
    item.append(usage); list.append(item);
  }
  const help = element('details', 'agent-delegation-help');
  help.open = panel.body.querySelector('.agent-delegation-help')?.open || false;
  help.append(element('summary', '', '結果と使用量について'),
    element('p', 'agent-delegation-note', '子の結果を表示しています。親が受け取ったことまでは示しません。'),
    element('p', 'agent-delegation-note', '使用量は取得できた項目だけを表示します。キャッシュ入力・推論出力は内訳です。「直近」は提供元から最後に取得した内訳で、1ターン分とは限りません。'),
    element('p', 'agent-delegation-note', '結果の文字数とトークン数は別の値です。文字数から使用量や節約率は推定しません。'));
  content.append(list);
  if (!sample) content.append(help);
  if (model.truncated) content.append(element('p', 'agent-delegation-note', '保持上限のため、一部の補助エージェントの記録は表示されていません。'));
  panel.body.replaceChildren(content);
  if (nearBottom) messages.scrollTop = messages.scrollHeight;
}
