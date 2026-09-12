/** Hugo integration coverage for Cycle 05 article detail contracts. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { readJson, root } from '../../scripts/lib.mjs';

const fixture = await readJson(
  path.join(root, 'tests/fixtures/article/site.json'),
);
let site;

/** Read one generated article document. @param {string} slug - Article slug. @returns {Promise<{html: string, $: import('cheerio').CheerioAPI}>} Source and parsed document. */
async function readArticle(slug) {
  const html = await readFile(
    path.join(site.build.publicDir, 'posts', slug, 'index.html'),
    'utf8',
  );
  return { html, $: load(html) };
}

test.before(async () => {
  site = await buildBoundarySite({
    name: 'article-contracts',
    definition: fixture,
  });
});

test.after(async () => {
  if (site) await removeBoundarySite(site.projectRoot);
});

test('article header follows the frozen order and uses real PostView fields', async () => {
  const { $ } = await readArticle('complete-frontmatter');
  const headingChildren = $('.article-heading')
    .children()
    .map((_, element) => {
      const node = $(element);
      return node.attr('class') || element.tagName;
    })
    .get();
  assert.deepEqual(headingChildren, [
    'back-link',
    'post-tags',
    'h1',
    'dek',
    'meta',
  ]);
  assert.equal($('[data-article-back]').attr('href'), '/posts/');
  assert.deepEqual(
    $('.article-heading .post-tag')
      .map((_, element) => $(element).text().trim())
      .get(),
    ['文章详情', '正文'],
  );
  assert.equal($('.article-heading h1').text().trim(), '完整文章头');
  assert.equal(
    $('.article-heading .dek').text().trim(),
    '手写的文章摘要优先于正文自动摘要。',
  );
  assert.equal($('[data-article-author]').text().trim(), 'GuGuDaDa');
  assert.equal($('[data-article-reading-time]').text().trim(), '1 分钟');
  assert.equal($('.article-heading time').length, 1);
  assert.equal($('[data-article-date]').text().trim(), '2026 / 09 / 09');
  assert.equal(
    $('main.article-layout > article.reading[data-article]').length,
    1,
  );
});

test('lastmod variants render exactly one visible date', async () => {
  for (const [slug, expected] of [
    ['lastmod-missing', '2026 / 09 / 08'],
    ['lastmod-equal', '2026 / 09 / 08'],
    ['lastmod-different', '更新于 2026 / 09 / 09'],
  ]) {
    const { $ } = await readArticle(slug);
    assert.equal($('.article-heading time').length, 1, slug);
    assert.equal(
      $('[data-article-date]').text().replace(/\s+/g, ' ').trim(),
      expected.replace(/\s+/g, ' ').trim(),
      slug,
    );
    assert.equal(
      $('.article-heading .meta').text().includes('2026 / 09 / 08') &&
        $('.article-heading .meta').text().includes('2026 / 09 / 09'),
      false,
      slug,
    );
  }
});

test('optional header regions and summary sources have no empty placeholders', async () => {
  const empty = await readArticle('empty-body');
  assert.equal(empty.$('.post-tags').length, 0);
  assert.equal(empty.$('.dek').length, 0);
  assert.equal(empty.$('.opening-image').length, 0);
  assert.equal(empty.$('[data-article-body]').length, 0);
  assert.equal(empty.$('[data-article-reading-time]').length, 0);

  const imageOnly = await readArticle('image-only');
  assert.equal(imageOnly.$('.dek').length, 0);
  assert.equal(
    imageOnly.$('[data-article-body] figure.wide > a.image-open > img').length,
    1,
  );
  assert.equal(
    imageOnly.$('[data-article-body] a[data-lightbox]').attr('href'),
    'https://images.example.test/article-body-only.jpg',
  );
  assert.equal(
    imageOnly.$('[data-article-body] img').attr('alt'),
    '正文中的一张远程照片',
  );
  assert.equal(imageOnly.$('[data-article-body] img').attr('loading'), 'lazy');

  const description = await readArticle('description-summary');
  assert.equal(
    description.$('.dek').text().trim(),
    '这是只来自 description 的纯文本摘要。',
  );
  const more = await readArticle('more-summary');
  assert.match(more.$('.dek').text(), /more 分隔符之前/);
  assert.doesNotMatch(more.$('.dek').text(), /分隔符之后/);
  const codeFirst = await readArticle('code-first');
  assert.doesNotMatch(codeFirst.$('.dek').text(), /firstBlock|console/);
});

