/** Exercise the real two-pass Hugo build and emitted asset contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildSite } from '../../scripts/build.mjs';
import { root, files, readJson } from '../../scripts/lib.mjs';
import {
  createBoundarySite,
  removeBoundarySite,
  snapshotTree,
} from '../helpers/site.mjs';

test('real Hugo build publishes public HTML, assets and a clean search index', async () => {
  const authorContent = await snapshotTree(path.join(root, 'content'));
  const authorPublic = await snapshotTree(path.join(root, 'public'));
  const fixture = await createBoundarySite({ name: 'build' });
  try {
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const output = await files(result.publicDir);
    const index = await readJson(path.join(result.publicDir, 'index.json'));
    assert.ok(index.posts.length > 0);
    assert.ok(index.posts.every((post, rank) => post.rank === rank));
    assert.ok(index.posts.every((post) => !/<[^>]+>/.test(post.content)));
    assert.ok(output.some((file) => file.endsWith('.css')));
    assert.ok(output.some((file) => file.endsWith('.js')));
    assert.ok(output.some((file) => file.includes('/tags/t-')));

    // T07 asset bundling contracts
    const manifest = await readJson(
      path.join(result.projectRoot, '.generated/data/night_assets.json'),
    );
    assert.ok(manifest.main && manifest.main.startsWith('js/main-'));
    assert.ok(output.some((file) => file.endsWith(manifest.main)));

    const chunkFile = output.find((file) =>
      file.includes('/js/chunks/dynamic-sample-'),
    );
    assert.ok(chunkFile, 'Dynamic chunk must be emitted in public/js/chunks/');
    const mainJsContent = await readFile(
      path.join(result.publicDir, manifest.main),
      'utf8',
    );
    assert.ok(
      mainJsContent.includes('./chunks/dynamic-sample-'),
      'Main entry must use relative path for dynamic chunks without renaming',
    );

    // Mounts contract: no duplicate mounts, only .generated/content mounted
    const finalConfig = await readJson(result.finalConfig);
    const mounts = finalConfig.module.mounts;
    const targets = mounts.map((m) => `${m.source}->${m.target}`);
    assert.equal(new Set(targets).size, targets.length, 'No duplicate mounts');
    assert.equal(
      mounts.some((m) => m.source === 'content'),
      false,
      'Raw author content directory must not be mounted directly',
    );
    assert.ok(
      mounts.some(
        (m) => m.source === '.generated/content' && m.target === 'content',
      ),
    );

    const html = await readFile(
      path.join(result.publicDir, 'index.html'),
      'utf8',
    );
    assert.match(
      html,
      new RegExp(`<script type="?module"? src="?/${manifest.main}"?>`),
    );
    assert.match(
      html,
      /<link rel="?stylesheet"? href="?\/css\/compiled\.[a-f0-9]+\.css"? integrity="?sha256-[^" >]+"? crossorigin="?anonymous"?>/,
    );
    assert.match(html, /最新文章/);
    assert.doesNotMatch(html, /googletagmanager|gtag\(/);
    assert.equal(result.metadata.buildTime, fixture.clock.toISOString());
    assert.equal(result.projectRoot, fixture.projectRoot);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
  assert.deepEqual(
    await snapshotTree(path.join(root, 'content')),
    authorContent,
  );
  assert.deepEqual(await snapshotTree(path.join(root, 'public')), authorPublic);
});
