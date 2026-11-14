// Native child threads stay attached to their owning chat. They are not chats,
// village residents, party members, buildings, or evidence of project completion.
const states = new Set(['pendingInit', 'running', 'waiting', 'completed', 'interrupted',
  'errored', 'shutdown', 'notFound', 'unknown']);
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const statusColors = {pendingInit:'#b5b0a0',running:'#75c8e0',waiting:'#e3c273',completed:'#8cce8e',
  interrupted:'#c4a3c1',errored:'#ed9a80',shutdown:'#aaa9a2',notFound:'#aaa9a2',unknown:'#d1cfcb'};

export function agentRoleLabel(role) {
  const value = text(role, 160);
  for (const [pattern, label] of [[/調査|調べ|research|explor/i,'調査'],
    [/検証|テスト|確認|review|test|validat/i,'検証'],[/実装|修正|implement|cod(e|ing)|fix/i,'実装'],
    [/設計|design|architect/i,'設計'],[/計画|plan/i,'計画']]) if (pattern.test(value)) return label;
  return value ? Array.from(value.replace(/（.*?）|\(.*?\)/g,'').trim()).slice(0,6).join('') : '';
}

export function mainAgentLabel(person, count = 0) {
  const name = text(person.name || person.characterName, 12);
  return '主' + (name ? ' ' + name : 'エージェント') +
    (count ? ` · 補助 ${count}${person.truncated ? '+' : ''}` : '');
}

export function delegationCacheKey(value) {
  if (!value || value.version !== 1) return '';
  return JSON.stringify([value.rootThreadId, value.revision, value.truncated,
    Number.isSafeInteger(value.revision) ? null : value.agents]);
}

export function villageDelegation(chat) {
  const source = chat?.delegation;
  if (source?.version !== 1 || !text(source.rootThreadId, 512) || !Array.isArray(source.agents)) return null;
  if (typeof chat.threadId !== 'string' || chat.threadId !== source.rootThreadId) return null;
  const seen = new Set(), agents = [];
  for (const value of source.agents.slice(0, 512)) {
    const threadId = text(value?.threadId, 512), parentThreadId = text(value?.parentThreadId, 512);
    if (!threadId || !parentThreadId || threadId === source.rootThreadId || seen.has(threadId)) continue;
    seen.add(threadId);
    agents.push({threadId,parentThreadId,name:text(value.name,80),role:text(value.role,160),
      status:states.has(value.status) ? value.status : 'unknown'});
  }
  if (!agents.length) return null;
  return {rootThreadId:source.rootThreadId,revision:source.revision,agents,total:agents.length,
    completed:agents.filter(agent=>agent.status==='completed').length,
    unknown:agents.filter(agent=>agent.status==='unknown').length,
    truncated:Boolean(source.truncated || source.agents.length>512)};
}

export function delegationSummary(value) {
  if (!value?.total) return '';
  return `補助 ${value.total}${value.truncated?'+':''} · 完了 ${value.completed}` +
    (value.unknown ? ` · 未確認 ${value.unknown}` : '');
}

