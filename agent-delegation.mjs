// Read-only telemetry reducer. It never starts, resumes, stops, or reads a thread.
// Protocol references: openai/codex app-server-protocol/schema/typescript/v2
// ThreadItem, Thread, ThreadTokenUsage, TokenUsageBreakdown (checked 2026-11-08).
// The docs also describe the earlier singular-recipient collabToolCall shape.
export const MAX_DELEGATES = 128;
const MAX_RESULT = 12000;
const MAX_COMPLETED_CALLS = 256;
const terminal = new Set(['completed', 'interrupted', 'errored', 'shutdown', 'notFound']);
const statuses = new Set(['pendingInit', 'running', 'waiting', 'unknown', ...terminal]);
const methods = new Set(['thread/started', 'thread/status/changed', 'thread/closed',
  'thread/tokenUsage/updated', 'turn/started', 'turn/completed', 'item/started', 'item/completed']);
const usageKeys = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens',
  'outputTokens', 'reasoningOutputTokens'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u0020\u007f]/u.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (value, max = 120) => typeof value === 'string' && value.trim() ? value.replace(/\u0000/g, '').slice(0, max) : null;
const status = value => statuses.has(value) ? value : 'unknown';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function breakdown(value) {
  if (!object(value)) return null;
  const result = Object.fromEntries(usageKeys.map(key => [key, count(value[key])]));
  return Object.values(result).some(value => value !== null) ? result : null;
}

function usage(value) {
  if (!object(value)) return null;
  const result = {total: breakdown(value.total), last: breakdown(value.last), modelContextWindow: count(value.modelContextWindow)};
  if (result.modelContextWindow === 0) result.modelContextWindow = null;
  return result.total || result.last || result.modelContextWindow !== null ? result : null;
}

function resultFields(text, source, received = false) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const characters = Array.from(text.replace(/\u0000/g, ''));
  return {returnedText: characters.slice(0, MAX_RESULT).join(''), returnedCharacters: characters.length,
    returnedTextTruncated: characters.length > MAX_RESULT, returnedTextSource: source, returnedToParent: received};
}

function newAgent(threadId, parentThreadId, now) {
  return {threadId, parentThreadId, name: null, role: null, status: 'unknown', turnId: null,
    finishedTurnIds: [],
    usage: null, returnedText: null, returnedCharacters: null, returnedTextTruncated: false,
    returnedTextSource: null, returnedToParent: false, updatedAt: now};
}

function treeFor(chat, now) {
  const saved = chat.delegation;
  const valid = object(saved) && saved.version === 1 && saved.rootThreadId === chat.threadId;
  const tree = {version: 1, rootThreadId: chat.threadId, revision: valid ? count(saved.revision) || 0 : 0,
    updatedAt: valid ? count(saved.updatedAt) || now : now, agents: [], truncated: valid && saved.truncated === true,
    completedCollabCalls: valid && Array.isArray(saved.completedCollabCalls) ? saved.completedCollabCalls
      .filter(call => object(call) && identifier(call.senderThreadId) && identifier(call.itemId) && (call.turnId === null || identifier(call.turnId)))
      .slice(-MAX_COMPLETED_CALLS).map(({senderThreadId, turnId, itemId}) => ({senderThreadId, turnId, itemId})) : []};
  if (!valid || !Array.isArray(saved.agents)) return tree;
  const pending = saved.agents.slice(0, MAX_DELEGATES * 2), known = new Set([chat.threadId]);
  // Restore only a rooted acyclic graph, regardless of persisted array order.
  for (let pass = 0; pass < MAX_DELEGATES && pending.length; pass++) {
    let progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const row = pending[i];
      if (!object(row) || !identifier(row.threadId) || !identifier(row.parentThreadId) || known.has(row.threadId)) {
        pending.splice(i, 1); continue;
      }
      if (!known.has(row.parentThreadId)) continue;
      if (tree.agents.length >= MAX_DELEGATES) { tree.truncated = true; return tree; }
      const source = ['childOutput', 'parentReceipt'].includes(row.returnedTextSource) ? row.returnedTextSource : null;
      const result = source ? resultFields(row.returnedText, source, source === 'parentReceipt' && row.returnedToParent === true) : null;
      const agent = {...newAgent(row.threadId, row.parentThreadId, now), name: label(row.name), role: label(row.role),
        status: status(row.status), turnId: identifier(row.turnId) ? row.turnId : null, usage: usage(row.usage),
        finishedTurnIds: Array.isArray(row.finishedTurnIds) ? [...new Set(row.finishedTurnIds.filter(identifier))].slice(-16) : [],
        updatedAt: count(row.updatedAt) ?? now, ...(result || {})};
      if (result && row.returnedTextTruncated === true && count(row.returnedCharacters) >= result.returnedCharacters) {
        agent.returnedTextTruncated = true; agent.returnedCharacters = row.returnedCharacters;
      }
      tree.agents.push(agent); known.add(agent.threadId); pending.splice(i, 1); progress = true;
    }
    if (!progress) break;
  }
  // IDs, not traversal order, define the stable display and persistence order.
  tree.agents.sort((a, b) => a.threadId.localeCompare(b.threadId));
  return tree;
}

