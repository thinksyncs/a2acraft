import {projectText} from './i18n-projects.js';
import { projectLink } from "./project-link.js";
import { node, button } from "./world-room.js";
import { jobLabel, projectBuildings } from "./project-buildings.js";
import { topicNames } from "./world-geography.js";

export function createProjectDetail({
  drawer,
  api,
  demo,
  getProjects,
  getChats,
  getWorld,
  getState,
  onState,
  onWorld,
  onChat,
  onBoard,
  onEvent,
  world,
  notify,
}) {
  let selectedId = null,
    selectedJob = null,
    dirty = false;
  drawer.addEventListener("input", () => (dirty = true));
  drawer.addEventListener("close", () => (dirty = false));
  async function configure(p, action) {
    try {
      onState(await api("projects/configure", { id: p.id, action }));
      render();
    } catch (error) {
      notify(error.message);
    }
  }
  function geography(p) {
    const details = node("details");
    details.append(node("summary", projectText("地区の話題と会話の所属")));
    const form = node("form");
    const place = getWorld()?.places?.[p.id] || {},
      chosen = place.topics || place.evidence?.map((e) => e.topic) || [];
    details.append(
      node(
        "p",
        projectText("話題の根拠：") +
          ((place.evidence || [])
            .map(
              (e) =>
                (topicNames[e.topic] || e.topic) +
                "（" +
                (e.source === "goal"
                  ? projectText("目的")
                  : e.source === "user"
                    ? projectText("自分で指定")
                    : projectText("会話 ") + e.source) +
                "）",
            )
            .join("、") || projectText("まだ判断する材料がありません。")),
      ),
    );
    for (const [id, name] of Object.entries(topicNames)) {
      const label = node("label", name),
        input = node("input");
      input.type = "checkbox";
      input.name = "topic";
      input.value = id;
      input.checked = chosen.includes(id);
      label.prepend(input);
      form.append(label);
    }
    const fixed = node("label", projectText("この位置を固定する")),
      pin = node("input");
    pin.type = "checkbox";
    pin.checked = Boolean(place.pinned);
    fixed.prepend(pin);
    form.append(fixed);
    const save = node("button", projectText("話題を保存"));
    save.type = "submit";
    form.append(save);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        if (demo) throw Error(projectText("デモでは話題を保存しません。"));
        onWorld(
          await api("world/topics", {
            projectId: p.id,
            topics: [...form.querySelectorAll("[name=topic]:checked")].map(
              (e) => e.value,
            ),
            pinned: pin.checked,
          }),
        );
        dirty = false;
        notify(
          projectText("話題を保存しました。現在の位置は保ち、再配置は地図から確認できます。"),
        );
      } catch (error) {
        notify(error.message);
      }
    };
    details.append(form);
    const history = node("select");
    history.setAttribute("aria-label", projectText("地区に紐づける過去の会話"));
    for (const chat of getChats()
      .filter((c) => !c.project)
      .slice(0, 1000)) {
      const option = node("option", chat.characterName || chat.title);
      option.value = chat.id;
      history.append(option);
    }
    details.append(
      history,
      button(projectText("この会話の住民を地区に迎える"), async () => {
        try {
          if (demo) throw Error(projectText("デモでは会話の所属を保存しません。"));
          onWorld(
            await api("world/link", {
              projectId: p.id,
              conversationId: history.value,
            }),
          );
          dirty = false;
          notify(projectText("元の会話を保ったまま、地区に住民を迎えました。"));
        } catch (error) {
          notify(error.message);
        }
      }),
    );
    return details;
  }
  function revision(p) {
    const details = node("details");
    details.append(node("summary", projectText("目的と未着手の工程を見直す")));
    const form = node("form");
    form.append(
      node(
        "p",
        projectText("作業を休止してから保存できます。実行済みの工程・会話・成果は記録として残します。"),
      ),
    );
    const goal = node("textarea");
    goal.value = p.goal;
    goal.required = true;
    goal.maxLength = 2400;
    goal.setAttribute("aria-label", projectText("見直す目的"));
    form.append(goal);
    const steps = p.jobs
      .filter(
        (j) => j.kind === "implement" && j.status === "queued" && !j.attempt,
      )
      .map((job) => {
        const field = node("textarea");
        field.value = job.task;
        field.required = true;
        field.maxLength = 4000;
        field.setAttribute("aria-label", projectText("{name}の作業",{name:job.title}));
        const title = node("input");
        title.value = job.title;
        title.required = true;
        title.maxLength = 120;
        title.setAttribute("aria-label", projectText("{name}の機能名",{name:job.title}));
        const criteria = node("textarea");
        criteria.value = job.criteria;
        criteria.required = true;
        criteria.maxLength = 2000;
        criteria.setAttribute("aria-label", projectText("{name}の達成条件",{name:job.title}));
        form.append(node("label", job.title), title, field, criteria);
        return { job, field, title, criteria };
      });
    const submit = node("button", projectText("見直しを保存"));
    submit.type = "submit";
    form.append(submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        if (demo) throw Error(projectText("デモでは工程を変更しません。"));
        onState(
          await api("projects/revise", {
            id: p.id,
            goal: goal.value,
            steps: steps.map(({ job, field, title, criteria }) => ({
              id: job.id,
              task: field.value,
              title: title.value,
              criteria: criteria.value,
            })),
          }),
        );
        dirty = false;
        notify(projectText("見直しを保存しました。準備ができたら作業を再開できます。"));
        render();
      } catch (error) {
        notify(error.message);
      }
    };
    details.append(form);
    return details;
  }
  function render() {
    if (!selectedId || dirty) return;
    const p = getProjects().find((p) => p.id === selectedId);
    if (!p) return;
    const scroll = drawer.scrollTop;
    drawer.replaceChildren(
      node("small", projectText("地区の記録")),
      node("h2", p.name),
      node("p", p.goal),
      node("p", projectText("おまかせ進行では、目的を伝えると調査・実装・検証を進め、本人の判断が必要なときだけ確認します。")),
      button(projectText("閉じる"), () => drawer.close()),
    );
    const actions = node("div", undefined, "project-actions");
    const pause = button(p.paused ? projectText("作業を再開") : projectText("作業を休止"), () =>
      configure(p, p.paused ? "resume" : "pause"),
    );
    const mode = button(
      p.automatic ? projectText("自動モードを止める") : projectText("自動モードにする"),
      () => configure(p, p.automatic ? "manual" : "automatic"),
    );
    pause.disabled = mode.disabled = demo;
    actions.append(pause, mode, button(projectText("この地区の掲示板"), () => onBoard(p.id)));
    drawer.append(actions);
    if (p.status === "delivered") {
      const accepted = getState().adventure?.journal?.some(
        (j) => j.projectId === p.id,
      );
      drawer.append(
        button(
          accepted
            ? projectText("この成果は冒険の成長に反映済み")
            : projectText("成果を確認して次の地方を開く"),
          async () => {
            try {
              if (demo) throw Error(projectText("デモの成果は成長に加算しません。"));
              getState().adventure = await api("world/reward", {
                projectId: p.id,
              });
              notify(
                projectText("成果を冒険の記録に加えました。世界地図から新しい地方と戦法を使えます。"),
              );
              render();
            } catch (error) {
              notify(error.message);
            }
          },
          "primary",
        ),
      );
    }
    for (const event of p.events.filter((e) => e.status === "open"))
      drawer.append(
        button("! " + event.question, () => onEvent(p, event), "project-event"),
      );
    const sites = node("div", undefined, "project-actions");
    for (const b of projectBuildings(p))
      sites.append(
        button(projectText("{name}へ行く",{name:b.name}), () => {
          drawer.close();
          world.enter(p, b);
        }),
      );
    drawer.append(sites);
    for (const job of p.jobs) {
      const row = node("article", undefined, "project-job");
      row.append(
        node("strong", job.title),
        node("span", jobLabel(job)),
        node(
          "p",
          job.status === "blocked"
            ? job.error || projectText("判断を待っています。")
            : job.output || job.criteria || "",
        ),
      );
      row.dataset.job = job.id;
      if (job.id === selectedJob) {
        row.classList.add("selected");
        row.prepend(node("small", projectText("選択中の隊")));
      }
      const decisions = Array.isArray(job.decisions)
        ? job.decisions.filter((decision) => typeof decision === "string" && decision.trim())
        : [];
      if (decisions.length) {
        const details = node("details");
        const list = node("ul");
        details.append(node("summary", projectText("今回の判断")));
        for (const decision of decisions) list.append(node("li", decision));
        details.append(list);
        row.append(details);
      }
      if (job.conversationId)
        row.append(
          button(projectText("この隊の会話"), () => {
            drawer.close();
            onChat(job.conversationId);
          }),
        );
      if (job.conversationId && ["done", "paused"].includes(job.status))
        row.append(
          button(projectText("この隊を操作"), () => {
            if (world.control(p.id, job.id)) drawer.close();
          }),
        );
      drawer.append(row);
    }
    for (const pr of p.pullRequests || []) {
      try {
        const url = new URL(pr.url);
        if (url.protocol === "https:" && url.hostname === "github.com") {
          const link = projectLink(
            projectText("成果のPRを開く →"),
            url.href,
            "project-pr",
            notify,
          );
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          drawer.append(link);
        }
      } catch {}
    }
    drawer.append(geography(p), revision(p));
    drawer.scrollTop = scroll;
  }
  return {
    render,
    open(id, jobId) {
      selectedId = id;
      selectedJob = jobId || null;
      dirty = false;
      render();
      if (!drawer.open) drawer.showModal();
      if (jobId)
        drawer
          .querySelector(".project-job.selected")
          ?.scrollIntoView({ block: "center" });
    },
  };
}
