import {worldText, worldBinding, getLocale} from './i18n-world.js';
import { node, button } from "./world-room.js";

const kinds = {
  get finding(){return worldText("発見");},
  get decision(){return worldText("決定");},
  get blocker(){return worldText("障害");},
  get handoff(){return worldText("引継ぎ");},
};
export function createAgentBoard({
  api,
  demo,
  getState,
  getProjects,
  getChats = () => [],
  onChat,
}) {
  const dialog = node("dialog", undefined, "project-dialog agent-board");
  dialog.id = "agent-board";
  dialog.setAttribute("aria-labelledby", "agent-board-title");
  const header = node("header"),
    title = node("h2", worldBinding("隊の掲示板"));
  title.id = "agent-board-title";
  header.append(
    node("small", worldBinding("仲間からの便り")),
    title,
    button(worldBinding("閉じる"), () => dialog.close()),
  );
  const scopeLabel = node("label", worldBinding("読む場所")),
    scope = node("select");
  scope.setAttribute("aria-label", worldText("掲示板の地区"));
  scopeLabel.append(scope);
  const status = node("p", "", "agent-board-status");
  status.setAttribute("role", "status");
  const entries = node("div", undefined, "agent-board-entries");
  const refresh = button(worldBinding("新着を確認"), () => load());
  dialog.append(
    header,
    node(
      "p",
      worldBinding("発見や引継ぎを、担当同士で共有しています。投稿元の会話で詳しく確認できます。"),
    ),
    scopeLabel,
    refresh,
    status,
    entries,
  );
  document.body.append(dialog);
  let generation = 0,
    signature = "",
    renderedRevision = -1,
    filterSignature = "",
    pending = false;
  function filters(selected) {
    const next = JSON.stringify([getLocale(),getProjects().map((p) => [p.id, p.name])]);
    if (next === filterSignature) {
      scope.value = selected;
      return;
    }
    filterSignature = next;
    scope.replaceChildren();
    for (const [id, name] of [
      ["all", worldText("すべての便り")],
      ["shared", worldText("全地区への共有")],
      ...getProjects().map((p) => [p.id, p.name]),
    ]) {
      const option = node("option", name);
      option.value = id;
      scope.append(option);
    }
    scope.value = [...scope.options].some((o) => o.value === selected)
      ? selected
      : "all";
  }
  function samples() {
    const projects = getProjects();
    const sources = projects.length
      ? projects
      : getChats()
          .filter((chat) => chat.messages?.length)
          .slice(0, 2)
          .map((chat) => ({
            id: "demo-village",
            get name(){return worldText("冒険者の村");},
            jobs: [{ conversationId: chat.id }],
          }));
    return sources.slice(0, 2).map((p, i) => ({
      id: "sample-" + i,
      sequence: i + 1,
      scope: i ? "shared" : "project",
      kind: i ? "finding" : "handoff",
      title: i ? worldText("地区をまたぐ発見") : worldText("次の担当への引継ぎ"),
      summary: i
        ? worldText("検索画面でも、前の会話に戻れる導線が役立ちそうです。実装前に対象の画面を確認してください。")
        : worldText("一覧から履歴を開く導線を確認しました。次は小さな画面でも操作できるか、検証担当に見てほしいです。"),
      author: {
        projectId: p.id,
        projectName: p.name,
        get jobTitle(){return worldText("担当からの便り");},
        conversationId: p.jobs.find((j) => j.conversationId)?.conversationId,
      },
    }));
  }
  async function load() {
    const ticket = ++generation,
      selected = scope.value,
      revision = getState().agentBoard?.revision || 0;
    pending = true;
    status.textContent = worldText("便りを読み込んでいます…");
    try {
      const result = demo
        ? {
            entries: samples().filter(
              (e) =>
                selected === "all" ||
                e.scope === "shared" ||
                e.author.projectId === selected,
            ),
          }
        : await api(
            "agent-board/read",
            selected === "all" || selected === "shared"
              ? { scope: selected }
              : { projectId: selected },
          );
      if (ticket !== generation || !dialog.open) return;
      renderedRevision = revision;
      const rows = result.entries.slice().reverse(),
        next = JSON.stringify([getLocale(),selected,rows]);
      status.textContent = demo
        ? worldText("{count}件の便り", {count:rows.length})
        : rows.length
          ? worldText("{count}件の便り{limit}。担当が参照した時に伝わります。", {count:result.total,limit:result.omitted?worldText(' · 最新100件を表示'):''})
          : worldText("まだ便りはありません。開発の隊が作業中に、ほかの担当へ伝える要点を投稿します。");
      if (signature === next) return;
      signature = next;
      entries.replaceChildren();
      for (const entry of rows) {
        const card = node("article", undefined, "agent-board-note");
        card.dataset.kind = entry.kind;
        const meta = node("div", undefined, "agent-board-meta");
        meta.append(
          node("span", kinds[entry.kind] || entry.kind, "agent-board-kind"),
          node(
            "span",
            entry.scope === "shared" ? worldText("全地区へ") : entry.author.projectName,
          ),
        );
        card.append(
          meta,
          node("h3", entry.title),
          node("p", entry.summary),
          node("small", entry.author.jobTitle),
        );
        if (entry.createdAt) {
          const time = node("time", new Date(entry.createdAt).toLocaleString());
          time.dateTime = new Date(entry.createdAt).toISOString();
          card.append(time);
        }
        if (entry.author.conversationId)
          card.append(
            button(worldBinding("投稿元の会話を開く"), () => {
              dialog.close();
              onChat(entry.author.conversationId);
            }),
          );
        entries.append(card);
      }
    } catch (error) {
      if (ticket === generation) {
        renderedRevision = revision;
        status.textContent = worldText("読み込めませんでした: ") + error.message;
      }
    } finally {
      if (ticket === generation) pending = false;
    }
  }
  scope.onchange = () => load();
  dialog.addEventListener("close", () => {
    generation++;
    pending = false;
  });
  return {
    open(projectId = "all") {
      filters(projectId);
      if (!dialog.open) dialog.showModal();
      load();
    },
    render() {
      if (!dialog.open) return;
      filters(scope.value);
      if (
        !pending &&
        renderedRevision !== (getState().agentBoard?.revision || 0)
      )
        load();
    },
  };
}
