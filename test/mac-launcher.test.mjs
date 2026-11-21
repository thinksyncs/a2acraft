import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('Mac entry reports a missing desktop and preserves Electron and backend arguments', {skip:process.platform !== 'darwin'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'a2acraft-launcher-test-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const launcher = join(dir, 'A2ACraft');
  const runtime = join(dir, 'A2ACraftRuntime');
  const source = fileURLToPath(new URL('../scripts/mac-launcher.c', import.meta.url));
  const session = join(dir, 'session.c');
  const echo = join(dir, 'runtime.c');
  // Substitute a controlled session provider only when compiling this fixture.
  // The shipping entry calls CoreGraphics and has no environment override.
  await writeFile(session, `#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
CFDictionaryRef fixture_session(void) {
  if (getenv("FIXTURE_DESKTOP") == NULL) return NULL;
  return CFDictionaryCreate(NULL, NULL, NULL, 0, NULL, NULL);
}
`);
  await writeFile(echo, `#include <stdio.h>
int main(int argc, char *argv[]) {
  for (int i = 1; i < argc; i++) puts(argv[i]);
  return 23;
}
`);
  function compile(args) {
    const result = spawnSync('/usr/bin/clang', args, {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
  compile(['-DCGSessionCopyCurrentDictionary=fixture_session', source, session, '-framework', 'CoreFoundation', '-o', launcher]);
  compile([echo, '-o', runtime]);
  const args = ['引数 with spaces', '--second'];
  const run = env => spawnSync(launcher, args, {env, encoding:'utf8'});
  const unavailable = run({});
  assert.equal(unavailable.status, 69, unavailable.stderr);
  assert.match(unavailable.stderr, /画面セッション/);
  assert.equal(unavailable.stdout, '');
  for (const env of [{FIXTURE_DESKTOP:'yes'}, {ELECTRON_RUN_AS_NODE:'1'}]) {
    const forwarded = run(env);
    assert.equal(forwarded.status, 23, forwarded.stderr);
    assert.deepEqual(forwarded.stdout.trimEnd().split('\n'), args);
  }
  await rm(runtime);
  const damaged = run({FIXTURE_DESKTOP:'yes'});
  assert.equal(damaged.status, 71, damaged.stderr);
  assert.match(damaged.stderr, /Electronの起動に失敗/);
});
