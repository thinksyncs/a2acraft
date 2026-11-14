import test from "node:test";
import assert from "node:assert/strict";
import { createMapStorage, MAP_STORAGE_KEYS } from "../public/map-storage.js";
import { createMapStateStore, MAP_STATE_KEYS, validateMapItems } from "../electron/map-state.mjs";

const camera = "chat-ui-project-camera", hero = camera + "-hero";
const village = "chat-ui-village-view", demoCamera = camera + "-demo";
const value = (n) => JSON.stringify({ x: n, y: n + 12, zoom: 0.5 });
function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}
function hostFile() {
  let bytes = null, failWrites = false, writes = 0;
  const disk = {
    read: async () => { if (bytes === null) throw Object.assign(Error("missing"), { code: "ENOENT" }); return bytes; },
    write: async (next) => { if (failWrites) throw Error("disk full"); bytes = next; writes++; },
  };
  return { disk, bytes: () => bytes, writes: () => writes, fail: (enabled) => { failWrites = enabled; } };
}
const bridge = (store) => ({
  getMapState: ({ demo }) => store.read(demo), saveMapState: (snapshot) => store.save(snapshot),
});

test("map camera, protagonist, district and visited residents survive a new desktop origin", async () => {
  const file = hostFile();
  const first = createMapStorage({ storage: () => memoryStorage() });
  await first.initialize({ desktop: bridge(createMapStateStore(file.disk)) });
  first.setItem(camera, value(1200));
  first.setItem(hero, JSON.stringify({ point: { x: 1300, y: 430 }, selected: "hero", heading: 1.2 }));
  first.setItem(village, JSON.stringify({ camera: { x: 700, y: 320, zoom: 0.7 }, district: 2, insetVisible: false }));
  first.setItem("chat-ui-resident-heard", JSON.stringify({ person: { version: 3, sources: ["job-4"] } }));
  first.setItem(camera + "-residents", JSON.stringify({ person: { position: { x: 900, y: 430 }, progress: 180 } }));
  await first.flush();

  const local = memoryStorage();
  const reopened = createMapStorage({ storage: () => local });
  await reopened.initialize({ desktop: bridge(createMapStateStore(file.disk)) });
  assert.equal(reopened.getItem(camera), value(1200));
  assert.equal(JSON.parse(reopened.getItem(hero)).point.x, 1300);
  assert.equal(JSON.parse(reopened.getItem(village)).district, 2);
  assert.equal(JSON.parse(reopened.getItem("chat-ui-resident-heard")).person.version, 3);
  assert.equal(JSON.parse(reopened.getItem(camera + "-residents")).person.progress, 180);
  assert.equal(local.getItem(camera), value(1200), "hydrate before the map controllers read their initial state");
});

test("demo and real maps remain separate across writes and restarts", async () => {
  const file = hostFile(), store = createMapStateStore(file.disk);
  await store.save({ demo: false, items: { [camera]: value(200) } });
  const demo = createMapStorage({ storage: () => memoryStorage() });
  await demo.initialize({ desktop: bridge(store), demo: true });
  assert.equal(demo.getItem(camera), null);
  demo.setItem(demoCamera, value(400));
  demo.setItem("unrelated-key", "never sent over IPC");
  await demo.flush();
  const restarted = createMapStateStore(file.disk);
  assert.deepEqual((await restarted.read(false)).items, { [camera]: value(200) });
  assert.deepEqual((await restarted.read(true)).items, { [demoCamera]: value(400) });
});

test("a failed map write stays retryable and close flush saves the final snapshot", async () => {
  const file = hostFile(), errors = [], map = createMapStorage({ storage: () => memoryStorage() });
  await map.initialize({ desktop: bridge(createMapStateStore(file.disk)), onError: (error) => errors.push(error) });
  file.fail(true);
  map.setItem(camera, value(500));
  await assert.rejects(map.flush(), /disk full/);
  assert.ok(errors.length);
  file.fail(false);
  await map.flush();
  assert.equal(JSON.parse(file.bytes()).items[camera], value(500));
  map.setItem(camera, value(700));
  assert.equal(map.getItem(camera), value(500), "automatic motion cannot race a close-time snapshot");
  map.resume();
  map.setItem(camera, value(700));
  await map.flush();
  assert.equal(JSON.parse(file.bytes()).items[camera], value(700));
});

test("an unreadable saved map is never overwritten by fresh default positions", async () => {
  let writes = 0;
  const store = createMapStateStore({ read: async () => "{broken", write: async () => { writes++; } });
  const map = createMapStorage({ storage: () => memoryStorage() });
  await map.initialize({ desktop: bridge(store) });
  map.setItem(camera, value(0));
  await assert.rejects(map.flush(), /読み込めません/);
  assert.equal(writes, 0);
  await assert.rejects(store.save({ demo: false, items: { [camera]: value(0) } }));
  assert.equal(writes, 0);
});

test("browser-only maps keep using localStorage without any desktop bridge", async () => {
  const local = memoryStorage(), map = createMapStorage({ storage: () => local });
  await map.initialize();
  map.setItem(camera, value(300));
  await map.flush();
  assert.equal(local.getItem(camera), value(300));
  assert.equal(map.getItem(camera), value(300));
});

test("IPC accepts only bounded JSON for the exact map keys and selected namespace", () => {
  assert.deepEqual(MAP_STATE_KEYS, MAP_STORAGE_KEYS);
  for (const items of [{ arbitrary: "{}" }, { [camera]: "not json" }, { [camera]: "null" },
    { [camera]: "1" }, { [camera]: "x".repeat(4 * 1024 * 1024 + 1) }, JSON.parse('{"__proto__":"{}"}')])
    assert.throws(() => validateMapItems(items, false));
  assert.throws(() => validateMapItems({ [demoCamera]: "{}" }, false));
  assert.throws(() => validateMapItems({ [camera]: "{}" }, true));
  assert.deepEqual(validateMapItems({ [camera]: value(200) }, false), { [camera]: value(200) });
});
