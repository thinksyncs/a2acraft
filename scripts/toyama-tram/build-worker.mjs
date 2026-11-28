// Bundle this buildless app for Cloud Sites, whose Worker entrypoint is a single ES module.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const [assetsDirectory, liveModule, output] = process.argv.slice(2);
if (!assetsDirectory || !liveModule || !output) {
  throw new Error('Usage: node build-tram-worker.mjs ASSETS_DIRECTORY LIVE_MODULE OUTPUT_FILE');
}
const files = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'model.js': 'text/javascript; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'data/replay.json': 'application/json; charset=utf-8',
};
const assets = {};
for (const [name, contentType] of Object.entries(files)) {
  assets['/' + name] = [await readFile(join(assetsDirectory, name), 'utf8'), contentType];
}
const service = JSON.parse(await readFile(join(assetsDirectory, 'data/service.json'), 'utf8'));
const live = await readFile(liveModule, 'utf8');
// Keep user-supplied request paths out of filesystem and network operations.
const adapter = `
const assets = ${JSON.stringify(assets)};
const service = ${JSON.stringify(service)};
const handleLive = createTramLiveHandler({loadSchedule: () => service});

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
    }
    const path = new URL(request.url).pathname;
    let response;
    if (path === '/api/live') {
      response = await handleLive();
    } else {
      const asset = assets[path === '/' ? '/index.html' : path];
      response = asset
        ? new Response(asset[0], {headers: {'Content-Type': asset[1], 'X-Content-Type-Options': 'nosniff'}})
        : new Response(null, {status: 404});
    }
    return request.method === 'HEAD' ? new Response(null, response) : response;
  },
};
`;
await mkdir(dirname(output), {recursive: true});
await writeFile(output, live + '\n' + adapter);
