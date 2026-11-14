import { createUiStateWriter } from "./ui-state-writer.mjs";

export const MAP_STATE_KEYS = Object.freeze([
  "chat-ui-village-layout", "chat-ui-village-view", "chat-ui-resident-heard",
  "chat-ui-project-camera", "chat-ui-project-camera-hero",
  "chat-ui-project-camera-leader-inset", "chat-ui-project-camera-residents",
  "chat-ui-demo-village", "chat-ui-demo-village-layout", "chat-ui-demo-village-view",
  "chat-ui-resident-heard-demo", "chat-ui-project-camera-demo",
  "chat-ui-project-camera-demo-hero", "chat-ui-project-camera-demo-leader-inset",
  "chat-ui-project-camera-demo-residents-v2",
]);
const keys = new Set(MAP_STATE_KEYS), isDemoKey = (key) => key.includes("-demo");

export function validateMapItems(items, demo) {
  if (!items || typeof items !== "object" || Array.isArray(items)) throw Error("地図の保存形式が不正です。");
  const clean = {};
  for (const [key, value] of Object.entries(items)) {
    if (!keys.has(key) || (demo !== undefined && isDemoKey(key) !== demo)) throw Error("この地図の保存項目は許可されていません。");
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4 * 1024 * 1024) throw Error("地図の保存量が上限を超えています。");
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw Error("地図の保存内容が不正です。"); }
    if (!parsed || typeof parsed !== "object") throw Error("地図の保存内容が不正です。");
    clean[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(clean), "utf8") > 8 * 1024 * 1024) throw Error("地図の保存量が上限を超えています。");
  return clean;
}

// File I/O is supplied by the host and always targets its single map-state file.
export function createMapStateStore({ read, write }) {
  let items = {}, loaded = false;
  const writer = createUiStateWriter(write);
  async function load() {
    try {
      const saved = JSON.parse(await read());
      if (saved?.version !== 1) throw Error("地図の保存形式を確認できません。");
      items = validateMapItems(saved.items);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      items = {};
    }
    loaded = true;
  }
  return {
    load,
    async read(demo = false) {
      if (typeof demo !== "boolean") throw Error("地図の表示モードが不正です。");
      if (!loaded) await load();
      return { version: 1, items: Object.fromEntries(Object.entries(items).filter(([key]) => isDemoKey(key) === demo)) };
    },
    async save({ demo = false, items: value } = {}) {
      if (typeof demo !== "boolean") throw Error("地図の表示モードが不正です。");
      if (!loaded) await load();
      const next = validateMapItems(value, demo);
      items = validateMapItems({ ...Object.fromEntries(Object.entries(items).filter(([key]) => isDemoKey(key) !== demo)), ...next });
      await writer.save(JSON.stringify({ version: 1, items }));
      return { ok: true };
    },
    async flush() {
      if (!loaded) return;
      await writer.flush(() => JSON.stringify({ version: 1, items }));
    },
  };
}
