import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { LocalStore } from "./local-store.mjs";

const kinds = ["finding", "decision", "blocker", "handoff"];
const required = (value, limit, label) => {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw Error(`${label}は1〜${limit}文字で指定してください。`);
  return value.trim();
};

// This is shared evidence, never an instruction channel or a task queue.
export class AgentBoard extends LocalStore {
  constructor(directory, onChange) {
    super(
      path.join(directory, "agent-board.json"),
      { version: 1, revision: 0, sequence: 0, entries: [] },
      onChange,
    );
  }
  async load() {
    await super.load((value) => {
      if (
        value?.version !== 1 ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 0 ||
        !Array.isArray(value.entries) ||
        value.entries.length > 500
      )
        throw Error("エージェント掲示板の保存内容を確認できません。");
      let previous = 0;
      for (const entry of value.entries) {
        if (
          !Number.isSafeInteger(entry.sequence) ||
          entry.sequence <= previous ||
          entry.sequence > value.sequence ||
          !["project", "shared"].includes(entry.scope) ||
          !kinds.includes(entry.kind) ||
          !entry.author?.projectId ||
          !entry.id ||
          !entry.key
        )
          throw Error("エージェント掲示板の投稿記録が不正です。");
        required(entry.title, 100, "見出し");
        required(entry.summary, 1600, "要点");
        previous = entry.sequence;
      }
    });
    return this;
  }
  public() {
    return { revision: this.value.revision, count: this.value.entries.length };
  }
  read({ projectId, scope = "project", after = 0, limit = 20 } = {}) {
    if (
      !["project", "shared", "all"].includes(scope) ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error("掲示板の読み込み条件を確認してください。");
    const matches = this.value.entries.filter(
      (e) =>
        scope === "all" ||
        e.scope === "shared" ||
        (scope === "project" && e.author.projectId === projectId),
    );
    const newer = matches.filter((e) => e.sequence > after);
    const entries = after ? newer.slice(0, limit) : newer.slice(-limit);
    return structuredClone({
      entries: entries.map(({ key, fingerprint, ...entry }) => entry),
      nextCursor: entries.at(-1)?.sequence || after,
      hasMore: after > 0 && newer.length > entries.length,
      total: matches.length,
      omitted: after === 0 ? Math.max(0, newer.length - entries.length) : 0,
      historyPruned:
        this.value.sequence > this.value.entries.length &&
        after < (this.value.entries[0]?.sequence || 1) - 1,
    });
  }
  async post(author, input, callId, canPost = () => true) {
    const title = required(input?.title, 100, "見出し"),
      summary = required(input?.summary, 1600, "要点");
    if (
      !kinds.includes(input.kind) ||
      !["project", "shared"].includes(input.scope)
    )
      throw Error("投稿の種類と共有先を指定してください。");
    for (const key of Object.keys(input))
      if (!["title", "summary", "kind", "scope"].includes(key))
        throw Error("投稿元はアプリが記録します。追加の項目は指定できません。");
    for (const key of [
      "projectId",
      "jobId",
      "conversationId",
      "threadId",
      "turnId",
    ])
      required(author[key], 200, "投稿元");
    required(callId, 200, "呼び出しID");
    const key = createHash("sha256")
      .update(JSON.stringify([author.threadId, author.turnId, callId]))
      .digest("hex");
    const body = { title, summary, kind: input.kind, scope: input.scope };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    return this.mutate((value) => {
      if (!canPost()) throw Error("この工程は停止または終了しています。");
      const existing = value.entries.find((e) => e.key === key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw Error("同じ呼び出しIDの投稿内容が変わっています。");
        return existing;
      }
      if (
        value.entries.filter(
          (e) =>
            e.author.turnId === author.turnId &&
            e.author.threadId === author.threadId,
        ).length >= 20
      )
        throw Error("1回の作業で投稿できる要点は20件までです。");
      const entry = {
        id: randomUUID(),
        key,
        fingerprint,
        sequence: ++value.sequence,
        ...body,
        author: structuredClone(author),
        createdAt: Date.now(),
      };
      value.entries.push(entry);
      if (value.entries.length > 500)
        value.entries.splice(0, value.entries.length - 500);
      return entry;
    });
  }
}
