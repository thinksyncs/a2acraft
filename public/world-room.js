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
function portrait(name, hero = false, index = 0) {
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
  if (name === "王様") {
    ctx.fillStyle = "#f1ca68";
    ctx.fillRect(8, 7, 8, 2);
    ctx.fillRect(8, 5, 2, 3);
    ctx.fillRect(11, 4, 2, 4);
    ctx.fillRect(14, 5, 2, 3);
  }
  return canvas;
}
export function createWorldRoom({ onExit, id = "world-room" }) {
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
    generation++;
    animation?.cancel();
    onExit?.();
  });
  function open(facility, count, content) {
    generation++;
    const visit = generation;
    animation?.cancel();
    dialog.replaceChildren();
    const title = node("h2", facility.name),
      exit = button("街へ戻る", close, "world-room-exit");
    const stage = node("div", undefined, "world-room-stage");
    stage.dataset.room = facility.id;
    const host = button("", approach, "world-room-host");
    host.setAttribute("aria-label", facility.host + "に話しかける");
    host.append(portrait(facility.host), node("span", facility.host));
    const party = node("div", undefined, "world-room-party");
    for (let i = 0; i < count; i++)
      party.append(portrait(i ? "仲間" : "主人公", true, i));
    const speech = node(
        "p",
        "いらっしゃい。こちらへどうぞ。",
        "world-room-speech",
      ),
      actions = node("div", undefined, "world-room-actions");
    actions.hidden = true;
    stage.append(roomScenery(facility.id), host, party);
    dialog.append(title, exit, stage, speech, actions);
    const reduced =
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.body.dataset.motion === "reduced";
    function approach() {
      const offset = innerWidth <= 600 ? -30 : -50;
      if (host.disabled) return;
      host.disabled = true;
      const arrived = () => {
        if (generation !== visit || !dialog.open) return;
        party.style.transform = `translateY(${offset}px)`;
        speech.textContent =
          facility.id === "weapon"
            ? "必要な技を選んでおくれ。k tokenは、使うときの推定消費量だよ。"
            : facility.id === "castle"
              ? "街から報告が届いている。次は何を形にしようか。"
              : facility.id === "tavern"
                ? "仲間を集めるかい。それとも、帰ってきた隊の話を聞こうか。"
                : "ここが、私たちの作ったものです。使える状態と作業の記録をご案内します。";
        actions.hidden = false;
        content(actions, close);
      };
      if (reduced) {
        arrived();
        return;
      }
      animation = party.animate(
        [
          { transform: "translateY(0)" },
          { transform: `translateY(${offset}px)` },
        ],
        { duration: 750, fill: "forwards", easing: "linear" },
      );
      animation.finished.then(arrived).catch(() => {});
    }
    if (!dialog.open) dialog.showModal();
    host.focus();
  }
  return { open, close, dialog };
}
