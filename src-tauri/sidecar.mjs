// Invoked only by the Rust desktop host, over private stdin/stdout pipes.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {open, rename, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {createUiStateStore} from './electron/ui-state-store.mjs';
import {createMapStateStore} from './electron/map-state.mjs';
import {ensureAgentWorkspace} from './codex-workspace-policy.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = process.env.CHAT_UI_DATA_DIR;
if (!path.isAbsolute(data || '') || path.basename(data) !== 'data') throw Error('Invalid desktop data directory');
const profile = path.dirname(data);
const demo = process.argv.includes('--demo');
const stateOnly = process.argv.includes('--state-only');

function jsonFile(name) {
  const target = path.join(profile, name);
  return {
    async read() {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1) throw Error('Invalid desktop state file');
        return await file.readFile('utf8');
      } finally {
        await file.close();
      }
    },
    async write(body) {
      const temporary = target+'.'+randomUUID()+'.tmp';
      await writeFile(temporary, body, {mode:0o600,flag:'wx'});
      await rename(temporary, target);
    }
  };
}

const ui = createUiStateStore(jsonFile('ui-state.json'));
const map = createMapStateStore(jsonFile('map-state.json'));
const controls = createInterface({input:process.stdin, terminal:false});
const handlers = {
  uiRead: () => ui.read(),
  uiSave: value => ui.save(value),
  mapRead: value => map.read(value?.demo === demo ? demo : null),
  mapSave: value => {
    if (value?.demo !== demo) throw Error('Invalid map mode');
    return map.save(value);
  },
  prepareWorkspace: async value => {
    if (demo || stateOnly) throw Error('作業フォルダは通常起動で選択できます。');
    const {directory} = await ensureAgentWorkspace(value);
    return directory;
  }
};
let queue = Promise.resolve();
controls.on('line', line => {
  queue = queue.then(async () => {
    const {id,action,value} = JSON.parse(line);
    if (!Number.isSafeInteger(id) || !Object.hasOwn(handlers,action)) return;
    let response;
    try { response = {result:await handlers[action](value)}; }
    catch (error) { response = {error:String(error.message).slice(0,500)}; }
    process.stdout.write(JSON.stringify({type:'desktop-response',id,...response})+'\n');
  }).catch(() => {});
});

if (stateOnly) {
  // After a backend failure the host can still flush local drafts and the map.
  // No server, authentication or Codex process is started in this mode.
  console.log(JSON.stringify({type:'ready'}));
} else if (demo) {
  const {startPreviewServer} = await import('./electron/preview-server.mjs');
  const {staticFiles} = await import('./public-assets.mjs');
  const server = await startPreviewServer({root:path.join(root,'public'),assets:staticFiles,token:process.env.CHAT_UI_SESSION_TOKEN});
  if (process.stdin.readableEnded) {
    await queue;
    await server.close();
  } else {
    controls.once('close', () => queue.finally(() => server.close()));
    console.log(JSON.stringify({type:'ready',origin:server.origin,port:Number(new URL(server.origin).port)}));
  }
} else {
  await import('./backend-bootstrap.mjs');
  if (process.exitCode) {
    controls.close();
    process.stdin.pause();
  }
}
