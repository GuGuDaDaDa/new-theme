/** Hugo integration coverage for Cycle 04 featured-post output contracts. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { readJson, root } from '../../scripts/lib.mjs';

const fixture = await readJson(
  path.join(root, 'tests/fixtures/hero/site.json'),
);

/**
 * Create featured posts plus one ordinary list post.
 * @param {number} count - Number of public featured posts.
 * @param {number} [ordinaryCount=1] - Number of additional public posts.
 * @returns {object} Isolated site definition.
 */
function heroDefinition(count, ordinaryCount = 1) {
  const content = [
    { path: '_index.md', source: '---\ntitle: Hero Home\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: Hero Posts\n---\n' },
  ];
  for (const [index, candidate] of fixture.candidates.entries()) {
    if (index >= count) break;
    const cover =
      index < 2
        ? `\ncover: https://images.example.test/${candidate.slug}.jpg`
        : '';
    const title =
      index === 0 && count === 4
        ? '安全标题 </script><script>globalThis.leaked=true</script>'
        : candidate.title;
    content.push({
      path: `posts/${candidate.slug}/index.md`,
      source: [
        '---',
        `title: ${JSON.stringify(title)}`,
        `date: ${candidate.date}`,
        `created: ${candidate.created}`,
        `description: ${JSON.stringify(candidate.summary)}`,
        'featured: true',
        `featured_weight: ${100 - index}`,
        `tags: [${JSON.stringify(fixture.sharedTag)}]${cover}`,
        '---',
        `推荐正文 ${index + 1}。`,
        '',
      ].join('\n'),
    });
  }
  for (let index = 0; index < ordinaryCount; index += 1) {
    content.push({
      path: `posts/ordinary-${String(index).padStart(2, '0')}/index.md`,
      source: [
        '---',
        `title: 普通文章 ${index}`,
        `date: 2026-09-08T${String(23 - (index % 20)).padStart(2, '0')}:00:00+08:00`,
        `created: 2026-09-08T${String(23 - (index % 20)).padStart(2, '0')}:00:00+08:00`,
        `tags: [${JSON.stringify(fixture.sharedTag)}]`,
        '---',
        `普通正文 ${index}。`,
        '',
      ].join('\n'),
    });
  }
  content.push(
    {
      path: 'posts/hidden-draft/index.md',
      source:
        '---\ntitle: Hidden Draft\ndate: 2026-09-09T11:00:00Z\nfeatured: true\ndraft: true\n---\nhidden\n',
    },
    {
      path: 'posts/hidden-future/index.md',
      source:
        '---\ntitle: Hidden Future\ndate: 2026-09-11T11:00:00Z\nfeatured: true\n---\nhidden\n',
    },
    {
      path: 'posts/hidden-expired/index.md',
      source:
        '---\ntitle: Hidden Expired\ndate: 2026-09-07T11:00:00Z\nexpiryDate: 2026-09-09T11:00:00Z\nfeatured: true\n---\nhidden\n',
    },
  );
  return { clock: fixture.clock, content };
}

/**
 * Read a generated HTML document.
 * @param {string} publicDir - Build output directory.
 * @param {string} relative - Relative HTML path.
 * @returns {Promise<{html: string, $: import('cheerio').CheerioAPI}>} Source and parsed document.
 */
async function readPage(publicDir, relative) {
  const html = await readFile(path.join(publicDir, relative), 'utf8');
  return { html, $: load(html) };
}

for (const count of fixture.counts) {
  test(`home renders the ${count}-featured boundary without changing its list`, async () => {
    const site = await buildBoundarySite({
      name: `hero-${count}`,
      definition: heroDefinition(count),
    });
    try {
      const { html, $ } = await readPage(site.build.publicDir, 'index.html');
      const visible = Math.min(count, 3);
      assert.equal($('[data-hero]').length, count ? 1 : 0);
      assert.equal($('.header').hasClass('header-overlay'), Boolean(count));
      assert.equal($('.section-title > h2').length, count ? 1 : 0);
      assert.equal($('.section-title > h1').length, count ? 0 : 1);
      assert.equal($('[data-hero-choice]').length, visible > 1 ? visible : 0);
      assert.equal($('.masonry > .post').length, count + 1);
      assert.equal(
        $('.masonry > .post')
          .map((_, element) => $(element).attr('data-post-url'))
          .get()
          .filter((url) => url.includes('/hero-')).length,
        count,
      );

      if (count) {
        const data = JSON.parse($('[data-hero-data]').text());
        assert.equal(data.length, visible);
        assert.deepEqual(
          data.map((item) => item.url),
          fixture.candidates
            .slice(0, visible)
            .map((item) => `/posts/${item.slug}/`),
        );
        assert.equal($('[data-hero-link]').attr('href'), data[0].url);
        assert.equal($('[data-hero-read]').attr('href'), data[0].url);
        assert.equal(
          $('[data-hero-description]').text().trim(),
          data[0].heroExcerpt,
        );
        assert.equal(
          $('[data-hero-date]').attr('datetime'),
          data[0].displayDateISO,
        );
        assert.equal(
          $('[data-hero-time]').text().trim().endsWith('分钟'),
          true,
        );
        assert.equal($('.hero-cover').attr('loading'), 'eager');
        assert.equal($('.hero-cover').attr('fetchpriority'), 'high');
        assert.equal($('[data-hero-thumb][fetchpriority]').length, 0);
        if (visible >= 3) assert.equal(data[2].cover.url, '');
        const fallback = load($('noscript').text());
        assert.equal(
          fallback('.hero-fallback a').length,
          Math.max(visible - 1, 0),
        );
      }

      for (const hidden of [
        'Hidden Draft',
        'Hidden Future',
        'Hidden Expired',
      ]) {
        assert.equal(html.includes(hidden), false);
      }
      if (count === 4) {
        assert.equal(
          html.includes('<script>globalThis.leaked=true</script>'),
          false,
        );
        assert.equal(
          JSON.parse($('[data-hero-data]').text())[0].title.includes(
            '</script>',
          ),
          true,
        );
      }
    } finally {
      await removeBoundarySite(site.projectRoot);
    }
  });
}

test('hero is limited to home page one and keeps rank order across pagination', async () => {
  const site = await buildBoundarySite({
    name: 'hero-scope',
    definition: heroDefinition(4, 13),
  });
  try {
    const home = await readPage(site.build.publicDir, 'index.html');
    assert.equal(home.$('[data-hero]').length, 1);
    assert.equal(
      home.$('[data-hero-data]').text().includes('featured_weight'),
      false,
    );
    for (const relative of [
      'page/2/index.html',
      'posts/index.html',
      `tags/${home.$('.post-tag').first().attr('href').split('/')[2]}/index.html`,
    ]) {
      const page = await readPage(site.build.publicDir, relative);
      assert.equal(page.$('[data-hero]').length, 0, relative);
      assert.equal(page.$('.header').hasClass('header-overlay'), false);
    }
  } finally {
    await removeBoundarySite(site.projectRoot);
  }
});
