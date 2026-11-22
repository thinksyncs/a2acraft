import test from "node:test";
import assert from "node:assert/strict";
import { roomConversation } from "../public/world-room.js";
import { projectVillageActivities } from "../public/village-activity.js";
import { villageDemoActivityState, villageDemoChats } from "../public/village-demo.js";

test("the king reports the recorded squad, its actual progress and the interrupted role", () => {
  const quest = {
    id: "runner-quest", party: {name: "地図の隊"},
    status: "paused",
    steps: [{status: "completed", role: "調査"}, {status: "interrupted", role: "製図"}],
    get text() { throw Error("quest prompt should not be used in the room"); },
  };
  Object.defineProperty(quest.steps[0], "output", {get() { throw Error("step output should not be used in the room"); }});
  const { answer, record } = roomConversation("castle", quest, [{id:"other", statusLabel:"待機中"}]);
  assert.equal(record.questId, quest.id);
  assert.equal(record.squadId, undefined);
  assert.match(answer, /地図の隊.*中断中/);
  assert.match(answer, /1／2完了/);
  assert.match(answer, /再開は「製図」から/);

  quest.steps[1].status = "completed";
  quest.status = "completed";
  const complete = roomConversation("castle", quest).answer;
  assert.match(complete, /クエスト完了.*2／2完了/);
  assert.doesNotMatch(complete, /再開|取りかかっている/);
});

test("the king gives a starting point when there is no record; the shop explains how a weapon is used", () => {
  assert.match(roomConversation("castle", null).answer, /まだ.*依頼を書いたら/);
  assert.match(roomConversation("weapon").answer, /「装備する」.*次のメッセージを送る/);
  assert.equal(roomConversation("building"), null);
  assert.equal(roomConversation("tavern"), null);
});

test("the sample king reports the four map squads and links the active squad on the map", () => {
  const sample = villageDemoActivityState({});
  const {allSquads} = projectVillageActivities(sample, villageDemoChats());
  const {answer, record} = roomConversation("castle", null, allSquads);
  assert.match(answer, /依頼は4件/);
  for (const status of ["作業中", "中断中", "待機中", "帰還済み"]) assert.ok(answer.includes(status + "が1隊"));
  assert.match(answer, /写真工房の隊/);
  assert.equal(record.squadId, "todo:village-sample-work");
  assert.equal(record.questId, undefined);
});

test("ordinary TODO and board assignments lead to a map report without an active adventure", () => {
  const chats = [{id:"scout", title:"調査担当"}];
  const party = {name:"川の隊", leaderId:"scout", members:[{conversationId:"scout", role:"調査"}]};
  const state = {party:{party, quest:null},
    todos:{items:[{id:"trail", title:"川沿いを歩く", status:"todo", assignee:{type:"chat",conversationId:"scout"}}]},
    boardDispatch:{active:{id:"board-run", title:"地図を作る", status:"gathering", selection:{party}}}};
  const {allSquads} = projectVillageActivities(state, chats);
  const {answer, record} = roomConversation("castle", null, allSquads);
  assert.match(answer, /依頼は2件/);
  assert.match(answer, /集合中が1隊/);
  assert.match(answer, /編成予定・待機中が1隊/);
  assert.equal(record.squadId, "board:board-run");
  assert.equal(roomConversation("castle", null, []).record, null);
});
