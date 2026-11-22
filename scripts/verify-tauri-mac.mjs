import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw Error('Run this check on the Mac used to build the app');
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, 'src-tauri/target/release/bundle/macos/A2ACraft.app');
const backend = path.join(bundle, 'Contents/Resources/backend');
const node = path.join(backend, 'runtime/chat-ui-node');
const digest = async file => {
  if (!(await lstat(file)).isFile()) throw Error('Expected a regular file: ' + file);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};

execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle], { stdio: 'inherit' });
if (await digest(node) !== await digest(process.execPath)) {
  throw Error('Bundling changed the Node executable or its signing entitlements');
}
await access(node, constants.X_OK);
const runtimeCheck = `
  const assert = require('node:assert/strict');
  assert.equal(typeof require('node-pty').spawn, 'function');
  assert.equal(typeof require('@xberg-io/xberg').extract, 'function');
`;
execFileSync(node, ['-e', runtimeCheck], {
  cwd: backend,
  env: { PATH: '/usr/bin:/bin' },
  stdio: 'inherit'
});
console.log('Verified the macOS app seal, packaged Node runtime, terminal and document addons.');
