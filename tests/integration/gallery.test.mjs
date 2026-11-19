/** Hugo integration coverage for the gallery shortcode, single/empty boundaries, and search isolation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildSite } from '../../scripts/build.mjs';
import { readJson, root } from '../../scripts/lib.mjs';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';

const clock = '2026-09-10T00:00:00Z';

test('gallery shortcode renders multi-image, single-image, empty, and coexisting photo wall structures while isolating controls from search and summaries', async () => {
  const fixture = await createBoundarySite({
    name: 'gallery-shortcode',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/gallery-post/index.md',
          source: [
            '---',
            'title: 画廊测试文章',
            'date: 2026-09-09T00:00:00Z',
            'featured: true',
            '---',
            '',
            '第一组多图画廊开始。',
            '',
            '{{< gallery >}}',
            '  {{< photo src="bryce-canyon.jpg" alt="峡谷清晨" caption="第一张峡谷图注" >}}',
            '  {{< photo src="https://images.example.test/second.jpg" caption="回退替代文本图注" >}}',
            '  {{< photo src="https://images.example.test/third.jpg" alt="第三张无图注" >}}',
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            '  {{< photo src="https://images.example.test/solo.jpg" alt="单张画廊图片" caption="单图画廊图注" >}}',
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            '  {{< photo src="https://images.example.test/g2-1.jpg" alt="第二组图一" >}}',
            '  {{< photo src="https://images.example.test/g2-2.jpg" alt="第二组图二" >}}',
            '{{< /gallery >}}',
            '',
            '{{< photos >}}',
            '  {{< photo src="bryce-canyon.jpg" alt="图片墙一" caption="图片墙保留回归图注" >}}',
            '  {{< photo src="https://images.example.test/wall-2.jpg" alt="图片墙二" >}}',
            '{{< /photos >}}',
            '',
          ].join('\n'),
        },
      ],
    },
  });

  await cp(
    path.join(root, 'exampleSite/content/posts/post-3/bryce-canyon.jpg'),
    path.join(
      fixture.projectRoot,
      'content/posts/gallery-post/bryce-canyon.jpg',
    ),
  );

  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const html = await readFile(
      path.join(res.publicDir, 'posts/gallery-post/index.html'),
      'utf8',
    );
    const $ = load(html);

    // 1. Multi-image galleries (2 instances) + 1 single-image gallery; 0-image gallery is omitted
    const allGalleries = $('.wide.gallery-wide > .gallery');
    assert.equal(allGalleries.length, 3);
    const enhancedGalleries = $('[data-gallery]');
    assert.equal(enhancedGalleries.length, 2);

    // Unique IDs across multiple galleries on the same page
    const galleryIds = allGalleries.map((_, el) => $(el).attr('id')).get();
    assert.equal(new Set(galleryIds).size, 3);
    for (const id of galleryIds) {
      assert.match(id, /^night-gallery-/);
    }

    // 2. First multi-image gallery structure & attributes
    const firstGallery = enhancedGalleries.first();
    assert.equal(firstGallery.attr('role'), 'region');
    assert.equal(firstGallery.attr('aria-label'), '画廊');
    const progress = firstGallery.find('[data-gallery-progress]');
    assert.equal(progress.length, 1);
    assert.equal(progress.attr('data-search-exclude'), '');
    assert.equal(progress.attr('aria-hidden'), 'true');
    assert.ok(progress.is('[hidden]'));

    const prevBtn = firstGallery.find('[data-gallery-prev]');
    const nextBtn = firstGallery.find('[data-gallery-next]');
    assert.equal(prevBtn.attr('aria-label'), '上一张图片');
    assert.equal(nextBtn.attr('aria-label'), '下一张图片');
    assert.equal(prevBtn.attr('data-search-exclude'), '');
    assert.equal(nextBtn.attr('data-search-exclude'), '');
    assert.ok(prevBtn.is('[hidden]'));
    assert.ok(nextBtn.is('[hidden]'));

    const status = firstGallery.find('[data-gallery-status]');
    assert.equal(status.attr('role'), 'status');
    assert.equal(status.attr('data-search-exclude'), '');
    assert.ok(status.is('[hidden]'));

    const cards = firstGallery.find('[data-gallery-card]');
    assert.equal(cards.length, 3);

    // Card 1: Local bundle raster image -> WebP variant + srcset + originalURL + dimensions
    const card1Link = cards.eq(0).find('a[data-lightbox]');
    const card1Img = card1Link.find('img');
    assert.match(card1Link.attr('href'), /bryce-canyon\.jpg$/);
    assert.match(
      card1Link.attr('data-lightbox-src'),
      /^\/posts\/gallery-post\/bryce-canyon_.*\.webp$/,
    );
    assert.equal(card1Img.attr('src'), card1Link.attr('data-lightbox-src'));
    assert.equal(card1Img.attr('width'), '300');
    assert.equal(card1Img.attr('height'), '200');
    assert.match(card1Img.attr('srcset') ?? '', /\.webp 300w$/);
    assert.equal(card1Img.attr('alt'), '峡谷清晨');
    assert.equal(card1Link.attr('data-caption'), '第一张峡谷图注');
    assert.equal(
      cards.eq(0).find('.gallery-caption').text().trim(),
      '第一张峡谷图注',
    );

    // Card 2: Remote HTTPS image + alt fallback to caption
    const card2Link = cards.eq(1).find('a[data-lightbox]');
    const card2Img = card2Link.find('img');
    assert.equal(
      card2Link.attr('href'),
      'https://images.example.test/second.jpg',
    );
    assert.equal(
      card2Link.attr('data-lightbox-src'),
      'https://images.example.test/second.jpg',
    );
    assert.equal(card2Img.attr('alt'), '回退替代文本图注');
    assert.equal(card2Link.attr('data-caption'), '回退替代文本图注');

    // Card 3: No caption -> no figcaption element
    assert.equal(cards.eq(2).find('.gallery-caption').length, 0);

    // 3. Single-image gallery degrades cleanly without multi-image controls or data-gallery
    const singleGallery = $('.gallery.gallery-single');
    assert.equal(singleGallery.length, 1);
    assert.equal(singleGallery.attr('data-gallery'), undefined);
    assert.equal(singleGallery.find('[data-gallery-progress]').length, 0);
    assert.equal(singleGallery.find('[data-gallery-prev]').length, 0);
    assert.equal(singleGallery.find('[data-gallery-next]').length, 0);
    assert.equal(singleGallery.find('a[data-lightbox]').length, 1);

    // 4. Existing photo wall works alongside gallery with zero regression
    const photoWall = $('[data-photo-stack]');
    assert.equal(photoWall.length, 1);
    assert.equal(photoWall.find('.stack-card').length, 2);

    // 5. Search index and summaries exclude control noise while preserving author captions
    const indexJson = await readJson(path.join(res.publicDir, 'index.json'));
    const entry = indexJson.posts.find(
      (post) => post.url === '/posts/gallery-post/',
    );
    assert.ok(entry);
    assert.match(entry.content, /第一组多图画廊开始/);
    assert.match(entry.content, /第一张峡谷图注/);
    assert.match(entry.content, /回退替代文本图注/);
    assert.match(entry.content, /单图画廊图注/);
    assert.match(entry.content, /图片墙保留回归图注/);
    assert.doesNotMatch(
      entry.content,
      /上一张图片|下一张图片|上一张照片|下一张照片|点击桌面翻页/,
    );

    // Check inline i18n payload includes gallery keys
    const i18nPayload = JSON.parse($('script[data-i18n]').text());
    assert.equal(i18nPayload['shortcode.prevGallery'], '上一张图片');
    assert.equal(i18nPayload['shortcode.nextGallery'], '下一张图片');
    assert.equal(
      i18nPayload['shortcode.galleryCounter'],
      '第 {Current} 张，共 {Total} 张图片',
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('gallery and photo shortcodes reject missing or unsupported src and unexpected gallery parameters', async () => {
  const fixture = await createBoundarySite({
    name: 'gallery-errors',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/bad-gallery/index.md',
          source: [
            '---',
            'title: Bad Gallery',
            'date: 2026-09-09T00:00:00Z',
            '---',
            '{{< gallery >}}',
            '  {{< photo alt="missing src" >}}',
            '{{< /gallery >}}',
            '',
          ].join('\n'),
        },
      ],
    },
  });
  const postPath = path.join(
    fixture.projectRoot,
    'content/posts/bad-gallery/index.md',
  );

  try {
    // 1. Missing src
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /photo src is required/,
    );

    // 2. Non-HTTPS or missing local bundle resource
    await writeFile(
      postPath,
      [
        '---',
        'title: Bad Gallery',
        'date: 2026-09-09T00:00:00Z',
        '---',
        '{{< gallery >}}',
        '  {{< photo src="http://insecure.example.test/a.jpg" >}}',
        '{{< /gallery >}}',
        '',
      ].join('\n'),
    );
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /must reference a page image resource or an HTTPS URL/,
    );

    // 3. Non-existent local resource
    await writeFile(
      postPath,
      [
        '---',
        'title: Bad Gallery',
        'date: 2026-09-09T00:00:00Z',
        '---',
        '{{< gallery >}}',
        '  {{< photo src="nonexistent.jpg" >}}',
        '{{< /gallery >}}',
        '',
      ].join('\n'),
    );
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /must reference a page image resource or an HTTPS URL/,
    );

    // 4. Gallery with parameters
    await writeFile(
      postPath,
      [
        '---',
        'title: Bad Gallery',
        'date: 2026-09-09T00:00:00Z',
        '---',
        '{{< gallery columns="3" >}}',
        '  {{< photo src="https://images.example.test/ok.jpg" >}}',
        '{{< /gallery >}}',
        '',
      ].join('\n'),
    );
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /gallery does not accept parameters/,
    );

    // 5. Orphan photo shortcode without gallery/photos parent
    await writeFile(
      postPath,
      [
        '---',
        'title: Bad Gallery',
        'date: 2026-09-09T00:00:00Z',
        '---',
        '{{< photo src="https://images.example.test/ok.jpg" >}}',
        '',
      ].join('\n'),
    );
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /photo requires a photos or gallery parent/,
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});
