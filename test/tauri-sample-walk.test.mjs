import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext, Script} from 'node:vm';

const driver = await readFile(new URL('../src-tauri/sample-walk.js', import.meta.url), 'utf8');
const scenario = await readFile(new URL('../electron/sample-walk-scenario.mjs', import.meta.url), 'utf8');
const guard = await readFile(new URL('../src-tauri/sample-input-guard.js', import.meta.url), 'utf8');

test('the bundled native scenario can be injected as a script', () => {
  assert.ok(scenario.startsWith('export function createSampleWalkScenario()'));
  new Script('(() => {' + scenario.slice('export '.length) + '\n' + driver + '\n})()');
});

test('capture forwards only sample regions and retains native pixel evidence', async () => {
  const calls = [];
  const signatures = {mapImage:'map-native',eyeImage:'eye-native',chatImage:null};
  const scene = {bounds:{width:1280,height:800},mapBounds:{},eyeBounds:{},chatBounds:null,
    resident:'fictional-name',reply:'fictional-reply'};
  const context = {
    location:{origin:'http://127.0.0.1:49152'},document:{hidden:false},
    createSampleWalkScenario:() => ({readSampleMap:() => scene, async run({frame, frames, state}) {
      await frame('overview', state());
      assert.equal(frames[0].mapImage, signatures.mapImage);
    }}),
    window:{__TAURI__:{core:{async invoke(command, {action,value}) {
      assert.equal(command,'desktop_request');
      calls.push({action, keys:Object.keys(value).sort(), verified:value.verified});
      return signatures;
    }}}}
  };
  await runInNewContext(driver, context);
  assert.deepEqual(calls,[{action:'sampleFrame',keys:['bounds','chatBounds','eyeBounds','mapBounds','phase'],verified:undefined},
    {action:'sampleDone',keys:['stage','verified'],verified:true}]);
  calls.length=0;
  context.document.hidden=true;
  await runInNewContext(driver,context);
  assert.deepEqual(calls,[{action:'sampleDone',keys:['stage','verified'],verified:false}]);
});

test('trusted gestures cannot import personal content into a fictional recording', () => {
  const handlers = new Map();
  runInNewContext(guard, {window:{addEventListener(name, callback, options) {
    assert.equal(options.capture,true);
    handlers.set(name,callback);
  }}});
  for (const name of ['click','keydown','paste','drop','submit','beforeinput']) {
    let stopped = false;
    const event = {isTrusted:true, preventDefault(){},stopImmediatePropagation(){stopped=true;}};
    handlers.get(name)(event);
    assert.equal(stopped,true,name);
    stopped=false;
    handlers.get(name)({...event,isTrusted:false});
    assert.equal(stopped,false,name);
  }
});
