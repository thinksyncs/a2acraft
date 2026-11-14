import { chmod, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// node-pty's Unix helper must be executable, including in packaged apps.
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('node-pty/package.json'));
const directories = [path.join(root,'build','Release')];
try { for (const entry of await readdir(path.join(root,'prebuilds'))) directories.push(path.join(root,'prebuilds',entry)); } catch (error) { if(error.code !== 'ENOENT') throw error; }
for (const directory of directories) {
  const helper = path.join(directory,'spawn-helper');
  try { const info = await stat(helper); await chmod(helper, info.mode | 0o111); } catch (error) { if(error.code !== 'ENOENT') throw error; }
}
