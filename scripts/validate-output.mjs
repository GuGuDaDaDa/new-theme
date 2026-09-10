/** Structural smoke validation of a completed static build. */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { files, readJson, root } from './lib.mjs';

/**
 * Validate emitted pages, JSON, local resource targets, sitemap, and privacy constraints.
 * @param {string} destination - Output root.
 * @param {{forbiddenMarkers?: string[]}} options - Optional privacy verification context.
 * @returns {Promise<{fileCount: number, postCount: number}>} Validation summary.
 */
export async function validateOutput(destination, options = {}) {
  for (const file of [
    'index.html',
    'posts/index.html',
    '404.html',
    'index.json',
    'sitemap.xml',
  ]) {
    await access(path.join(destination, file));
  }

  const index = await readJson(path.join(destination, 'index.json'));
  assert.equal(index.schemaVersion, 1, 'Search index schemaVersion must be 1');
  assert.ok(
    typeof index.buildId === 'string' && index.buildId.length > 0,
    'Search index must have non-empty buildId',
  );
  assert.ok(Array.isArray(index.posts), 'Search index posts must be an array');

  const output = await files(destination);

  // 1. Forbidden files and endpoints
  assert.ok(
    !output.some(
      (file) => file.includes('prepare.json') || file.includes('/prepare/'),
    ),
    'Internal prepare artifacts must not be published',
  );
  assert.ok(
    !output.some(
      (file) =>
        file.endsWith('/tags/index.html') || file.includes('/categories/'),
    ),
    'Tag overview and categories must not be emitted',
  );

  // 2. Posts validation
  index.posts.forEach((post, expectedRank) => {
    assert.equal(
      post.rank,
      expectedRank,
      `Post ${post.url} rank ${post.rank} does not match expected rank ${expectedRank}`,
    );
    assert.ok(typeof post.url === 'string' && post.url.startsWith('/'));
    assert.ok(typeof post.title === 'string' && post.title.trim().length > 0);
    assert.ok(
      ['published', 'updated'].includes(post.displayDateKind),
      `Invalid displayDateKind: ${post.displayDateKind}`,
    );
    assert.ok(
      typeof post.displayDate === 'string' && post.displayDate.length > 0,
    );
  });

  for (const post of index.posts) {
    await access(path.join(destination, decodeURI(post.url), 'index.html'));
  }

  // 3. Sitemap cross-check
  const sitemapRaw = await readFile(
    path.join(destination, 'sitemap.xml'),
    'utf8',
  );
  const $sitemap = load(sitemapRaw, { xmlMode: true });
  const locs = $sitemap('loc')
    .map((_, el) => $sitemap(el).text().trim())
    .get();

  assert.ok(
    !locs.some(
      (loc) =>
        loc.includes('404.html') ||
        loc.includes('index.json') ||
        loc.includes('prepare.json') ||
        loc.endsWith('/tags/') ||
        loc.endsWith('/tags'),
    ),
    'Sitemap must not contain 404, JSON, prepare or tag overview URLs',
  );

  for (const post of index.posts) {
    assert.ok(
      locs.some((loc) => loc.endsWith(post.url)),
      `Sitemap must contain entry for indexed post: ${post.url}`,
    );
  }

  // 4. Resource targets check
  for (const file of output.filter((file) => file.endsWith('.html'))) {
    const $ = load(await readFile(file, 'utf8'));
    for (const element of $(
      'script[src], link[rel="stylesheet"], img[src]',
    ).toArray()) {
      const url = $(element).attr('src') ?? $(element).attr('href');
      if (!url || /^(https?:|data:|\/\/)/.test(url)) continue;
      const target = path.resolve(
        url.startsWith('/') ? destination : path.dirname(file),
        `.${url.startsWith('/') ? url : `/${url}`}`,
      );
      await access(target);
    }
  }

  // 5. Forbidden markers scan (privacy leakage prevention)
  if (
    Array.isArray(options.forbiddenMarkers) &&
    options.forbiddenMarkers.length > 0
  ) {
    for (const file of output) {
      const content = await readFile(file, 'utf8');
      for (const marker of options.forbiddenMarkers) {
        if (content.includes(marker)) {
          throw new Error(
            `Privacy violation: forbidden marker "${marker}" detected in emitted file ${file}`,
          );
        }
      }
    }
  }

  console.log(
    `Validated ${output.length} output files and ${index.posts.length} indexed posts.`,
  );
  return { fileCount: output.length, postCount: index.posts.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const target = process.argv[2] ?? path.join(root, 'public');
  await validateOutput(target);
}
