import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectories = new Set(["frontend", "public", "electron", "test", "scripts", "src-tauri"]);
const excludedDirectories = new Set([
  "node_modules", "vendor", "generated", "artifacts", "dist", "build",
  "coverage", "target", ".git", ".cache",
]);
const sourceExtension = /\.(?:m?js|cjs|css|html|rs|py)$/;

// Inspect this repository's owned source without invoking Git, reading user
// configuration, or following directory/file symlinks. `public` may be a local
// restoration alias; in that case the real `frontend` directory is inspected.
export async function ownedSourceFiles(root) {
  const files = [];
  async function walk(directory, relative = "", topLevel = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isFile() && sourceExtension.test(entry.name)) files.push(name);
      else if (entry.isDirectory() && !excludedDirectories.has(entry.name) &&
        !entry.name.startsWith(".") && (!topLevel || sourceDirectories.has(entry.name)))
        await walk(path.join(directory, entry.name), name);
    }
  }
  await walk(root, "", true);
  return files.sort();
}

export async function checkModuleSizes(root) {
  const files = await ownedSourceFiles(root), oversized = [];
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8"),
      lines = source.split("\n").length, bytes = Buffer.byteLength(source);
    if (lines > 10000 || bytes > 180000) oversized.push(`${file}: ${lines} lines, ${bytes} bytes`);
  }
  return { count: files.length, oversized };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    result = await checkModuleSizes(root);
  if (result.oversized.length) {
    console.error("Split these source modules by responsibility:\n" + result.oversized.join("\n"));
    process.exitCode = 1;
  } else console.log(`Module size check passed (${result.count} source files; max 10,000 lines / 180 KB).`);
}
