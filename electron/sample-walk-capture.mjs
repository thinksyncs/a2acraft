import path from 'node:path';
import {mkdir, rename, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createSampleWalkScenario} from './sample-walk-scenario.mjs';
import {createHash} from 'node:crypto';
import {revealWindow, startupPageURL} from './window-lifecycle.mjs';

async function bounded(operation, limit, message) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), limit); })]); }
  finally { clearTimeout(timer); }
}

const {clock, readSampleMap, waitFor, recordWalkingFrames, recordResidentMeeting, run} = createSampleWalkScenario();
export {recordWalkingFrames, recordResidentMeeting};
const startupDocument = startupPageURL();

function sampleWindowStatus(window, origin) {
  if (window.isDestroyed()) throw Error('Sample window was closed');
  const contents = window.webContents;
  if (!contents || contents.isDestroyed() || contents.isCrashed()) throw Error('Sample renderer was lost');
  const href = contents.getURL();
  let page = 'startup';
  if (!href || href === 'about:blank') page = 'blank';
  else if (href !== startupDocument) {
    const url = new URL(href);
    const query = url.searchParams;
    if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/' || url.username || url.password ||
        query.get('desktop') !== '1' || query.get('demo') !== '1' ||
        query.get('village') !== 'sample' || query.get('walk') !== 'resident') page = 'unexpected';
    else page = 'sample';
  }
  return {page, visible:window.isVisible(), minimized:window.isMinimized(), loading:contents.isLoadingMainFrame()};
}

// Finder may start a window before macOS marks it visible. Never evaluate JS
// or request pixels from the splash, a different origin, or a hidden window.
export function createSamplePresentation(window, origin, report, timing = clock, reveal = revealWindow) {
  let presented = false;
  return async function ensureVisible() {
    const deadline = timing.now() + (presented ? 8_000 : 35_000);
    let recovered = false;
    for (;;) {
      const status = sampleWindowStatus(window, origin);
      report.presentation = status;
      if (status.page === 'unexpected' || (presented && status.page !== 'sample'))
        throw Error('Window navigated away from the isolated sample');
      if (status.page === 'sample' && status.visible && !status.minimized && !status.loading) {
        presented = true;
        return;
      }
      if ((!status.visible || status.minimized) && !recovered) {
        reveal(window);
        recovered = true;
      }
      if (timing.now() >= deadline)
        throw Error('Timed out waiting for sample presentation (' + status.page +
          ', visible=' + status.visible + ', minimized=' + status.minimized + ', loading=' + status.loading + ')');
      await timing.wait(180);
    }
  };
}

function thumbnailSignature(image, rect, name) {
  const cropped = image.crop(rect);
  if (cropped.isEmpty()) throw Error('Sample compositor returned an empty ' + name);
  const bitmap = cropped.resize({width:48, height:32}).toBitmap();
  let low = 255, high = 0;
  for (let index = 0; index < bitmap.length; index += 4) {
    const brightness = (bitmap[index] + bitmap[index + 1] + bitmap[index + 2]) / 3;
    low = Math.min(low, brightness); high = Math.max(high, brightness);
  }
  if (high - low < 8) throw Error('Sample compositor returned a blank ' + name);
  return createHash('sha256').update(bitmap).digest('hex');
}

export async function captureSampleWalk(window, {profile, origin, version, reveal = revealWindow}) {
  const directory = path.join(profile, 'recording');
  await mkdir(directory, {mode:0o700});
  const contents = window.webContents, frames = [], start = performance.now();
  const report = {version, source:'visible Electron BrowserWindow capturePage', status:'recording', frames};
  const ensureVisible = createSamplePresentation(window, origin, report, clock, reveal);
  const state = async (action = 'read', residentId = '', question = '') => {
    if (action !== 'read') report.stage = action;
    await ensureVisible();
    const args = [origin, action, residentId, question].map(value => JSON.stringify(value)).join(',');
    const call = () => bounded(contents.executeJavaScript('(' + readSampleMap.toString() + ')(' + args + ')'), 12_000, 'Sample renderer timed out');
    let value = await call();
    if (value.pending === 'page-hidden') {
      reveal(window);
      value = await waitFor(async () => {await ensureVisible(); return call();}, s => s.pending !== 'page-hidden', 8_000);
      if (!value) throw Error('Sample page remained hidden after showing its window');
    }
    report.renderer = value.pending || 'ready';
    return value.pending ? null : value;
  };
  const frame = async (phase, map) => {
    report.stage = phase;
    await ensureVisible();
    const shot = await bounded(contents.capturePage(map.bounds), 9_000, 'Sample compositor timed out');
    const after = sampleWindowStatus(window, origin);
    report.presentation = after;
    if (after.page !== 'sample' || !after.visible || after.minimized || after.loading)
      throw Error('Sample presentation changed during frame capture');
    if (shot.isEmpty()) throw Error('Sample compositor returned an empty frame');
    const size = shot.getSize();
    // DOM rectangles are in CSS pixels; captures on Retina displays can have
    // a larger image representation. Crop only after matching the viewport.
    const viewport = size.width === map.bounds.width && size.height === map.bounds.height ? shot :
      shot.resize({width:map.bounds.width, height:map.bounds.height});
    const mapImage = thumbnailSignature(viewport, map.mapBounds, 'overhead map');
    const eyeImage = thumbnailSignature(viewport, map.eyeBounds, 'leader view');
    const chatImage = map.chatBounds && thumbnailSignature(viewport, map.chatBounds, 'map chat');
    const file = phase === 'overview' ? 'overview.jpg' : `frame-${String(frames.length).padStart(3,'0')}.jpg`;
    const jpg = shot.resize({width:Math.min(1280, shot.getSize().width)}).toJPEG(86);
    await writeFile(path.join(directory, file), jpg, {flag:'wx', mode:0o600});
    frames.push({file, phase, atMs:Math.round(performance.now() - start), ...map, mapImage, eyeImage, chatImage});
  };
  try {
    await run({state, frame, frames, stage: value => { report.stage = value; }});
    report.status = 'verified';
  } catch (error) {
    report.status = 'failed';
    report.reason = String(error.message).slice(0, 200);
  }
  const temp = path.join(directory, 'result.tmp');
  await writeFile(temp, JSON.stringify(report, null, 2), {flag:'wx', mode:0o600});
  await rename(temp, path.join(directory, 'result.json'));
  return report.status === 'verified';
}
