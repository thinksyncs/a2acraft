import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareDistributionNotices } from '../scripts/prepare-distribution-notices.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'a2acraft-notices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'licenses'));
  await mkdir(path.join(root, 'dependency'));
  await writeFile(path.join(root, 'dependency/package.json'), JSON.stringify({ name: 'reviewed-dependency', version: '1.2.3' }));
  const text = 'Copyright Example\nPermission to redistribute this notice.\n';
  await writeFile(path.join(root, 'dependency/LICENSE'), text);
  const manifest = { schema: 1,
    packages: [{ path: 'dependency/package.json', name: 'reviewed-dependency', version: '1.2.3' }],
    notices: [{ input: 'dependency/LICENSE', output: 'dependency-LICENSE.txt',
      sha256: createHash('sha256').update(text).digest('hex'), source: 'https://example.com/release/1.2.3/LICENSE' }]
  };
  await writeFile(path.join(root, 'licenses/manifest.json'), JSON.stringify(manifest));
  return { root, text, manifest };
}

test('build notices preserve exact license bytes and link the reviewed version and source', async t => {
  const { root, text } = await fixture(t);
  const result = await prepareDistributionNotices({ root });
  assert.equal(await readFile(path.join(result.directory, 'dependency-LICENSE.txt'), 'utf8'), text);
  const index = JSON.parse(await readFile(path.join(result.directory, 'NOTICE-INDEX.json'), 'utf8'));
  assert.deepEqual(index.reviewedPackages, [{ name: 'reviewed-dependency', version: '1.2.3' }]);
  assert.equal(index.notices[0].source, 'https://example.com/release/1.2.3/LICENSE');
  assert.equal(index.notices[0].bytes, Buffer.byteLength(text));
});

test('dependency drift or modified license stops the build before replacing existing output', async t => {
  const { root, text } = await fixture(t);
  const result = await prepareDistributionNotices({ root });
  await writeFile(path.join(root, 'dependency/package.json'), JSON.stringify({ name: 'reviewed-dependency', version: '2.0.0' }));
  await assert.rejects(prepareDistributionNotices({ root }), /Notice review required/);
  await writeFile(path.join(root, 'dependency/package.json'), JSON.stringify({ name: 'reviewed-dependency', version: '1.2.3' }));
  await writeFile(path.join(root, 'dependency/LICENSE'), 'changed terms');
  await assert.rejects(prepareDistributionNotices({ root }), /Notice content changed/);
  assert.equal(await readFile(path.join(result.directory, 'dependency-LICENSE.txt'), 'utf8'), text);
});

test('notice collection never follows links or writes outside its own output', async t => {
  const { root, manifest } = await fixture(t);
  await symlink('dependency', path.join(root, 'linked'));
  manifest.notices[0].input = 'linked/LICENSE';
  await writeFile(path.join(root, 'licenses/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(prepareDistributionNotices({ root }), /symbolic link/);
  await assert.rejects(prepareDistributionNotices({ root, output: '../other' }), /relative path/);
});

test('canonical public assets and the restored frontend directory use the same reviewed notice', async t => {
  const { root, text, manifest } = await fixture(t);
  await mkdir(path.join(root, 'frontend'));
  await writeFile(path.join(root, 'frontend/LICENSE'), text);
  await symlink('frontend', path.join(root, 'public'));
  manifest.notices[0].input = 'public/LICENSE';
  await writeFile(path.join(root, 'licenses/manifest.json'), JSON.stringify(manifest));
  let result = await prepareDistributionNotices({ root });
  assert.equal(await readFile(path.join(result.directory, 'dependency-LICENSE.txt'), 'utf8'), text);
  await rm(path.join(root, 'public'));
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public/LICENSE'), text);
  result = await prepareDistributionNotices({ root });
  assert.equal(await readFile(path.join(result.directory, 'dependency-LICENSE.txt'), 'utf8'), text);
});
