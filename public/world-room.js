import { partyStatusLabels } from "./party-runner.js";
import { roomScenery } from "./world-room-art.js";
import { drawWorldPerson } from "./village-art.js";
export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function button(text, action, className) {
  const element = node("button", text, className);
  element.type = "button";
  element.onclick = action;
  return element;
}
function portrait(room, name, hero = false, index = 0) {
  if (room === "castle" || room === "weapon") {
    const figure = node("img");
    figure.alt = name;
    figure.width = 144;
    figure.height = 200;
    figure.draggable = false;
    if (hero) {
      figure.src = index === 0 ? "/assets/room-leader.webp" : "/assets/room-companion.webp";
    } else {
      figure.src = room === "castle" ? "/assets/room-king.webp" : "/assets/room-armorer.webp";
    }
    return figure;
  }
  const canvas = node("canvas");
  canvas.width = 96;
  canvas.height = 128;
  canvas.setAttribute("aria-label", name);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.scale(4, 4);
  drawWorldPerson(
    ctx,
    { x: 12, y: 29, seed: name, conversationId: name },
    { hero, index, motion: false },
  );
  return canvas;
}
export function roomConversation(id, quest, squads = []) {
  if (id === "weapon") return {
    greeting: "どの仲間に武器を持たせる？　品ぞろえから好きな一本を試着してみな。",
    question: "武器は会話でどう使う？",
    answer: "武器には一つずつ技がある。店で仲間を選び、「装備する」で決めよう。その仲間の次の送信で技を使うぞ。弓は先に矢をつがえておくんだ。",
  };
  if (id !== "castle") return null;
  let answer = "まだ隊から冒険の記録は届いておらぬ。依頼を書き、酒場で仲間を編成してから出発しよう。";
  let record = null;
  if (quest) {
    const steps = Array.isArray(quest.steps) ? quest.steps : [];
    const complete = steps.filter(step => step.status === "completed").length;
    const next = steps.find(step => step.status !== "completed");
    const team = quest.party?.name || "冒険隊";
    const status = partyStatusLabels[quest.status] || "状況を確認中";
    const progress = steps.length ? `工程は${complete}／${steps.length}完了。` : "";
    const role = next?.role && ["running", "paused"].includes(quest.status)
      ? `${quest.status === "paused" ? "再開する工程" : "現在の担当"}は「${next.role}」だ。` : "";
    answer = `酒場からの報告では「${team}」は${status}。${progress}${role}`;
    record = {label: "酒場で冒険の記録を開く", questId: quest.id};
  } else if (squads.length) {
    const counts = new Map();
    for (const squad of squads) counts.set(squad.statusLabel, (counts.get(squad.statusLabel) || 0) + 1);
    const states = Array.from(counts, ([label, count]) => `${label}が${count}隊`).join("、");
    const first = squads[0];
    answer = `村の依頼は${squads.length}件。${states}だ。地図で「${first.partyName}」の報告を見てみよう。`;
    record = {label: "地図でこの隊を見る", squadId: first.id};
  }
  return {
    greeting: "ここで仲間に仕事を頼めるぞ。今日はどんな依頼かな？",
    question: "隊の進み具合を聞く",
    answer, record,
  };
}

export function createWorldRoom({ onExit, getProgress, onProgress, id = "world-room" }) {
  const dialog = node("dialog", undefined, "project-dialog world-room");
  dialog.id = id;
  document.body.append(dialog);
  let generation = 0,
    animation = null;
  function close() {
    generation++;
    animation?.cancel();
    animation = null;
    dialog.close();
  }
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    generation++;
    animation?.cancel();
    animation = null;
    onExit?.();
  });
  function open(facility, count, content) {
    const visit = ++generation;
    animation?.cancel();
    animation = null;
    dialog.replaceChildren();
    const title = node("h2", facility.name);
    title.id = id + "-title";
    dialog.setAttribute("aria-labelledby", title.id);
    const exit = button("街へ戻る", close, "world-room-exit");
    const stage = node("div", undefined, "world-room-stage");
    stage.dataset.room = facility.id;
    const host = button("", approach, "world-room-host");
    host.setAttribute("aria-label", facility.host + "に話しかける");
    host.append(portrait(facility.id, facility.host), node("span", facility.host));
    const party = node("div", undefined, "world-room-party");
    for (let i = 0; i < count; i++)
      party.append(portrait(facility.id, i ? "仲間" : "主人公", true, i));

    const conversation = roomConversation(facility.id);
    const speech = node("p", undefined, "world-room-speech");
    speech.setAttribute("role", "status");
    const line = node("span", conversation?.greeting || "いらっしゃい。こちらへどうぞ。");
    speech.append(node("strong", facility.host, "world-room-speaker"), line);
    const actions = node("div", undefined, "world-room-actions");
    actions.hidden = !conversation;
    stage.append(roomScenery(facility.id), host, party);
    dialog.append(title, exit, stage, speech, actions);

    let approached = false;
    let progressButton, record;
    if (conversation) {
      content(actions, close);
      actions.append(button(conversation.question, approach, "world-room-question"));
      if (facility.id === "castle" && onProgress) {
        progressButton = button("", () => {
          if (!record) return;
          close();
          onProgress(record);
        });
        progressButton.hidden = true;
        actions.append(progressButton);
      }
    }
    function approach() {
      if (visit !== generation || !dialog.open) return;
      if (conversation) {
        const progress = facility.id === "castle" ? getProgress?.() : null;
        const reply = roomConversation(facility.id, progress?.quest, progress?.squads);
        line.textContent = reply.answer;
        record = reply.record;
        if (progressButton) {
          progressButton.hidden = !record;
          progressButton.textContent = record?.label || "";
        }
      }
      if (approached) return;
      approached = true;
      function arrive() {
        if (visit !== generation || !dialog.open || conversation) return;
        line.textContent = facility.id === "tavern"
          ? "仲間を集めるかい。それとも、帰ってきた隊の話を聞こうか。"
          : "ここが、私たちの作ったものです。使える状態と作業の記録をご案内します。";
        actions.hidden = false;
        content(actions, close);
        actions.querySelector("button")?.focus();
      }
      const offset = innerWidth <= 600 ? -30 : -50;
      const transform = `translateY(${offset}px)`;
      party.style.transform = transform;
      if (typeof party.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches ||
          document.body.dataset.motion === "reduced") {
        arrive();
        return;
      }
      animation = party.animate([{ transform: "translateY(0)" }, { transform }], {
        duration: 450, easing: "ease-out",
      });
      animation.finished.then(arrive, arrive);
    }
    if (!dialog.open) dialog.showModal();
    host.focus({ preventScroll: true });
  }
  return { open, close, dialog };
}
