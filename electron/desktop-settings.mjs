import path from 'node:path';
import {readFile, rename, writeFile} from 'node:fs/promises';

const supportedLanguage = value => value === 'ja' || value === 'en';

export function createDesktopSettings(file) {
  let saved = {}, restartRequired = false, pending = Promise.resolve(), retry;

  function read() {
    return {
      codexPath: saved.codexPath || '',
      workDirectory: saved.workDirectory || '',
      interfaceLanguage: saved.interfaceLanguage ?? null,
      restartRequired
    };
  }

  async function load() {
    saved = {};
    try {
      const contents = JSON.parse(await readFile(file, 'utf8'));
      for (const key of ['codexPath', 'workDirectory']) {
        if (typeof contents[key] === 'string' && path.isAbsolute(contents[key])) saved[key] = contents[key];
      }
      if (typeof contents.accessibilitySupportEnabled === 'boolean') {
        saved.accessibilitySupportEnabled = contents.accessibilitySupportEnabled;
      }
      if (supportedLanguage(contents.interfaceLanguage)) saved.interfaceLanguage = contents.interfaceLanguage;
    } catch { /* New profiles start with system defaults. */ }
  }

  function update(changes, requiresRestart = true) {
    const commit = async () => {
      const next = {...saved, ...changes};
      await writeFile(file + '.tmp', JSON.stringify(next, null, 2), {mode: 0o600});
      await rename(file + '.tmp', file);
      saved = next;
      if (requiresRestart) restartRequired = true;
      retry = undefined;
      return read();
    };
    pending = pending.catch(() => {}).then(() => {
      retry = () => update(changes, requiresRestart);
      return commit();
    });
    return pending;
  }

  async function setInterfaceLanguage(language) {
    if (!supportedLanguage(language)) throw Error('Unsupported interface language');
    return update({interfaceLanguage: language}, false);
  }

  return {
    load, read, update, setInterfaceLanguage,
    idle: () => pending,
    get accessibilitySupportEnabled() { return saved.accessibilitySupportEnabled === true; },
    async flush() { try { await pending; } catch (error) { if (!retry) throw error; await retry(); } }
  };
}
