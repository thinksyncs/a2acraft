import test from "node:test";
import assert from "node:assert/strict";
import { projectVillageActivities } from "../public/village-activity.js";
import { villageControlTarget } from "../public/village-party-control.js";

const chats = [{ id: "leader" }, { id: "member" }];
const party = {
  leaderId: "leader",
  members: chats.map(chat => ({ conversationId: chat.id, role: "担当" })),
};
const selection = "todo:map-request";

function project(status, localChats = chats) {
  const todo = { id: "map-request", status: "todo", assignee: { type: "party" } };
  const state = { party: { party }, todos: { items: [todo] } };
  if (status !== "waiting") {
    todo.status = "doing";
    state.party.quest = { id: "map-run", status, party, link: { todoId: todo.id } };
    todo.runs = [{ id: "run", questId: "map-run", status, party }];
  }
  return projectVillageActivities(state, localChats);
}

test("map control resolves the current waiting, paused or returned formation by its exact ID", () => {
  for (const status of ["waiting", "paused", "completed", "cancelled"]) {
    const activities = project(status);
    assert.equal(villageControlTarget(activities, selection), activities.allSquads[0], status);
    assert.equal(villageControlTarget(activities, "protagonist"), activities.protagonist);
    assert.equal(villageControlTarget(activities, "leader"), null);
    assert.equal(villageControlTarget(activities, "todo:elsewhere"), null);
  }
});

test("another team's active work and unavailable work records cannot be taken over", () => {
  for (const status of ["running", "stopping", "starting", "gathering", "blocked", "uncertain"]) {
    assert.equal(villageControlTarget(project(status), selection), null, status);
  }
});

test("rechecking a stale selection cannot substitute another member for a missing local leader", () => {
  const full = project("paused");
  assert.ok(villageControlTarget(full, selection));
  const withoutLeader = project("paused", [{ id: "member" }]);
  assert.equal(withoutLeader.allSquads[0].members.length, 1);
  assert.equal(villageControlTarget(withoutLeader, selection), null);
  assert.equal(villageControlTarget(withoutLeader, "protagonist"), null);
  assert.equal(villageControlTarget(projectVillageActivities({}, chats), selection), null);
});
