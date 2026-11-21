// Map movement uses the current profile's projected formations. A landmark,
// a saved selection, or a conversation ID alone cannot identify a movable team.
const availableStatuses = new Set(["waiting", "paused", "completed", "cancelled"]);

export function villageControlTarget(activities, squadId) {
  if (typeof squadId !== "string" || !squadId) return null;

  const ownParty = squadId === "protagonist";
  const squad = ownParty
    ? activities?.protagonist
    : activities?.allSquads?.find(candidate => candidate.id === squadId);
  if (squad?.id !== squadId || (!ownParty && !availableStatuses.has(squad.status))) return null;

  // The projector resolves the roster against this profile's current chats.
  // Never use a substitute leader when a chat disappears during a refresh.
  if (!squad.leaderId || !squad.members?.some(member => member.conversationId === squad.leaderId)) return null;
  return squad;
}