test('cover follows the heading and preserves content without list cropping', async () => {
  const { html, $ } = await readArticle('complete-frontmatter');
  assert.equal($('.article-heading + .opening-image').length, 1);
  assert.equal($('.opening-image + [data-article-body]').length, 1);
  const cover = $('[data-article-cover]');
  assert.equal(
    cover.attr('src'),
    'https://images.example.test/article-horizontal.jpg',
  );
  assert.equal(cover.attr('alt'), '横向山谷标题图');
  assert.equal(cover.attr('loading'), 'eager');
  assert.equal(cover.attr('fetchpriority'), 'high');
  assert.equal(cover.attr('style'), undefined);
  assert.equal($('.opening-image figcaption').length, 0);
  assert.equal($('.opening-image button').length, 0);
  assert.equal($('.opening-image a.image-open[data-lightbox]').length, 1);
  assert.equal(
    $('.opening-image a.image-open').attr('href'),
    'https://images.example.test/article-horizontal.jpg',
  );
  assert.equal(html.includes('17% 83%'), false);

  const withoutCover = await readArticle('default-frontmatter');
  assert.equal(withoutCover.$('.opening-image').length, 0);
});

test('basic Markdown keeps semantic headings, nested lists, and one body render', async () => {
  const { $ } = await readArticle('headings-and-lists');
  for (let level = 1; level <= 6; level += 1)
    assert.equal($(`[data-article-body] h${level}`).length, 1);
  assert.equal($('[data-article-body] h2[data-article-heading]').length, 1);
  assert.equal($('[data-article-body] h3[data-article-heading]').length, 1);
  assert.equal($('[data-article-body] h1[data-article-heading]').length, 0);
  const ids = $('[data-article-body] :header[id]')
    .map((_, element) => $(element).attr('id'))
    .get();
  assert.equal(new Set(ids).size, ids.length);
  assert.equal($('[data-article-body] ul ul ul').length, 1);
  assert.equal($('[data-article-body] ol ol ol').length, 1);
  assert.equal(
    (
      $('[data-article-body]')
        .text()
        .match(/每一级标题都保留语义层级和稳定锚点。/g) || []
    ).length,
    1,
  );
});

