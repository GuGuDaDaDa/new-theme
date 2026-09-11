/** Hugo integration coverage for Cycle 03 list, card, tag, and pagination contracts. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { files, readJson, root } from '../../scripts/lib.mjs';
import { hash } from '../../scripts/prepare-content.mjs';

const fixture = await readJson(
  path.join(root, 'tests/fixtures/lists/site.json'),
);

/**
 * Create deterministic content for a requested pagination boundary.
 * @param {number} count - Number of public posts.
 * @param {number} [untaggedIndex=-1] - Post index that deliberately has no tags.
 * @returns {object} Boundary site definition.
 */
function listDefinition(count, untaggedIndex = -1) {
  const content = [
    { path: '_index.md', source: '---\ntitle: List Home\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: List Posts\n---\n' },
    {
      path: 'about/index.md',
      source: '---\ntitle: About\ntype: about\n---\nIndependent page.\n',
    },
  ];
  for (let index = 0; index < count; index += 1) {
    const minute = String(59 - index).padStart(2, '0');
    const tags = index === untaggedIndex ? [] : [fixture.sharedTag];
    if (tags.length && index < fixture.mixedTags.length) {
      tags.push(fixture.mixedTags[index]);
    }
    const tagBlock = tags.length
      ? ['tags:', ...tags.map((tag) => `  - "${tag}"`)]
      : [];
    const lastmod =
      index === count - 1 ? '\nlastmod: 2026-09-09T23:59:59+08:00' : '';
    const description = `${'不同长度的列表摘要。'.repeat((index % 4) + 1)} ${index}`;
    content.push({
      path: `posts/post-${String(index).padStart(2, '0')}/index.md`,
      source: [
        '---',
        `title: 文章 ${String(index).padStart(2, '0')}`,
        `date: 2026-09-09T${String(index % 24).padStart(2, '0')}:00:00+08:00`,
        `created: 2026-09-09T23:${minute}:00+08:00${lastmod}`,
        `description: "${description}"`,
        ...tagBlock,
        '---',
        `正文 ${index}。`,
        '',
      ].join('\n'),
    });
  }
  return { clock: fixture.clock, content };
}

test('a post without tags omits the tag region without affecting its card', async () => {
  const site = await buildBoundarySite({
    name: 'lists-no-tags',
    definition: listDefinition(1, 0),
  });
  try {
    const $ = await readPage(site.build.publicDir, 'index.html');
    assert.equal($('.post').length, 1);
    assert.equal($('.post-tags').length, 0);
    assert.equal($('.post h2').text().trim(), '文章 00');
  } finally {
    await removeBoundarySite(site.projectRoot);
  }
});

/**
 * Read a generated HTML document through Cheerio.
 * @param {string} publicDir - Build output.
 * @param {string} relative - Relative output file.
 * @returns {Promise<import('cheerio').CheerioAPI>} Parsed document.
 */
async function readPage(publicDir, relative) {
  return load(await readFile(path.join(publicDir, relative), 'utf8'));
}

for (const count of fixture.counts) {
  test(`home and posts render the ${count}-post pagination boundary`, async () => {
    const site = await buildBoundarySite({
      name: `lists-${count}`,
      definition: listDefinition(count),
    });
    try {
      for (const relative of ['index.html', 'posts/index.html']) {
        const $ = await readPage(site.build.publicDir, relative);
        assert.equal($('[data-post-list]').attr('data-page'), '1');
        assert.equal(
          $('[data-post-list]').attr('data-build-id').length > 0,
          true,
        );
        assert.equal($('.section-count').text().trim(), `${count} 篇`);
        assert.equal($('.masonry > .post').length, Math.min(count, 12));
        assert.equal($('.list-empty').text().trim(), count ? '' : '暂无文章');
        assert.equal($('[data-pagination]').length, count ? 1 : 0);
        assert.equal($('[data-next]').length, count > 12 ? 1 : 0);
      }

      if (count > 12) {
        for (const relative of [
          'page/2/index.html',
          'posts/page/2/index.html',
        ]) {
          const $ = await readPage(site.build.publicDir, relative);
          assert.equal($('[data-post-list]').attr('data-page'), '2');
          assert.equal($('.masonry > .post').length, Math.min(count - 12, 12));
          assert.equal($('[rel="prev"]').length, 1);
          assert.equal(
            $('link[rel="canonical"]').attr('href'),
            `http://localhost:4173/${relative.replace('index.html', '')}`,
          );
        }
      }

      if (count === 25) {
        for (const relative of [
          'page/3/index.html',
          'posts/page/3/index.html',
        ]) {
          const $ = await readPage(site.build.publicDir, relative);
          assert.equal($('.masonry > .post').length, 1);
          assert.equal($('[rel="prev"]').length, 1);
          assert.equal($('[data-next]').length, 0);
        }
      }
    } finally {
      await removeBoundarySite(site.projectRoot);
    }
  });
}

