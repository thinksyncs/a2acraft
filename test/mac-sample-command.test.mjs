import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const source = new URL('../scripts/record-mac-village.command', import.meta.url);
const phases = ['overview','walk','arrival','chat-input','chat-reply','ambient'];

test('Finder recorder preserves launch diagnostics and builds playback only for a complete native report', {skip:process.platform !== 'darwin'}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2acraft recorder '));
  t.after(() => rm(directory, {force:true,recursive:true}));
  const contents = path.join(directory, 'A2ACraft.app/Contents');
  await mkdir(path.join(contents,'MacOS'), {recursive:true});
  await copyFile('/usr/bin/true', path.join(contents,'MacOS/A2ACraft'));
  await writeFile(path.join(contents,'Info.plist'), `<plist version="1.0"><dict>
    <key>CFBundleExecutable</key><string>A2ACraft</string>
    <key>CFBundleIdentifier</key><string>com.thinksyncs.chatui</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleShortVersionString</key><string>0.0.1</string>
    <key>CFBundlePackageType</key><string>APPL</string>
  </dict></plist>`);
  await run('/usr/bin/codesign', ['--force','--sign','-','--timestamp=none',path.dirname(contents)]);

  // Launch Services is the test boundary. The verification, diagnostics and
  // playback generator run with stock macOS commands against a signed fixture.
  const script = (await readFile(source, 'utf8')).replace('/usr/bin/open -n ', '/bin/sh "$here/launch-fixture" -n ');
  const launcher = path.join(directory,'record.command');
  await writeFile(launcher,script);
  await writeFile(path.join(directory,'launch-fixture'), `set -eu
[ "$1" = -n ] && [ "$2" = --stderr ] && [ "$5" = --args ] && [ "$6" = --demo ] && [ "$7" = --record-sample-walk ] || exit 9
if [ "$A2A_FIXTURE_LAUNCH" = fail ]; then echo "fixture launch error -10827" >&2; exit 15; fi
profile=\${8#--preview-data-dir=}
mkdir -p "$profile/recording"
cp "$A2A_FIXTURE_FILES"/* "$profile/recording/"`);
  const fixture = path.join(directory,'frames');
  await mkdir(fixture);
  const frames = phases.map((phase,index) => ({
    file: index ? `frame-${String(index).padStart(3,'0')}.jpg` : 'overview.jpg',phase,atMs:index*1000
  }));
  for (const {file} of frames) await writeFile(path.join(fixture,file),'sample frame');
  async function exercise(mode, list) {
    await writeFile(path.join(fixture,'result.json'),JSON.stringify({status:'verified',frames:list}));
    const before = new Set(await readdir(directory));
    const env = {...process.env,A2A_FIXTURE_LAUNCH:mode,A2A_FIXTURE_FILES:fixture};
    const result = await run('/bin/sh',[launcher],{env}).then(()=>0,err=>err.code);
    const created = (await readdir(directory)).filter(name=>!before.has(name));
    assert.equal(created.length,1);
    const folder=path.join(directory,created[0]);
    return {result,log:await readFile(path.join(folder,'startup.txt'),'utf8'),folder};
  }
  const denied = await exercise('fail',frames);
  assert.equal(denied.result,15);
  assert.match(denied.log,/fixture launch error -10827/);
  const partial = await exercise('success',frames.slice(0,-1));
  assert.equal(partial.result,1);
  assert.match(partial.log,/ambient/);
  const good = await exercise('success',frames);
  assert.equal(good.result,0);
  const html = await readFile(path.join(good.folder,'sample/recording/村の散策と会話.html'),'utf8');
  for (const frame of frames) assert.ok(html.includes(JSON.stringify([frame.file,frame.phase,frame.atMs])));
  assert.doesNotMatch(html,/https?:\/\//);
});
