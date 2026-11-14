const path = require('node:path');
const {lstat} = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const {copyPackagedFrontend} = require('./package-frontend.cjs');

// Package edits invalidate Electron's vendor signature. Review builds need an
// ad-hoc integrity signature on Apple Silicon, without consulting a keychain.
// This is not a Developer ID signature or Apple notarization.
module.exports = async function signMacReview(context) {
  if(context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const info = await lstat(app);
  if(!info.isDirectory() || info.isSymbolicLink()) throw Error('Expected a built application directory');
  await copyPackagedFrontend({root:context.packager.projectDir,
    destination:path.join(app,'Contents','Resources','backend','public')});
  await run('/usr/bin/codesign', ['--force','--deep','--sign','-','--timestamp=none',
    '--preserve-metadata=entitlements,flags,runtime',app]);
  await run('/usr/bin/codesign', ['--verify','--deep','--strict',app]);
};