test('home, posts, and term retain rank order, shared cards, and isolated tag routes', async () => {
  const site = await buildBoundarySite({
    name: 'lists-tags',
    definition: listDefinition(25),
  });
  try {
    const expected = Array.from(
      { length: 25 },
      (_, index) => `/posts/post-${String(index).padStart(2, '0')}/`,
    );
    const actual = [];
    for (const relative of [
      'index.html',
      'page/2/index.html',
      'page/3/index.html',
    ]) {
      const $ = await readPage(site.build.publicDir, relative);
      actual.push(
        ...$('.masonry > .post')
          .map((_, element) => $(element).attr('data-post-url'))
          .get(),
      );
    }
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, 25);

    const lastPage = await readPage(site.build.publicDir, 'page/3/index.html');
    assert.equal(lastPage('.post').attr('data-post-url'), '/posts/post-24/');
    assert.equal(lastPage('.post .meta').text().includes('更新于'), true);

    const posts = await readPage(site.build.publicDir, 'posts/index.html');
    assert.deepEqual(
      posts('.masonry > .post')
        .map((_, element) => posts(element).attr('data-post-url'))
        .get(),
      expected.slice(0, 12),
    );
    assert.equal(posts('.post h2 > a[data-post-title]').length, 12);
    assert.equal(posts('.post .meta time').length, 12);
    assert.equal(
      posts('.post .meta span').last().text().includes('分钟'),
      true,
    );

    const sharedKey = `t-${hash(fixture.sharedTag)}`;
    const termRoot = path.join('tags', sharedKey);
    const term = await readPage(
      site.build.publicDir,
      path.join(termRoot, 'index.html'),
    );
    assert.equal(
      term('[data-list-id]').attr('data-list-id'),
      `tag:${sharedKey}`,
    );
    assert.equal(term('.section-title h1').text().trim(), fixture.sharedTag);
    assert.equal(term('.section-count').text().trim(), '25 篇');
    assert.deepEqual(
      term('.masonry > .post')
        .map((_, element) => term(element).attr('data-post-url'))
        .get(),
      expected.slice(0, 12),
    );
    const termActual = [];
    for (const relative of [
      path.join(termRoot, 'index.html'),
      path.join(termRoot, 'page/2/index.html'),
      path.join(termRoot, 'page/3/index.html'),
    ]) {
      const page = await readPage(site.build.publicDir, relative);
      termActual.push(
        ...page('.masonry > .post')
          .map((_, element) => page(element).attr('data-post-url'))
          .get(),
      );
    }
    assert.deepEqual(termActual, expected);
    const termPageTwo = await readPage(
      site.build.publicDir,
      path.join(termRoot, 'page/2/index.html'),
    );
    assert.equal(
      termPageTwo('link[rel="canonical"]').attr('href'),
      `http://localhost:4173/tags/${sharedKey}/page/2/`,
    );
    assert.equal(posts(`.post-tag[href="/tags/${sharedKey}/"]`).length, 12);

    const aiKey = `t-${hash('AI')}`;
    const aiLowerKey = `t-${hash('ai')}`;
    assert.notEqual(aiKey, aiLowerKey);
    assert.equal(
      (await readPage(site.build.publicDir, `tags/${aiKey}/index.html`))(
        '.section-count',
      )
        .text()
        .trim(),
      '1 篇',
    );
    assert.equal(
      (await readPage(site.build.publicDir, `tags/${aiLowerKey}/index.html`))(
        '.section-count',
      )
        .text()
        .trim(),
      '1 篇',
    );

    const output = await files(site.build.publicDir);
    assert.equal(
      output.some((file) => file.endsWith('/tags/index.html')),
      false,
    );
    assert.equal(
      output.some((file) => file.includes('/categories/')),
      false,
    );
  } finally {
    await removeBoundarySite(site.projectRoot);
  }
});
