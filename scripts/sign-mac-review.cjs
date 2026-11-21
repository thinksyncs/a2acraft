const path = require('node:path');
const {lstat, rename} = require('node:fs/promises');
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
  // Keep the Electron binary next to the entry point so its framework rpath,
  // bundle resources and process.execPath subprocesses continue to resolve.
  const macOS = path.join(app, 'Contents', 'MacOS');
  const entry = path.join(macOS, context.packager.appInfo.productFilename);
  const runtime = path.join(macOS, 'A2ACraftRuntime');
  const launcher = path.join(macOS, '.a2acraft-launcher');
  await run('/usr/bin/clang', ['-arch','arm64','-mmacosx-version-min=13.0','-O2','-Wall','-Wextra','-Werror',
    path.join(context.packager.projectDir, 'scripts', 'mac-launcher.c'),
    '-framework','CoreGraphics','-framework','CoreFoundation','-o',launcher]);
  await rename(entry, runtime);
  await rename(launcher, entry);
  await run('/usr/bin/codesign', ['--force','--deep','--sign','-','--timestamp=none',
    '--preserve-metadata=entitlements,flags,runtime',app]);
  // Deep signing above gives a standalone Mach-O a name-derived identifier.
  // The process handling the window must keep this app's signing identifier
  // after exec. Seal the parent once more after signing that nested binary.
  await run('/usr/bin/codesign', ['--force','--sign','-','--timestamp=none',
    '--identifier',context.packager.appInfo.id,'--preserve-metadata=entitlements,flags,runtime',runtime]);
  await run('/usr/bin/codesign', ['--force','--sign','-','--timestamp=none',
    '--preserve-metadata=entitlements,flags,runtime',app]);
  await run('/usr/bin/codesign', ['--verify','--deep','--strict',app]);
};
