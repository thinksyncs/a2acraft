import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { staticFiles } from "../public-assets.mjs";

const publicRoot = new URL("../public/", import.meta.url);
const origin = "http://127.0.0.1:4317";
const vendors = new Set(["/vendor/xterm.mjs", "/vendor/addon-fit.mjs", "/vendor/xterm.css"]);
const assetPath = /^\/(?:fonts|assets)\/[A-Za-z0-9_./-]+\.(?:woff2?|ttf|otf|svg|png|jpe?g|webp|gif)$/;

async function publicSourceFiles(directory = "") {
  const files = [];
  for (const entry of await readdir(new URL(directory, publicRoot), { withFileTypes: true })) {
    const relative = directory + entry.name;
    if (entry.isDirectory()) files.push(...await publicSourceFiles(relative + "/"));
    else if (entry.isFile() && /\.(?:js|css)$/.test(relative)) files.push(relative);
  }
  return files.sort();
}

async function requireResource(reference, owner) {
  const url = new URL(reference, origin + "/" + owner);
  if (url.origin !== origin) return;
  if (vendors.has(url.pathname)) return;
  const relative = staticFiles[url.pathname] || (
    assetPath.test(url.pathname) && !url.pathname.split("/").includes("..")
      ? url.pathname.slice(1) : null
  );
  assert.ok(relative, `${owner} requests an unserved resource: ${reference}`);
  assert.equal((await stat(new URL(relative, publicRoot))).isFile(), true,
    `${owner} requests a missing resource: ${reference}`);
}

test("every public JavaScript module and stylesheet is explicitly served", async () => {
  assert.deepEqual(Object.values(staticFiles).filter((file) => /\.(?:js|css)$/.test(file)).sort(),
    await publicSourceFiles());
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /import\s*\{\s*staticFiles,\s*publicFramePolicy\s*\}\s*from\s*['"]\.\/public-assets\.mjs['"]/);
});

test("the entry page and all module imports, styles, fonts and images resolve", async () => {
  let imports = 0, resources = 0;
  for (const file of Object.values(staticFiles)) {
    const source = await readFile(new URL(file, publicRoot), "utf8");
    if (file.endsWith(".js")) {
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]((?:\.{1,2}\/|\/)[^'"]+)['"]/g)) {
        await requireResource(match[1], file);
        imports++;
      }
      for (const match of source.matchAll(/['"]((?:\/assets\/|\/fonts\/)[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|gif|woff2?))[^'"]*['"]/g)) {
        await requireResource(match[1], file);
        resources++;
      }
    }
    if (file.endsWith(".css")) {
      for (const match of source.matchAll(/url\(\s*['"]?([^\s'")]+)['"]?\s*\)/g)) {
        await requireResource(match[1], file);
        resources++;
      }
    }
    if (file.endsWith(".html")) {
      for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        if (!/^(?:\.{1,2})?\//.test(match[1]) || match[1].startsWith("/?")) continue;
        await requireResource(match[1], file);
        resources++;
      }
    }
  }
  assert.ok(imports > 50, "check the real frontend module graph");
  assert.ok(resources > 20, "check the entry page and visual resources");
});

test("the source allowlist does not expose backend files or traversal paths", () => {
  for (const url of ["/server.mjs", "/package.json", "/public-assets.mjs", "/../server.mjs",
    "/assets/../../server.mjs", "/%2e%2e/server.mjs", "/constructor", "/__proto__"]) {
    assert.equal(staticFiles[url], undefined, url);
  }
  assert.equal(Object.getPrototypeOf(staticFiles), null);
  assert.equal(Object.isFrozen(staticFiles), true);
});