// Parent coordinates already include encounter holds and actual party poses.
// A compact cluster follows the parent's actual pose. The front stays clear for
// eye contact; these companions never invent independent movement or work.
export function villageDelegateActors(parents, {limit = 3, totalLimit = 120} = {}) {
  const helpers = [], badges = [], seen = new Set();
  for (const parent of parents) {
    const delegation = parent.delegation, owner = parent.conversationId;
    if (!delegation?.total || !owner || seen.has(owner) || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) continue;
    seen.add(owner);
    badges.push({parentConversationId:owner,x:parent.x,y:parent.y,color:parent.color,name:parent.name || parent.characterName,
      count:delegation.total,completed:delegation.completed,unknown:delegation.unknown,
      label:mainAgentLabel({...parent,truncated:delegation.truncated},delegation.total),summary:delegationSummary(delegation)});
    const heading = Number.isFinite(parent.heading) ? parent.heading :
      ({up:0,right:Math.PI/2,down:Math.PI,left:-Math.PI/2}[parent.direction] || 0);
    // Prioritize unresolved work in the visual slots without reordering records.
    const isUnresolved = agent => ['pendingInit','running','waiting','unknown'].includes(agent.status);
    const visibleAgents = [...delegation.agents.filter(isUnresolved),
      ...delegation.agents.filter(agent => !isUnresolved(agent))];
    for (const [index, agent] of visibleAgents.slice(0, Math.max(0, Math.min(3, limit))).entries()) {
      if (helpers.length >= totalLimit) break;
      const side = [-18,18,0][index], behind = index === 2 ? 22 : 6;
      const roleLabel = agentRoleLabel(agent.role), name = text(agent.name, 8);
      helpers.push({id:'subagent:'+JSON.stringify([owner,agent.threadId]),kind:'subagent',selectable:false,
        parentConversationId:owner,threadId:agent.threadId,parentThreadId:agent.parentThreadId,
        parentX:parent.x,parentY:parent.y,parentName:parent.name || parent.characterName,clusterIndex:index,
        name:agent.name,role:agent.role,roleLabel,status:agent.status,scale:0.58,seed:parent.seed,color:parent.color,
        x:parent.x+Math.cos(heading)*side-Math.sin(heading)*behind,
        y:parent.y+Math.sin(heading)*side+Math.cos(heading)*behind,
        heading,direction:parent.direction,walking:false,statusColor:statusColors[agent.status],
        label:'補' + (name ? ' ' + name : '助') + (roleLabel ? ' · ' + roleLabel : '') +
          (agent.status==='unknown'?' ?':agent.status==='completed'?' ✓':'')});
    }
  }
  return {helpers,badges};
}

export function addDelegatesToScene(scene, delegates) {
  if (!delegates?.helpers.length && !delegates?.badges.length) return scene;
  // Match the first visible owner used by villageDelegateActors. A chat can
  // appear both as a resident and in a party; only its chosen pose gets helpers.
  const parents = new Map();
  for (const person of scene.people) {
    if (person.kind !== 'subagent' && person.conversationId && !parents.has(person.conversationId)) {
      parents.set(person.conversationId, person);
    }
  }
  const counts = new Map(delegates.badges.map(badge=>[badge.parentConversationId,badge]));
  const people = scene.people.map(person=>{
    const badge = counts.get(person.conversationId);
    return badge && parents.get(person.conversationId) === person ? {...person,kind:'agent',delegationCount:badge.count,delegationLabel:badge.label,
      delegationSummary:badge.summary,delegationCompleted:badge.completed,delegationUnknown:badge.unknown} : person;
  });
  for (const helper of delegates.helpers) {
    const parent = parents.get(helper.parentConversationId);
    if (parent) people.push({...helper,color:parent.color || helper.color});
  }
  return {...scene,people};
}

export function worldDelegateLabels(people, matrix, width, height) {
  const labels = [];
  const project = (x,y,z) => {
    const point = [x,y,z,1];
    const clip = [0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));
    if (clip[3] <= 0) return null;
    const [px,py,pz] = clip.slice(0,3).map(value=>value/clip[3]);
    if (px < -1 || px > 1 || py < -1 || py > 1 || pz < -1 || pz > 1) return null;
    return {x:(px+1)*width/2,y:(1-py)*height/2,depth:clip[3]};
  };
  for (const person of people) {
    const helper = person.kind === 'subagent';
    const label = helper ? person.label : person.delegationLabel || (person.kind === 'agent' ? mainAgentLabel(person) : '');
    if (!label) continue;
    const anchor = project(person.x, helper ? 35 * (person.scale || 0.58) : 37, person.y);
    if (!anchor) continue;
    const owner = helper && Number.isFinite(person.parentX) && Number.isFinite(person.parentY)
      ? project(person.parentX, 8, person.parentY) : null;
    const compact = anchor.depth > 260 || !helper && !person.identityFocused && !person.delegationLabel;
    labels.push({text:compact ? '' : label,...anchor,
      color:person.color,statusColor:person.statusColor,parent:!helper,owner,
      glyph:helper?'diamond':'shield',id:person.id,delegated:helper||Boolean(person.delegationLabel)});
    if (labels.length >= 96) break;
  }
  return labels;
}
