import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const componentPath = value => typeof value === 'string' && value.length > 0 &&
  !path.isAbsolute(value) && !value.includes('\\') &&
  value.split('/').every(part => part && part !== '.' && part !== '..');

// Read only named files under the build root. In particular, never follow a
// restored symlink into an unrelated user directory while collecting notices.
async function checkedFile(root, relative) {
  if (!componentPath(relative)) throw Error(`Invalid notice path: ${relative}`);
  const parts = relative.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const file = path.join(root, ...parts.slice(0, i)), info = await lstat(file);
    if (info.isSymbolicLink()) throw Error(`Notice path is a symbolic link: ${relative}`);
    if (i < parts.length ? !info.isDirectory() : !info.isFile())
      throw Error(`Unexpected notice file type: ${relative}`);
  }
  return readFile(path.join(root, relative));
}

async function frontendSource(root, relative) {
  if (!relative.startsWith('public/')) return relative;
  try {
    const canonical = await lstat(path.join(root, 'public'));
    if (canonical.isDirectory() && !canonical.isSymbolicLink()) return relative;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // The recovery workspace stores public/ as an alias to frontend/. Do not
  // follow that alias; independently require the known owned directory.
  const restored = await lstat(path.join(root, 'frontend'));
  if (!restored.isDirectory() || restored.isSymbolicLink()) throw Error('Missing owned frontend notice directory');
  return 'frontend/' + relative.slice('public/'.length);
}

export async function prepareDistributionNotices({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = 'artifacts/distribution-notices', manifestPath = 'licenses/manifest.json'
} = {}) {
  root = path.resolve(root);
  if (!componentPath(output)) throw Error('Notice output must be a relative path under the build root');
  const manifest = JSON.parse(await checkedFile(root, manifestPath));
  if (manifest.schema !== 1 || !Array.isArray(manifest.packages) || !Array.isArray(manifest.notices))
    throw Error('Unsupported notice manifest');
  for (const expected of manifest.packages) {
    const installed = JSON.parse(await checkedFile(root, expected.path));
    if (installed.name !== expected.name || installed.version !== expected.version)
      throw Error(`Notice review required for ${expected.name}: expected ${expected.version}, installed ${installed.version}`);
  }
  const prepared = [], names = new Set();
  for (const entry of manifest.notices) {
    if (!componentPath(entry.output) || entry.output.includes('/') || entry.output === 'NOTICE-INDEX.json' || names.has(entry.output))
      throw Error(`Invalid or duplicate notice output: ${entry.output}`);
    names.add(entry.output);
    const content = await checkedFile(root, await frontendSource(root, entry.input));
    if (sha256(content) !== entry.sha256) throw Error(`Notice content changed: ${entry.input}`);
    prepared.push({ entry, content });
  }
  // Finish every input check before touching a previously successful output.
  const destination = path.join(root, output);
  const parts = output.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const directory = path.join(root, ...parts.slice(0, i));
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`Unsafe notice output: ${directory}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(directory); }
  }
  for (const { entry, content } of prepared) {
    // Output names are flat so an existing nested link cannot redirect a write.
    const target = path.join(destination, entry.output);
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw Error(`Unsafe notice output: ${entry.output}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(target, content, { mode: 0o644 });
  }
  const result = {
    schema: 1, reviewedPackages: manifest.packages.map(({ name, version }) => ({ name, version })),
    nativeComponents: manifest.nativeComponents || [],
    notices: prepared.map(({ entry, content }) => ({
      file: entry.output, bytes: content.length, sha256: sha256(content), source: entry.source,
      ...(entry.archive_member ? { archive_member: entry.archive_member, archive_sha256: entry.archive_sha256 } : {})
    })),
    coverage: manifest.coverage
  };
  const index = path.join(destination, 'NOTICE-INDEX.json');
  try {
    const info = await lstat(index);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Unsafe notice index');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(index, JSON.stringify(result, null, 2) + '\n', { mode: 0o644 });
  return { directory: destination, files: prepared.length + 1, bytes: prepared.reduce((sum, x) => sum + x.content.length, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw Error('This build step takes no arguments');
  await import('electron');
  console.log(JSON.stringify(await prepareDistributionNotices()));
}
