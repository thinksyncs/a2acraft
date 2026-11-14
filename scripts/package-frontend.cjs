const path = require('node:path');
const fs = require('node:fs/promises');
const {constants} = require('node:fs');

function permittedPath(value) {
  if (!path.isAbsolute(value) || value.split(path.sep).some(part =>
    part === '.ssh' || /^proton(?:[ -]?(?:mail|drive|pass))$/i.test(part)))
    throw Error('Unsupported frontend packaging path');
}

async function ownedDirectory(directory, {create = false} = {}) {
  permittedPath(directory);
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try { info = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(current);
      info = await fs.lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Frontend packaging directory is not an owned directory');
  }
}

// Recovery may supply public -> frontend. Accept only that exact local alias;
// never traverse arbitrary links while preparing a distributable application.
async function copyPackagedFrontend({root, destination}) {
  root = path.resolve(root); destination = path.resolve(destination);
  permittedPath(root); permittedPath(destination);
  const relativeOutput = path.relative(root, destination);
  if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput))
    throw Error('Frontend package output must remain under the build root');
  await ownedDirectory(root);
  let source = path.join(root, 'public');
  const canonical = await fs.lstat(source);
  if (canonical.isSymbolicLink()) {
    if (await fs.readlink(source) !== 'frontend') throw Error('Unsupported public directory alias');
    source = path.join(root, 'frontend');
  }
  await ownedDirectory(source);
  const files = [];
  async function inventory(directory, relative = '') {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name), name = path.join(relative, entry.name);
      permittedPath(file);
      if (entry.isSymbolicLink()) throw Error('Frontend resources must not contain symbolic links');
      if (entry.isDirectory()) await inventory(file, name);
      else if (entry.isFile()) files.push(name);
      else throw Error('Unsupported frontend resource type');
    }
  }
  await inventory(source);
  if (!files.includes('index.html') || !files.includes('app.js')) throw Error('Frontend entry files are missing');
  // Validate the complete source before changing any previously built output.
  await ownedDirectory(destination, {create: true});
  for (const relative of files) {
    const output = path.join(destination, relative);
    await ownedDirectory(path.dirname(output), {create: true});
    const input = await fs.open(path.join(source, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await input.stat()).isFile()) throw Error('Frontend resource changed during packaging');
      const bytes = await input.readFile();
      const target = await fs.open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
      try { await target.writeFile(bytes); } finally { await target.close(); }
    } finally { await input.close(); }
  }
  return {files: files.length};
}

module.exports = {copyPackagedFrontend};
