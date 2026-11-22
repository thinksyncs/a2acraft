// Keep this entry point independent of the backend's module graph so the
// desktop can distinguish Node startup from loading application dependencies.
const knownImportCodes = new Set([
  'EACCES', 'EPERM', 'ENOENT', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED',
  'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_PACKAGE_PATH_NOT_EXPORTED',
]);

function report(message) {
  if (!process.connected) {
    if (process.env.CHAT_UI_READY_STDOUT === '1') process.stdout.write(JSON.stringify(message) + '\n');
    return;
  }
  // Diagnostics must never gate loading the application. A delayed IPC flush
  // callback is not evidence that the backend cannot initialize.
  try { process.send(message, () => {}); } catch {}
}

report({type: 'startup-progress', stage: 'module-load'});
try {
  // The packaged sibling is fixed; no command-line or environment path is used.
  await import('./server.mjs');
} catch (error) {
  process.exitCode = 1;
  report({type: 'startup-error',
    code: knownImportCodes.has(error?.code) ? error.code : 'BACKEND_IMPORT_FAILED'});
}
