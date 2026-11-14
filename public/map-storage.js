import { createDraftPersistence } from "./draft-persistence.js";

export const MAP_STORAGE_KEYS = Object.freeze([
  "chat-ui-village-layout", "chat-ui-village-view", "chat-ui-resident-heard",
  "chat-ui-project-camera", "chat-ui-project-camera-hero",
  "chat-ui-project-camera-leader-inset", "chat-ui-project-camera-residents",
  "chat-ui-demo-village", "chat-ui-demo-village-layout", "chat-ui-demo-village-view",
  "chat-ui-resident-heard-demo", "chat-ui-project-camera-demo",
  "chat-ui-project-camera-demo-hero", "chat-ui-project-camera-demo-leader-inset",
  "chat-ui-project-camera-demo-residents-v2",
]);
const isDemoKey = (key) => key.includes("-demo");

// Browser sessions keep localStorage. Electron's port and storage partition
// change on each launch, so desktop maps use a small, explicit IPC snapshot.
export function createMapStorage({ storage = () => globalThis.localStorage } = {}) {
  let writer = null, keys = new Set(), values = {}, readError = null, frozen = false;
  function localRead(key) { try { return storage()?.getItem(key) ?? null; } catch { return null; } }
  function localWrite(key, value) { try { storage()?.setItem(key, value); } catch {} }
  return {
    async initialize({ desktop, demo = false, onError = () => {} } = {}) {
      if (!desktop?.getMapState || !desktop?.saveMapState) return;
      keys = new Set(MAP_STORAGE_KEYS.filter((key) => isDemoKey(key) === demo));
      for (const key of keys) { const value = localRead(key); if (value !== null) values[key] = value; }
      try {
        const saved = await desktop.getMapState({ demo });
        if (saved?.version !== 1 || !saved.items || typeof saved.items !== "object") throw Error("地図の保存形式を確認できません。");
        for (const [key, value] of Object.entries(saved.items)) if (keys.has(key) && typeof value === "string") {
          values[key] = value; localWrite(key, value);
        }
      } catch (error) {
        // Do not replace an unreadable saved map with fresh default positions.
        readError = Error("前回の地図を読み込めませんでした。保存済みの地図は変更しません。 " + error.message);
        onError(readError);
      }
      writer = createDraftPersistence({
        write: async (items) => { if (readError) throw readError; await desktop.saveMapState({ demo, items }); },
        onError,
      });
    },
    getItem(key) { return keys.has(key) && Object.hasOwn(values, key) ? values[key] : localRead(key); },
    setItem(key, value) {
      if (frozen && keys.has(key)) return;
      const text = String(value);
      localWrite(key, text);
      if (!writer || !keys.has(key) || values[key] === text) return;
      values[key] = text;
      void writer.persist(values);
    },
    async flush() {
      if (!writer) return;
      frozen = true;
      if (readError) throw readError;
      await writer.flush();
    },
    resume() { frozen = false; },
  };
}

export const mapStorage = createMapStorage();
