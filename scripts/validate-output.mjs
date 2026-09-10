/** Structural smoke validation of a completed static build. */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { files, readJson } from './lib.mjs';

/** Validate emitted pages, JSON, and local resource targets. @param {string} destination - Output root. @returns {Promise<void>} Completion or error. */
export async function validateOutput(destination) {
  for (const file of [
    'index.html',
    'posts/index.html',
    '404.html',
    'index.json',
    'sitemap.xml',
  ])
    await access(path.join(destination, file));
  const index = await readJson(path.join(destination, 'index.json'));
  assert.equal(index.schemaVersion, 1);
  assert.ok(Array.isArray(index.posts));
  const output = await files(destination);
  assert.ok(
    !output.includes(path.join(destination, 'prepare.json')),
    'Internal prepare JSON must not be published',
  );
  assert.ok(
    !output.includes(path.join(destination, 'tags/index.html')),
    'Tag overview must not be emitted',
  );
  for (const post of index.posts)
    await access(path.join(destination, decodeURI(post.url), 'index.html'));
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
  console.log(
    `Validated ${output.length} output files and ${index.posts.length} indexed posts.`,
  );
}
