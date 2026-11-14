import { projectLink } from "./project-link.js";
import { node, button } from "./world-room.js";

export function buildingPullRequests(project, building) {
  if (!building.repoId) return [];
  const jobs = new Map((project.jobs || []).map((job) => [job.id, job]));
  function includesBuilding(job, seen = new Set()) {
    if (!job || job.repoId !== building.repoId || seen.has(job.id)) return false;
    if (job.id === building.jobId) return true;
    seen.add(job.id);
    return (job.dependencies || []).some((id) => includesBuilding(jobs.get(id), seen));
  }
  const shown = new Set();
  return (project.pullRequests || []).filter((pr) => {
    if (pr.repoId !== building.repoId || !pr.url || shown.has(pr.url)) return false;
    // A repository PR can contain several features. Only show it in a feature
    // building when the completed publication actually includes that work.
    if (building.jobId && ![...jobs.values()].some((job) =>
      job.kind === "publish" && job.status === "done" && job.url === pr.url && includesBuilding(job)
    )) return false;
    shown.add(pr.url);
    return true;
  });
}

export function createArtifactView({ api, demo, getWorld, onWorld, notify }) {
  const dialog = node("dialog", undefined, "project-dialog world-artifact");
  dialog.id = "world-artifact";
  document.body.append(dialog);
  let generation = 0;
  dialog.addEventListener("close", () => generation++);
  async function open(artifact) {
    const visit = ++generation;
    dialog.replaceChildren(
      node("h2", artifact.title),
      button("建物へ戻る", () => dialog.close()),
    );
    const status = node("p", "成果を確認しています…"),
      output = node("pre", undefined, "world-artifact-output");
    dialog.append(status);
    if (!dialog.open) dialog.showModal();
    if (["preview", "tool"].includes(artifact.kind)) {
      status.textContent = artifact.evidence || "URLの応答は未確認です。";
      if (artifact.startInstructions)
        dialog.append(
          node("h3", "起動が必要な場合"),
          node("pre", artifact.startInstructions),
        );
      const link = projectLink(
        "使ってみる ↗",
        artifact.target,
        "world-artifact-link",
        (message) => (status.textContent = message),
      );
      link.href = artifact.target;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      dialog.append(
        link,
        node("p", "別の画面で開きます。この建物と地図の位置は残ります。"),
      );
      const check = async (confirmation) => {
        if (demo) {
          status.textContent = "デモでは接続を確認しません。";
          return;
        }
        status.textContent = "状態を確認しています…";
        try {
          const result = await api("world/artifact/check", {
            id: artifact.id,
            confirmation,
          });
          onWorld(result.world);
          if (visit === generation)
            status.textContent = result.artifact.evidence;
        } catch (error) {
          if (visit === generation) status.textContent = error.message;
        }
      };
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(artifact.target).hostname,
        )
      )
        dialog.append(button("起動状態を調べる", () => check()));
      dialog.append(
        button("別画面で使えた", () => check("opened")),
        button("まだ使えない", () => check("unavailable")),
      );
      return;
    }
    const query = node("input");
    query.placeholder = "この成果から探す";
    query.setAttribute("aria-label", "成果を検索");
    const search = node("form");
    search.append(
      query,
      button("検索", () => load()),
    );
    search.onsubmit = (e) => {
      e.preventDefault();
      load();
    };
    if (artifact.kind === "search") dialog.append(search);
    dialog.append(output);
    async function load(acceptVersion = false) {
      try {
        const result = demo
          ? {
              text:
                artifact.text ||
                "成果の記録",
            }
          : await api("world/artifact/use", {
              id: artifact.id,
              query: query.value,
              acceptVersion,
            });
        if (visit !== generation) return;
        status.textContent = "保存された成果 · " + artifact.target;
        output.textContent = result.text;
      } catch (error) {
        if (visit !== generation) return;
        status.textContent = error.message;
        output.textContent = "";
      }
    }
    dialog.append(
      button("再確認", () => load()),
      button("更新版を確認して開く", () => load(true)),
    );
    await load();
  }
  function register(container, project, building) {
    const details = node("details");
    details.append(node("summary", "成果を登録・追加する"));
    const form = node("form");
    const title = node("input");
    title.placeholder = "成果の名前";
    title.required = true;
    title.maxLength = 120;
    title.setAttribute("aria-label", "成果の名前");
    const kind = node("select");
    kind.setAttribute("aria-label", "成果の種類");
    for (const [value, label] of [
      ["document", "文書"],
      ["search", "文書内検索"],
      ["preview", "プレビュー"],
      ["tool", "ツール"],
    ]) {
      const option = node("option", label);
      option.value = value;
      kind.append(option);
    }
    const job = node("select");
    job.setAttribute("aria-label", "成果の工程");
    for (const item of project.jobs.filter(
      (j) => j.status === "done" && j.commit && j.repoId === building.repoId,
    )) {
      const option = node("option", item.title);
      option.value = item.id;
      job.append(option);
    }
    const target = node("input");
    target.required = true;
    target.placeholder = "文書の相対パス、または公開・localhostのURL";
    target.setAttribute("aria-label", "成果の場所");
    const instructions = node("textarea");
    instructions.placeholder = "起動が必要なら、その手順";
    instructions.setAttribute("aria-label", "起動手順");
    const submit = node("button", "この建物に登録");
    submit.type = "submit";
    const status = node("p");
    status.setAttribute("role", "status");
    form.append(title, kind, job, target, instructions, submit, status);
    details.append(form);
    container.append(details);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (demo) {
        status.textContent = "デモでは成果を保存しません。";
        return;
      }
      submit.disabled = true;
      try {
        const result = await api("world/artifact/register", {
          projectId: project.id,
          buildingId: building.id,
          jobId: job.value,
          title: title.value,
          kind: kind.value,
          target: target.value,
          startInstructions: instructions.value,
        });
        onWorld(result.world);
        container.prepend(
          button(
            "使ってみる · " + result.artifact.title,
            () => open(result.artifact),
            "primary",
          ),
        );
        status.textContent = "成果を登録しました。";
        form.reset();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    };
  }
  function building(container, project, building) {
    const artifacts = (getWorld()?.artifacts || []).filter(
      (a) =>
        a.projectId === project.id &&
        (a.buildingId === building.id ||
          (!building.jobId && a.repoId === building.repoId)),
    );
    if (!artifacts.length)
      container.append(
        node(
          "p",
          "使える成果はまだ登録されていません。PRが完成していても、プレビューの起動や公開は別の工程です。",
        ),
      );
    for (const artifact of artifacts) {
      const row = node("article");
      row.append(
        node("h3", artifact.title),
        node(
          "p",
          artifact.status === "ready"
            ? "保存された成果を確認済み"
            : artifact.evidence,
        ),
        button("使ってみる", () => open(artifact), "primary"),
      );
      container.append(row);
    }
    for (const pr of buildingPullRequests(project, building)) {
      const link = projectLink("作業のPRを見る", pr.url, undefined, notify);
      link.href = pr.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      container.append(link);
    }
    register(container, project, building);
  }
  return { open, building };
}
