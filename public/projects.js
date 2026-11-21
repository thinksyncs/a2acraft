import { createProjectWorld } from "./project-world.js";
import { createWorldRoom } from "./world-room.js";
import { createArtifactView } from "./world-artifact-view.js";
import { createProjectDetail } from "./project-detail.js";
import { createAgentBoard } from "./agent-board.js";
import { residentReport, acknowledgeResidentReport, associationSpeech, mapTranscriptText } from "./world-dialogue.js";
import {renderConversationDetails,renderEncounterContext} from './conversation-details.js';
import { placeDistricts } from "./world-geography.js";
import { projectDemoJourneys } from "./project-demo.js";
import { facilities, jobLabel } from "./project-buildings.js";
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const button = (text, action, className) => {
  const n = node("button", text, className);
  n.type = "button";
  n.onclick = action;
  return n;
};
export function initProjects({
  castleRecords,
  api,
  demo,
  getState,
  getChats,
  getModel,
  onChat,
  onMap,
  onLegacy,
  onState,
  onNavigate,
  notify,
}) {
  const root = document.querySelector("#project-village"),
    toolbar = node("div", undefined, "project-toolbar"),
    heading = node("div");
  heading.append(
    node("small", "DEVELOPMENT WORLD"),
    node("h2", "育っていく街"),
  );
  const add = button("＋ 新しい地区", () => create.showModal(), "primary");
  add.id = "project-add";
  const back = button("冒険者の村へ", onLegacy);
  const agentBoard = createAgentBoard({api, demo, getState, getProjects: () => projects(), getChats, onChat});
  const boardButton = button("隊の掲示板", () => agentBoard.open());
  boardButton.id = "agent-board-open";
  toolbar.append(heading, back, boardButton, add);
  root.append(toolbar);
  const banner = node("p", undefined, "project-notice");
  banner.setAttribute("role", "status");
  root.append(banner);
  const frame = node("div", undefined, "project-map-frame"),
    canvas = node("canvas"),
    overlay = node("div", undefined, "project-map-overlay");
  canvas.id = "project-map";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "開発の全体マップ。矢印キーで移動、Homeで全体へ。地区と相談は下の一覧からも開けます。",
  );
  frame.append(canvas, overlay);
  root.append(frame);
  const controls = node("nav", undefined, "project-map-controls");
  controls.setAttribute("aria-label", "地図の操作");
  let paused = false;
  const motion = button("動きを止める", () => {
    paused = !paused;
    world.pause(paused);
    motion.textContent = paused ? "動きを再開" : "動きを止める";
    motion.setAttribute("aria-pressed", String(paused));
  });
  motion.setAttribute("aria-pressed", "false");
  controls.append(
    button("−", () => world.zoom(1 / 1.3)),
    button("全体へ", () => world.fit()),
    button("＋", () => world.zoom(1.3)),
    motion,
  );
  root.append(controls);
  const list = node("details", undefined, "project-directory");
  list.append(node("summary", "地区と隊の一覧"));
  const entries = node("div");
  list.append(entries);
  root.append(list);
  const residentsMenu = node("details", undefined, "project-residents-menu");
  residentsMenu.append(node("summary", "住民を探す"));
  const residentSelect = node("select");
  residentSelect.id = "project-resident-select";
  residentSelect.setAttribute("aria-label", "話しかける住民");
  const residentTalk = button("話しかける", () => {
    if (world.talkTo(residentSelect.value)) residentsMenu.open = false;
    else notify("今はこの住民を見つけられません。別の住民を選んでください。");
  });
  residentsMenu.append(residentSelect, residentTalk);
  controls.after(residentsMenu);
  let residentSignature = "";
  function renderResidents() {
    const people = world.getResidents();
    const next = JSON.stringify(people.map(p => [p.conversationId, p.name, p.title]));
    if (next === residentSignature) return;
    residentSignature = next;
    const selected = residentSelect.value;
    residentSelect.replaceChildren();
    for (const person of people) {
      const option = node("option", (person.name || person.title) + " · " + (getChats().find(c => c.id === person.conversationId)?.title || "会話"));
      option.value = person.conversationId;residentSelect.append(option);
    }
    if (people.some(p => p.conversationId === selected)) residentSelect.value = selected;
    residentTalk.disabled = !people.length;
    residentsMenu.hidden = !people.length;
  }
  const drawer = node("dialog", undefined, "project-dialog");
  drawer.id = "project-detail";
  document.body.append(drawer);
  const speech = node("dialog", undefined, "project-dialog");
  speech.id = "project-speech";
  document.body.append(speech);
  const create = node("dialog", undefined, "project-dialog");
  create.id = "project-create";
  const form = node("form");
  const title = node("h2", "新しい地区をつくる");
  title.id = "project-create-title";
  create.setAttribute("aria-labelledby", title.id);
  const field = (label, id, tag, max) => {
    const wrap = node("label", label),
      input = node(tag);
    input.id = id;
    input.required = true;
    input.maxLength = max;
    wrap.append(input);
    form.append(wrap);
    return input;
  };
  form.append(
    title,
    node(
      "p",
      "目的を渡すと、調査から編成・実装・検証・PR作成まで隊が進めます。判断が必要になったら、街に「!」が届きます。",
    ),
  );
  const name = field("地区の名前", "project-name", "input", 80),
    goal = field("何をできるようにしたい？", "project-goal", "textarea", 2400),
    repo = field(
      "GitHub repoのURL またはローカルの絶対パス（1行に1件・最大4件）",
      "project-repository",
      "textarea",
      8200,
    );
  repo.placeholder = "https://github.com/owner/repository";
  const note = node(
    "p",
    "専用の作業場所とブランチで進めます。PRのマージと本番公開は含みません。Git・GitHub CLIの認証とCodex接続を使います。",
    "project-form-note",
  );
  const error = node("p", undefined, "error");
  error.setAttribute("role", "alert");
  const submit = node("button", "地区をつくって任せる", "primary");
  submit.type = "submit";
  const cancel = button("閉じる", () => create.close());
  form.append(note, error, submit, cancel);
  create.append(form);
  document.body.append(create);
  let requestId = null,
    fingerprint = "",
    creating = false,
    signature = "",
    chatSignature = "";
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (creating) return;
    if (demo) {
      error.textContent =
        "画面確認用のデモです。実接続画面で地区を追加できます。";
      return;
    }
    const input = {
        name: name.value.trim(),
        goal: goal.value.trim(),
        repositories: repo.value
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        ...getModel(),
      },
      next = JSON.stringify(input);
    if (next !== fingerprint) {
      fingerprint = next;
      requestId = crypto.randomUUID();
    }
    creating = true;
    submit.disabled = true;
    error.textContent = "";
    try {
      const result = await api("projects/create", { ...input, requestId });
      const current = getState().projects || { items: [] };
      if (!current.items.some((p) => p.id === result.id))
        current.items.push(result);
      onState(current);
      create.close();
      form.reset();
      requestId = null;
      fingerprint = "";
      onMap();
      world.fit();
      openDistrict(result.id);
    } catch (reason) {
      error.textContent = reason.message;
    } finally {
      creating = false;
      submit.disabled = false;
    }
  };
  const projects = () => getState().projects?.items || [];
  let demoWorld = null;
  function worldState() {
    if (!demo) return getState().world || {};
    if (
      !demoWorld ||
      Object.keys(demoWorld.places).length !== projects().length
    ) {
      const places = placeDistricts(projects(), getChats());
      const journeys = projectDemoJourneys(projects(), getChats(), places);
      demoWorld = { places, journeys, visits: {}, artifacts: [] };
    }
    return demoWorld;
  }
  function updateWorld(value) {
    getState().world = value;
    world.render();
  }
  let chatsCache = [],
    chatsSource = null,
    linksSource = null;
  function worldChats() {
    const source = getChats(),
      links = worldState().links;
    if (source !== chatsSource || links !== linksSource) {
      chatsSource = source;
      linksSource = links;
      chatsCache = source.map((c) =>
        links?.[c.id] ? { ...c, project: { id: links[c.id] } } : c,
      );
    }
    return chatsCache;
  }

  async function eventOpen(p, event) {
    try {
      if (!demo)
        onState(await api("projects/read", { id: p.id, eventId: event.id }));
      else {
        event.seen = true;
        if (event.kind === "progress") event.status = "resolved";
      }
    } catch (error) {
      notify(error.message);
    }
    drawer.close();
    if (event.conversationId) onChat(event.conversationId);
    else openDistrict(p.id);
  }
  let speechVisit = 0,
    shownSpeechVisit = 0, handedOffVisit = 0;
  speech.addEventListener("close", () => {
    if (!speech.open && speechVisit === shownSpeechVisit && handedOffVisit !== shownSpeechVisit) {
      speechVisit++;
      world.release();
    }
  });
  async function resident(id, journey, encounter) {
    const chat = worldChats().find((c) => c.id === id);
    if (!chat) return;
    const visit = ++speechVisit;
    try {
      const p = projects().find((p) => p.id === chat.project?.id);
      const report = demo
        ? residentReport(chat, p, worldState().visits[id])
        : await api("world/speech", { conversationId: id });
      if (visit !== speechVisit) return;
      const reportBody = node("div");
      renderEncounterContext(reportBody, chat, report);
      speech.replaceChildren(node("h2", mapTranscriptText(chat.characterName) || mapTranscriptText(chat.title) || "村人"), reportBody);
      if (journey) {
        const from = projects().find((p) => p.id === journey.from),
          to = projects().find((p) => p.id === journey.to);
        if (from && to)
          speech.append(
            node("small", "道中の話の種"),
            node("p", associationSpeech(from, to).text),
            button(to.name + "の記録を見る", () => {
              speech.close();
              openDistrict(to.id);
            }),
          );
      }
      const source = node("details");
      const exchange = node("div");
      renderConversationDetails(exchange, chat);
      source.append(node("summary", "依頼と最新の返答を読む"), exchange);
      speech.append(
        source,
        button(
          chat.project ? "作業の記録・相談を見る" : "話す",
          () => {
            const snapshot = world.getEncounter() || encounter;
            handedOffVisit = visit;
            speech.close();
            onChat(id, snapshot);
          },
          "primary",
        ),
        button("またね", () => speech.close()),
      );
      shownSpeechVisit = visit;
      if (!speech.open) speech.show();
      if (demo) worldState().visits[id] = acknowledgeResidentReport(worldState().visits[id], report);
      else
        await api("world/heard", {
          conversationId: id,
          version: report.version,
        });
    } catch (error) {
      if (visit === speechVisit && handedOffVisit !== visit) world.endEncounter();
      notify(error.message);
    }
  }
  const artifactView = createArtifactView({
    api,
    demo,
    getWorld: worldState,
    onWorld: updateWorld,
    notify,
  });
  const room = createWorldRoom({
    onExit: () => world.release(),
    ...castleRecords,
  });
  function openRoom(facility, count) {
    room.open(facility, count, (content, close) => {
      if (facility.id === "building") {
        artifactView.building(content, facility.project, facility.building);
        return;
      }
      if (facility.id === "weapon")
        content.append(
          button(
            "武器を選んで試着する",
            () => {
              close();
              onNavigate?.("weapon");
            },
            "primary",
          ),
        );
      if (facility.id === "castle")
        content.append(
          button(
            "新しい地区を任せる",
            () => {
              close();
              create.showModal();
            },
            "primary",
          ),
          button("依頼を書く", () => {
            close();
            onNavigate?.("castle");
          }),
        );
      if (facility.id === "tavern")
        content.append(
          button(
            "仲間と役割を編成する",
            () => {
              close();
              onNavigate?.("tavern");
            },
            "primary",
          ),
          button("主人公を操作する", () => {
            close();
            world.control();
          }),
        );
      if (facility.id !== "weapon")
        for (const p of projects())
          content.append(
            button(p.name + "の隊と報告", () => {
              close();
              openDistrict(p.id);
            }),
          );
    });
  }
  const world = createProjectWorld({
    canvas,
    overlay,
    getProjects: projects,
    getChats: worldChats,
    getWorld: worldState,
    onDismissSpeech: () => {
      speechVisit++;
      if (speech.open) speech.close();
    },
    onDistrict: openDistrict,
    onEvent: eventOpen,
    onResident: resident,
    onRoom: openRoom,
    onParty: (id, jobId) => detail.open(id, jobId),
    notify,
  });
  const detail = createProjectDetail({
    onBoard: id => { drawer.close(); agentBoard.open(id); },
    drawer,
    api,
    demo,
    getProjects: projects,
    getChats,
    getWorld: worldState,
    getState,
    onState,
    onWorld: updateWorld,
    onChat,
    onEvent: eventOpen,
    world,
    notify,
  });
  function openDistrict(id) {
    detail.open(id);
  }
  function renderDetail() {
    detail.render();
  }
  const travelMenu = node("details", undefined, "world-travel-menu");
  travelMenu.append(node("summary", "行き先と地図の設定"));
  for (const facility of facilities)
    travelMenu.append(
      button(facility.name + "へ歩く", () => world.visit(facility)),
    );
  travelMenu.append(
    button("移動を取り消す", () => world.cancel()),
    button("主人公を操作", () => world.control()),
  );
  travelMenu.append(
    button("話題に沿った配置を確認", async () => {
      if (demo) {
        notify("デモは話題に沿った配置を表示しています。");
        return;
      }
      try {
        const preview = await api("world/layout-preview", {});
        speech.replaceChildren(node("h2", "地区の再配置を確認"));
        for (const p of projects()) {
          const old = preview.previous[p.id],
            next = preview.places[p.id];
          speech.append(
            node(
              "p",
              p.name +
                "：(" +
                old.x +
                ", " +
                old.y +
                ") → (" +
                next.x +
                ", " +
                next.y +
                ")",
            ),
          );
        }
        speech.append(
          button(
            "この配置にする",
            async () => {
              try {
                updateWorld(
                  await api("world/layout-apply", {
                    revision: preview.revision,
                  }),
                );
                speech.close();
                world.cancel();
                world.fit();
              } catch (error) {
                notify(error.message);
              }
            },
            "primary",
          ),
          button("閉じる", () => speech.close()),
        );
        if (speech.open) speech.close();
        speech.showModal();
      } catch (error) {
        notify(error.message);
      }
    }),
  );
  controls.after(travelMenu);
  const legacy = document.querySelector("#history-village");
  const access = button("開発の全体マップ →", onMap, "project-world-access");
  access.id = "project-world-access";
  legacy.prepend(access);
  const chatBanner = node("section", undefined, "project-chat-context");
  chatBanner.id = "project-chat-context";
  chatBanner.hidden = true;
  document.querySelector("#composer").before(chatBanner);
  function chatContext(chat, onOption) {
    const p = projects().find((p) => p.id === chat?.project?.id),
      job = p?.jobs.find((j) => j.id === chat?.project?.jobId),
      event = p?.events.find(
        (e) =>
          e.jobId === job?.id && e.kind !== "progress" && e.status === "open",
      );
    chatBanner.hidden = !p;
    if (!p) return;
    const sig = JSON.stringify([p.id, p.paused, p.automatic, job, event]);
    if (sig === chatSignature) return;
    chatSignature = sig;
    chatBanner.replaceChildren(
      node("strong", p.name + " · " + (job ? jobLabel(job) : "")),
      button("街へ戻る", onMap),
    );
    if (event) {
      chatBanner.append(node("p", event.question));
      const context = node("details");
      context.append(
        node("summary", "調べたこと・試したこと"),
        node("p", event.summary),
      );
      chatBanner.append(context);
      for (const option of event.options || [])
        chatBanner.append(button(option, () => onOption(option)));
      if (p.paused || !p.automatic)
        chatBanner.append(
          node(
            "small",
            "回答は保存されます。作業の再開は地区の記録から行えます。",
          ),
        );
    } else
      chatBanner.append(
        node(
          "p",
          job?.status === "done" ? "この工程は完了しました。"
            : p.paused || job?.status === "paused" ? "休止中です。"
            : !p.automatic ? "自動進行を停止しています。"
            : job?.status === "queued" ? "順番が来ると自動で進めます。"
            : job?.status === "blocked" ? "必要な情報を確認しています。"
            : "おまかせで進行中。追加の回答は不要です。",
        ),
      );
    const decisions = Array.isArray(job?.decisions)
      ? job.decisions.filter(value => typeof value === "string").slice(0, 8) : [];
    if (decisions.length) {
      const detail = node("details"), list = node("ul");
      detail.append(node("summary", "今回の判断 · " + decisions.length + "件"));
      for (const decision of decisions) list.append(node("li", decision));
      detail.append(list);chatBanner.append(detail);
    }
  }
  function render() {
    agentBoard.render();
    const state = getState().projects || {},
      items = projects();
    banner.hidden = demo;
    banner.textContent = demo
      ? ""
      : state.runtimeError
        ? "記録の保存を確認してください: " + state.runtimeError
        : state.waitingReason ||
          (!items.length
            ? "新しい地区に目的とrepoを渡して、街の開発を始めましょう。"
            : (state.activeCount || 0) +
              "隊が作業中 · 同時に" +
              (state.concurrency || 2) +
              "隊まで");
    const next = JSON.stringify(
      items.map((p) => [
        p.id,
        p.name,
        p.updatedAt,
        p.jobs.map((j) => j.status),
        p.events,
      ]),
    );
    if (next !== signature) {
      signature = next;
      entries.replaceChildren();
      for (const p of items) {
        const row = node("div");
        row.append(
          button(p.name, () => {
            world.focus(p.id);
            openDistrict(p.id);
          }),
        );
        for (const event of p.events.filter((e) => e.status === "open"))
          row.append(button("! " + event.question, () => eventOpen(p, event)));
        entries.append(row);
      }
      if (drawer.open) renderDetail();
    }
    world.render();
    renderResidents();
  }
  return {
    render,
    saveView: () => world.saveView(),
    getEncounter: () => world.getEncounter(),
    endEncounter: () => world.endEncounter(),
    chatContext,
    openBoard: () => agentBoard.open(),
    setVisible(value, {preserveEncounter = false} = {}) {
      root.hidden = !value;
      if (!value && !preserveEncounter && speech.open) speech.close();
      world.setVisible(value, {preserveEncounter});
      if (value) render();
    },
    openCreate() {
      create.showModal();
    },
    focus() {
      canvas.focus();
      world.render();
    },
  };
}
