import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { LocalStore } from "./local-store.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function artifactURL(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error(
      "成果のURLはHTTPS、または手元のlocalhostのHTTPを指定してください。",
    );
  return url.href;
}
async function artifactFile(root, target) {
  if (
    typeof target !== "string" ||
    target.length > 1000 ||
    path.isAbsolute(target)
  )
    throw Error("成果ファイルは作業場所からの相対パスで指定してください。");
  const base = await realpath(root),
    file = await realpath(path.resolve(base, target));
  if (
    !file.startsWith(base + path.sep) ||
    (target+"/"+path.relative(base,file))
      .split(/[\\/]/)
      .some((part) =>
        /^(?:\.env(?:\.|$)|\.git$|auth\.json$|credentials|id_rsa)/i.test(part),
      ) ||
    /\.(?:pem|key|p12)$/i.test(file)
  )
    throw Error("このファイルは成果として開けません。");
  const info = await stat(file);
  if (!info.isFile() || info.size > 2_000_000)
    throw Error("成果は2MB以下のテキストファイルにしてください。");
  const bytes = await readFile(file);
  if (bytes.includes(0)) throw Error("バイナリ形式は対応していません。");
  return { text: bytes.toString("utf8"), hash: digest(bytes) };
}
export class WorldArtifacts extends LocalStore {
  constructor(directory, getProjects, onChange) {
    super(
      path.join(directory, "world-artifacts.json"),
      { version: 1, revision: 0, items: [] },
      onChange,
    );
    this.getProjects = getProjects;
  }
  async load() {
    return super.load((value) => {
      if (
        value?.version !== 1 ||
        !Array.isArray(value.items) ||
        value.items.length > 1000
      )
        throw Error("成果の記録を確認してください。");
    });
  }
  project(id) {
    const p = this.getProjects().find((p) => p.id === id);
    if (!p) throw Error("地区が見つかりません。");
    return p;
  }
  async register(input) {
    const p = this.project(input.projectId),
      job = p.jobs.find(
        (j) =>
          j.id === input.jobId &&
          j.status === "done" &&
          j.commit &&
          j.workspace,
      );
    if (!job) throw Error("完了し、commitが保存された工程を選んでください。");
    const buildingId = input.buildingId || job.repoId;
    if (
      buildingId !== job.repoId &&
      !p.jobs.some(
        (item) =>
          item.id === buildingId &&
          item.kind === "implement" &&
          item.repoId === job.repoId,
      )
    )
      throw Error("成果と同じrepoの建物を選んでください。");
    if (!["document", "search", "preview", "tool"].includes(input.kind))
      throw Error("成果の種類を選んでください。");
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 120
    )
      throw Error("成果の名前を入力してください。");
    const web = ["preview", "tool"].includes(input.kind);
    const target = web ? artifactURL(input.target) : input.target;
    const file = web ? null : await artifactFile(job.workspace, target);
    const row = {
      id: randomUUID(),
      projectId: p.id,
      repoId: job.repoId,
      buildingId,
      jobId: job.id,
      commit: job.commit,
      kind: input.kind,
      title: input.title.trim(),
      target,
      startInstructions: String(input.startInstructions || "").slice(0, 2000),
      status: file ? "ready" : "needs_check",
      hash: file?.hash || null,
      checkedAt: file ? Date.now() : null,
      evidence: file
        ? "保存された成果ファイルを確認"
        : "URLの応答をまだ確認していません。",
    };
    await this.mutate((value) => {
      if (value.items.length >= 1000) throw Error("成果の保存上限です。");
      value.items.push(row);
    });
    return row;
  }
  async use({ id, query = "", acceptVersion = false }) {
    const row = this.value.items.find((a) => a.id === id);
    if (!row) throw Error("成果が見つかりません。");
    if (["preview", "tool"].includes(row.kind))
      return { ...row, url: artifactURL(row.target) };
    const p = this.project(row.projectId),
      job = p.jobs.find((j) => j.id === row.jobId);
    try {
      if (job?.commit !== row.commit)
        throw Error("作業の版が変わっています。成果を登録し直してください。");
      const file = await artifactFile(job.workspace, row.target);
      if (file.hash !== row.hash && !acceptVersion)
        throw Error(
          "成果ファイルが変更されています。「更新版を確認して開く」で内容を確認できます。",
        );
      if (file.hash !== row.hash || row.status !== "ready")
        await this.mutate((value) =>
          Object.assign(
            value.items.find((a) => a.id === id),
            {
              hash: file.hash,
              status: "ready",
              checkedAt: Date.now(),
              evidence: "現在の成果ファイルを確認",
            },
          ),
        );
      const text =
        row.kind === "search" && query
          ? file.text
              .split("\n")
              .map((line, index) => ({ line: index + 1, text: line }))
              .filter((line) =>
                line.text
                  .toLocaleLowerCase()
                  .includes(String(query).slice(0, 200).toLocaleLowerCase()),
              )
              .slice(0, 100)
              .map((line) => line.line + ": " + line.text)
              .join("\n") || "一致する内容はありません。"
          : file.text;
      return { ...row, status: "ready", text };
    } catch (error) {
      await this.mutate((value) =>
        Object.assign(
          value.items.find((a) => a.id === id),
          {
            status: "unavailable",
            evidence: error.message,
            checkedAt: Date.now(),
          },
        ),
      );
      throw error;
    }
  }
  async check({ id, confirmation }) {
    const row = this.value.items.find((item) => item.id === id);
    if (!row || !["preview", "tool"].includes(row.kind))
      throw Error("確認するプレビューを選んでください。");
    const url = new URL(artifactURL(row.target));
    let status = "unavailable",
      evidence;
    if (confirmation === "opened") {
      status = "ready";
      evidence = "利用者が別画面で開いて利用を確認";
    } else if (confirmation === "unavailable")
      evidence = "利用者が未起動または利用できない状態を確認";
    else {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        throw Error("外部の成果は別画面で開いて確認してください。");
      try {
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        await response.body?.cancel();
        if (!response.ok) throw Error("HTTP " + response.status);
        status = "ready";
        evidence =
          "ローカルの接続先からHTTP " +
          response.status +
          "の応答を確認（内容は未評価）";
      } catch (error) {
        evidence = "接続先の応答を確認できません: " + error.message;
      }
    }
    await this.mutate((value) =>
      Object.assign(
        value.items.find((item) => item.id === id),
        { status, evidence, checkedAt: Date.now() },
      ),
    );
    return this.value.items.find((item) => item.id === id);
  }
}
