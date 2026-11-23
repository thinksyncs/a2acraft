import {worldText} from './i18n-world.js';
// Describe only a saved assignment. Viewing its marker never schedules work.
export function villageInvitation(task, party) {
  if (!task?.id || !task.title || task.status !== 'todo') return null;
  const runs = task.runs || [];
  if (runs.length >= 10 || (runs.length && runs.at(-1).status !== 'completed')) return null;
  const solo = task.assignee?.type === 'chat';
  if (!solo && task.assignee?.type !== 'party') return null;
  const leaderId = solo ? task.assignee.conversationId : party?.leaderId;
  const roster = solo ? [[leaderId, '']] : party?.members?.map(m => [m.conversationId, m.role]);
  if (!leaderId || !roster?.some(([id]) => id === leaderId)) return null;
  const version = JSON.stringify([task.id, task.updatedAt, task.title, task.assignee.type, roster, leaderId, runs.length]);
  return {id: task.id, title: task.title, leaderId, version, dismissal: JSON.stringify([task.id, task.updatedAt, leaderId, runs.length])};
}

export function assertVillageInvitation(task, party, version) {
  const current = villageInvitation(task, party);
  if (!current || current.version !== version) throw Error(worldText('依頼か担当が変わりました。地図で新しい提案を確認してください。'));
}

export function invitationsForVillage(state, squads, dismissed) {
  const items = new Map((state.todos?.items || []).map(item => [item.id, item]));
  const seen = new Set(), invites = new Map();
  for (const squad of squads) {
    if (squad.source !== 'todo' || !squad.provisional || squad.status !== 'waiting') continue;
    const item = items.get(squad.todoId);
    if (item?.source?.provider === 'castle' && item.source.dependsOn?.some(id => items.get(id)?.status !== 'done')) continue;
    const invite = villageInvitation(item, state.party?.party);
    const leader = squad.members.find(m => m.conversationId === squad.leaderId);
    if (!invite || dismissed?.has(invite.dismissal) || !leader || invite.leaderId !== leader.conversationId || seen.has(leader.conversationId)) continue;
    // Unloaded/deleted members cannot silently change the proposed party.
    if (item.assignee.type === 'party' && squad.members.length !== state.party.party.members.length) continue;
    invites.set(squad.id, {...invite, speaker: leader.name});
    seen.add(leader.conversationId);
  }
  return invites;
}