function commit(chat, tree, now) {
  const before = chat.delegation;
  const comparable = value => value && ({...value, revision: 0, updatedAt: 0});
  if (equal(comparable(before), comparable(tree))) return false;
  if (!before && !tree.agents.length && !tree.truncated) return false;
  tree.revision = (before?.rootThreadId === tree.rootThreadId ? count(before.revision) || 0 : 0) + 1;
  tree.updatedAt = now; chat.delegation = tree; return true;
}

function runtimeStatus(value, previous) {
  if (!object(value)) return previous;
  if (value.type === 'active') {
    // A replayed thread snapshot is not evidence of a new turn after completion.
    if (terminal.has(previous)) return previous;
    return Array.isArray(value.activeFlags) && value.activeFlags.some(flag => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag)) ? 'waiting' : 'running';
  }
  if (value.type === 'systemError') return 'errored';
  // Idle and unloaded do not prove that a delegated task completed or stopped.
  if (['idle', 'notLoaded'].includes(value.type)) return terminal.has(previous) ? previous : 'unknown';
  return previous;
}

/** Observe only explicit native parent/child relationships beneath this chat. */
export function observeAgentDelegation(chat, message, {now = Date.now(), rootThreadIds = []} = {}) {
  if (!chat || !identifier(chat.threadId) || !object(message) || !methods.has(message.method)) return false;
  const params = object(message.params) ? message.params : {}, tree = treeFor(chat, now);
  const roots = new Set(rootThreadIds), agents = new Map(tree.agents.map(agent => [agent.threadId, agent]));
  const known = id => id === tree.rootThreadId || agents.has(id);
  const patch = (agent, changes) => {
    if (!agent || Object.entries(changes).every(([key, value]) => equal(agent[key], value))) return;
    Object.assign(agent, changes, {updatedAt: now});
  };
  const add = (id, parent) => {
    if (!identifier(id) || !identifier(parent) || id === parent || id === tree.rootThreadId || roots.has(id) || !known(parent)) return null;
    if (agents.has(id)) return agents.get(id).parentThreadId === parent ? agents.get(id) : null;
    if (tree.agents.length >= MAX_DELEGATES) { tree.truncated = true; return null; }
    const agent = newAgent(id, parent, now); tree.agents.push(agent); agents.set(id, agent); return agent;
  };

  if (message.method === 'thread/started' && object(params.thread)) {
    const thread = params.thread, source = thread.source?.subAgent?.thread_spawn;
    const parent = identifier(thread.parentThreadId) ? thread.parentThreadId : source?.parent_thread_id;
    const agent = add(thread.id, parent);
    if (agent) patch(agent, {name: label(thread.agentNickname) || label(source?.agent_nickname) || label(thread.name) || agent.name,
      role: label(thread.agentRole) || label(source?.agent_role) || agent.role, status: runtimeStatus(thread.status, agent.status)});
    // forkedFromId and a shared sessionId do not establish subagent parentage.
  }

  const item = object(params.item) ? params.item : null;
  if (['item/started', 'item/completed'].includes(message.method) && item && ['collabAgentToolCall', 'collabToolCall'].includes(item.type)) {
    const sender = item.senderThreadId;
    // An event from another thread cannot claim a known parent's identity.
    if (known(sender) && params.threadId === sender && identifier(item.id)) {
      const call = {senderThreadId: sender, turnId: identifier(params.turnId) ? params.turnId : null, itemId: item.id};
      // Parent turn IDs cannot be compared to child turn IDs. Remember completed
      // calls across child turns/restarts so a replayed wait cannot finish new work.
      if (tree.completedCollabCalls.some(previous => equal(previous, call))) return commit(chat, tree, now);
      const recipients = item.type === 'collabAgentToolCall' ? (Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []) : [item.newThreadId || item.receiverThreadId];
      const spawning = ['spawnAgent', 'spawn_agent'].includes(item.tool);
      let observedRecipient = false;
      for (const id of recipients.slice(0, MAX_DELEGATES)) {
        const agent = spawning ? add(id, sender) : agents.get(id);
        if (!agent) continue;
        observedRecipient = true;
        const raw = item.type === 'collabAgentToolCall' ? (object(item.agentsStates) && Object.hasOwn(item.agentsStates, id) ? item.agentsStates[id] : null) : item.agentStatus;
        const observed = typeof raw === 'string' ? raw : object(raw) ? raw.status : null;
        // Completed tool call means e.g. spawn finished, not that its child finished.
        // Spawn/wait snapshots can arrive after the child's terminal event.
        // Only an explicit new turn/started reopens a terminal child.
        if (statuses.has(observed) && !(terminal.has(agent.status) && !terminal.has(observed))) patch(agent, {status: observed});
        const received = message.method === 'item/completed' && item.status === 'completed' && item.tool === 'wait' && observed === 'completed' && sender === agent.parentThreadId;
        if (received && object(raw)) patch(agent, resultFields(raw.message, 'parentReceipt', true) || {});
      }
      if (observedRecipient && message.method === 'item/completed') {
        tree.completedCollabCalls.push(call);
        tree.completedCollabCalls = tree.completedCollabCalls.slice(-MAX_COMPLETED_CALLS);
      }
    }
  }

  // These records identify an agent, but alone do not specify its direct parent.
  if (item?.type === 'subAgentActivity' && known(params.threadId)) {
    const agent = agents.get(item.agentThreadId);
    if (agent && message.method === 'item/completed') {
      if (item.kind === 'completed') patch(agent, {status: 'completed'});
      if (item.kind === 'interrupted') patch(agent, {status: 'interrupted'});
    }
  }

  const agent = agents.get(params.threadId);
  if (agent) {
    const suppliedTurn = params.turnId || params.turn?.id;
    const matchingTurn = !suppliedTurn || !agent.turnId || suppliedTurn === agent.turnId;
    if (message.method === 'turn/started' && identifier(params.turn?.id)) {
      if (!agent.finishedTurnIds.includes(params.turn.id) && (agent.turnId !== params.turn.id || !terminal.has(agent.status))) {
        const changedTurn = agent.turnId !== params.turn.id;
        patch(agent, {turnId: params.turn.id, status: 'running', ...(changedTurn ? {returnedText: null, returnedCharacters: null,
          returnedTextTruncated: false, returnedTextSource: null, returnedToParent: false} : {})});
      }
    } else if (message.method === 'turn/completed' && matchingTurn && identifier(params.turn?.id)) {
      const next = {completed: 'completed', interrupted: 'interrupted', failed: 'errored'}[params.turn.status];
      if (next) patch(agent, {turnId: params.turn.id, status: next,
        finishedTurnIds: [...new Set([...agent.finishedTurnIds, params.turn.id])].slice(-16)});
    } else if (message.method === 'thread/status/changed') {
      patch(agent, {status: runtimeStatus(params.status, agent.status)});
    } else if (message.method === 'thread/closed' && !terminal.has(agent.status)) {
      patch(agent, {status: 'unknown'});
    } else if (message.method === 'thread/tokenUsage/updated' && matchingTurn) {
      const next = usage(params.tokenUsage);
      if (next) patch(agent, {usage: next});
    } else if (message.method === 'item/completed' && item?.type === 'agentMessage' && matchingTurn && (item.phase == null || item.phase === 'final_answer')) {
      // Receipt is stronger evidence than a later replay of the child's output.
      if (!agent.returnedToParent) patch(agent, {...(resultFields(item.text, 'childOutput') || {}),
        ...(identifier(params.turnId) && !agent.turnId ? {turnId: params.turnId} : {})});
    }
  }
  tree.agents.sort((a, b) => a.threadId.localeCompare(b.threadId));
  return commit(chat, tree, now);
}

/** Preserve results but never claim an in-flight child survived a disconnect. */
export function markAgentDelegationUnknown(chat, {now = Date.now()} = {}) {
  if (!object(chat?.delegation)) return false;
  if (!identifier(chat.threadId)) { delete chat.delegation; return true; }
  const tree = treeFor(chat, now);
  for (const agent of tree.agents) if (!terminal.has(agent.status) && agent.status !== 'unknown') {
    agent.status = 'unknown'; agent.updatedAt = now;
  }
  return commit(chat, tree, now);
}