test('wide content and native footnotes retain local scrolling semantics', async () => {
  const { $ } = await readArticle('wide-content');
  assert.equal($('[data-article-body] blockquote').length, 1);
  assert.equal($('[data-article-body] pre > code').length, 1);
  assert.equal($('[data-article-body] table').length, 1);
  assert.equal($('[data-article-body] table').attr('tabindex'), '0');
  assert.equal($('[data-article-body] .footnotes').length, 1);
  const reference = $('[data-article-body] .footnote-ref').first();
  assert.match(reference.attr('href'), /^#fn:/);
  const note = $('[data-article-body] .footnotes li').first();
  assert.ok(note.attr('id'));
  assert.equal(note.find('.footnote-backref').length, 1);
});

test('article images only emit bundle, site, or HTTPS sources', async () => {
  const { html, $ } = await readArticle('unsafe-image');
  assert.equal($('[data-article-body] img').length, 1);
  assert.equal(
    $('[data-article-body] img').attr('src'),
    'https://images.example.test/safe-body-image.jpg',
  );
  assert.equal(
    $('.article-image-fallback').text().trim(),
    '非允许 scheme 图片',
  );
  assert.equal(html.includes('http://images.example.test'), false);
});

test('cached article body evaluates once and stays isolated by page', async () => {
  const definition = {
    clock: fixture.clock,
    content: [
      { path: '_index.md', source: '---\ntitle: Cache Home\n---\n' },
      { path: 'posts/_index.md', source: '---\ntitle: Cache Posts\n---\n' },
      {
        path: 'posts/cache-one/index.md',
        source:
          '---\ntitle: Cache One\ndate: 2026-09-09T12:00:00+08:00\n---\n{{< body-eval >}} one\n',
      },
      {
        path: 'posts/cache-two/index.md',
        source:
          '---\ntitle: Cache Two\ndate: 2026-09-09T11:00:00+08:00\n---\n{{< body-eval >}} two\n',
      },
    ],
    templates: [
      {
        path: 'layouts/_shortcodes/body-eval.html',
        source:
          '{{- $count := .Page.Store.Get "article-body-evals" | default 0 -}}{{- $count = add $count 1 -}}{{- .Page.Store.Set "article-body-evals" $count -}}<span data-body-eval>{{ $count }}</span>',
      },
      {
        path: 'layouts/posts/page.html',
        source:
          '{{ define "main" }}{{ $context := dict "page" . }}{{ $first := partialCached "article/body.html" $context .File.Path .RelPermalink hugo.Data.night_build.buildId }}{{ $second := partialCached "article/body.html" $context .File.Path .RelPermalink hugo.Data.night_build.buildId }}<article data-first>{{ $first }}</article><article data-second>{{ $second }}</article>{{ end }}',
      },
    ],
  };
  const cachedSite = await buildBoundarySite({
    name: 'article-body-cache',
    definition,
  });
  try {
    for (const [slug, marker] of [
      ['cache-one', 'one'],
      ['cache-two', 'two'],
    ]) {
      const html = await readFile(
        path.join(cachedSite.build.publicDir, 'posts', slug, 'index.html'),
        'utf8',
      );
      const $ = load(html);
      assert.deepEqual(
        $('[data-body-eval]')
          .map((_, element) => $(element).text().trim())
          .get(),
        ['1', '1'],
      );
      assert.match($('[data-first]').text(), new RegExp(marker));
      assert.match($('[data-second]').text(), new RegExp(marker));
    }
  } finally {
    await removeBoundarySite(cachedSite.projectRoot);
  }
});

test('article footer carries the byline, one display date, and the copyright notice', async () => {
  const { $ } = await readArticle('complete-frontmatter');
  const article = $('main.article-layout > article.reading[data-article]');
  assert.deepEqual(
    article
      .children()
      .map((_, element) => $(element).attr('class'))
      .get(),
    [
      'article-heading',
      'wide opening-image',
      'prose',
      'article-footer',
      'article-nav',
    ],
  );
  const footer = $('.article-footer');
  assert.equal(footer.find('.author-row a').attr('href'), '/about/');
  assert.equal(footer.find('.author-row a').text().trim(), '文/GuGuDaDa');
  assert.equal(
    footer.find('.copyright-row').text().trim(),
    '商业转载请联系站长获得授权；非商业转载请注明来源及链接。',
  );
  const headerTime = $('.article-heading time');
  const footerTime = footer.find('time');
  assert.equal(footerTime.length, 1);
  assert.equal(footerTime.attr('datetime'), headerTime.attr('datetime'));
  assert.equal(
    footerTime.text().replace(/\s+/g, ' ').trim(),
    headerTime.text().replace(/\s+/g, ' ').trim(),
  );

  for (const slug of ['lastmod-equal', 'lastmod-different']) {
    const variant = await readArticle(slug);
    assert.equal(
      variant.$('.article-footer time').text().replace(/\s+/g, ' ').trim(),
      variant.$('.article-heading time').text().replace(/\s+/g, ' ').trim(),
      slug,
    );
  }
});

test('article navigation follows rank adjacency with boundary placeholders', async () => {
  const newest = await readArticle('complete-frontmatter');
  assert.equal(newest.$('.article-nav').attr('aria-label'), '文章导航');
  assert.equal(
    newest.$('.article-nav .prev a').attr('href'),
    '/posts/default-frontmatter/',
  );
  assert.equal(
    newest.$('.article-nav .prev .article-nav-label').text().trim(),
    '← 上一篇',
  );
  assert.equal(newest.$('.article-nav .next a').length, 0);
  assert.equal(
    newest
      .$('.article-nav .next .article-nav-empty .article-nav-title')
      .text()
      .trim(),
    '已经是最后一篇了',
  );

  const oldest = await readArticle('unsafe-image');
  assert.equal(oldest.$('.article-nav .prev a').length, 0);
  assert.equal(
    oldest
      .$('.article-nav .prev .article-nav-empty .article-nav-title')
      .text()
      .trim(),
    '已经是第一篇了',
  );
  assert.equal(oldest.$('.article-nav .prev .article-nav-empty a').length, 0);
  assert.equal(
    oldest.$('.article-nav .next a').attr('href'),
    '/posts/long-header/',
  );
  assert.equal(
    oldest.$('.article-nav .next .article-nav-label').text().trim(),
    '下一篇 →',
  );

  const middle = await readArticle('lastmod-equal');
  assert.equal(
    middle.$('.article-nav .prev a').attr('href'),
    '/posts/lastmod-different/',
  );
  assert.equal(
    middle.$('.article-nav .next a').attr('href'),
    '/posts/lastmod-missing/',
  );

  for (const page of ['index.html', 'posts/index.html']) {
    const $ = load(
      await readFile(path.join(site.build.publicDir, page), 'utf8'),
    );
    assert.equal($('.article-footer').length, 0, page);
    assert.equal($('.article-nav').length, 0, page);
  }
});

test('a lone public article keeps the footer and omits the navigation', async () => {
  const definition = {
    clock: fixture.clock,
    content: [
      { path: '_index.md', source: '---\ntitle: Solo Home\n---\n' },
      { path: 'posts/_index.md', source: '---\ntitle: Solo Posts\n---\n' },
      {
        path: 'posts/solo/index.md',
        source:
          '---\ntitle: 独一篇\ndate: 2026-09-09T12:00:00+08:00\n---\n\n只有一篇文章。\n',
      },
    ],
  };
  const soloSite = await buildBoundarySite({
    name: 'article-solo-footer',
    definition,
  });
  try {
    const $ = load(
      await readFile(
        path.join(soloSite.build.publicDir, 'posts', 'solo', 'index.html'),
        'utf8',
      ),
    );
    assert.equal($('.article-footer').length, 1);
    assert.equal($('.article-nav').length, 0);
  } finally {
    await removeBoundarySite(soloSite.projectRoot);
  }
});
