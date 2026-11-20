/** Browser end-to-end coverage for inline gallery, gallery-mode lightbox, synchronization, and fallbacks. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';

let fixtureRoot;
let siteBaseURL;
let server;

/**
 * Create an SVG image string with explicit pixel dimensions.
 * @param {number} width - Intrinsic width.
 * @param {number} height - Intrinsic height.
 * @param {string} fill - Background color.
 * @param {string} label - Text label.
 * @returns {string} SVG source.
 */
function makeSvg(width, height, fill, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="36">${label}</text></svg>`;
}

/**
 * Compute an unsigned CRC-32 checksum for PNG chunk encoding.
 * @param {Buffer} buffer - Input bytes.
 * @returns {number} Unsigned 32-bit CRC.
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encode one PNG chunk with type, payload, and CRC.
 * @param {string} type - 4-character chunk type.
 * @param {Buffer} data - Chunk payload.
 * @returns {Buffer} Complete PNG chunk.
 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * Create a solid-color RGB PNG buffer so Hugo generates responsive WebP variants and dimensions.
 * @param {number} width - Image width in pixels.
 * @param {number} height - Image height in pixels.
 * @param {[number, number, number]} rgb - RGB channel values (0-255).
 * @returns {Buffer} Valid PNG file buffer.
 */
function makePng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Serve an isolated production build over HTTP.
 * @param {string} directory - Built public directory.
 * @returns {Promise<string>} Base URL.
 */
async function serve(directory) {
  const types = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://fixture').pathname,
      );
      let file = path.resolve(directory, `.${pathname}`);
      if (!file.startsWith(`${directory}${path.sep}`) && file !== directory)
        throw new Error('Request escaped fixture output.');
      if ((await stat(file)).isDirectory())
        file = path.join(file, 'index.html');
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test.beforeAll(async () => {
  const assets = [
    // Mixed aspect ratios for Gallery 1 (5 images: landscape, portrait, square, ultra-wide, landscape)
    {
      path: 'content/posts/gallery-suite/g1-1-wide.svg',
      source: makeSvg(800, 500, '#2d4a53', 'G1-1 Wide'),
    },
    {
      path: 'content/posts/gallery-suite/g1-2-tall.svg',
      source: makeSvg(400, 600, '#496b73', 'G1-2 Tall'),
    },
    {
      path: 'content/posts/gallery-suite/g1-3-square.svg',
      source: makeSvg(500, 500, '#3b5962', 'G1-3 Square'),
    },
    {
      path: 'content/posts/gallery-suite/g1-4-ultrawide.svg',
      source: makeSvg(1600, 400, '#1f363d', 'G1-4 UltraWide'),
    },
    {
      path: 'content/posts/gallery-suite/g1-5-end.svg',
      source: makeSvg(700, 500, '#527680', 'G1-5 End'),
    },
    // Narrow pair for Gallery 2 (fits within the desktop gallery column without scrolling, overflows on 320px/390px)
    {
      path: 'content/posts/gallery-suite/g2-1-narrow.svg',
      source: makeSvg(240, 420, '#3e5c63', 'G2-1 Narrow'),
    },
    {
      path: 'content/posts/gallery-suite/g2-2-narrow.svg',
      source: makeSvg(240, 420, '#4f7078', 'G2-2 Narrow'),
    },
    // Single image for Gallery 4 & Photo Wall
    {
      path: 'content/posts/gallery-suite/solo.svg',
      source: makeSvg(600, 400, '#3a5a64', 'Solo'),
    },
    // Assets for captionless gallery & small image edge cases
    {
      path: 'content/posts/lightbox-edges/plain-1.svg',
      source: makeSvg(600, 400, '#2c4852', 'Plain 1'),
    },
    {
      path: 'content/posts/lightbox-edges/plain-2.svg',
      source: makeSvg(400, 600, '#3c5a64', 'Plain 2'),
    },
    {
      path: 'content/posts/lightbox-edges/tiny.svg',
      source: makeSvg(220, 140, '#496b73', 'Tiny'),
    },
  ];

  const g3Photos = Array.from(
    { length: 10 },
    (_, i) =>
      `  {{< photo src="g3-${i + 1}.png" alt="长画廊第 ${i + 1} 张" caption="长画廊图注 ${i + 1}" >}}`,
  ).join('\n');

  const fixture = await createBoundarySite({
    name: 'browser-gallery',
    definition: {
      clock: '2026-09-10T00:00:00Z',
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/plain-post/index.md',
          source: [
            '---',
            'title: 无画廊普通文章',
            'date: 2026-09-08T00:00:00Z',
            '---',
            '',
            '这篇普通文章不包含任何画廊。',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/gallery-suite/index.md',
          source: [
            '---',
            'title: 画廊综合端到端测试',
            'date: 2026-09-09T00:00:00Z',
            '---',
            '',
            '正文起始段落。',
            '',
            '{{< gallery >}}',
            '  {{< photo src="g1-1-wide.svg" alt="横图一" caption="第一张横图图注" >}}',
            '  {{< photo src="g1-2-tall.svg" alt="竖图二" caption="第二张竖图图注" >}}',
            '  {{< photo src="g1-3-square.svg" alt="方图三" >}}',
            '  {{< photo src="g1-4-ultrawide.svg" alt="超宽图四" caption="第四张超宽图图注" >}}',
            '  {{< photo src="g1-5-end.svg" alt="末尾图五" caption="第五张末尾图注" >}}',
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            '  {{< photo src="g2-1-narrow.svg" alt="窄图一" caption="宽屏免滚一" >}}',
            '  {{< photo src="g2-2-narrow.svg" alt="窄图二" caption="宽屏免滚二" >}}',
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            g3Photos,
            '{{< /gallery >}}',
            '',
            '{{< gallery >}}',
            '  {{< photo src="solo.svg" alt="单图画廊" caption="单图画廊说明" >}}',
            '{{< /gallery >}}',
            '',
            '![正文普通单图](solo.svg "普通单图图注")',
            '',
            '{{< photos >}}',
            '  {{< photo src="g1-1-wide.svg" alt="照片墙一" caption="照片墙图一" >}}',
            '  {{< photo src="g1-2-tall.svg" alt="照片墙二" caption="照片墙图二" >}}',
            '{{< /photos >}}',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/lightbox-edges/index.md',
          source: [
            '---',
            'title: 灯箱边界测试',
            'date: 2026-09-07T00:00:00Z',
            '---',
            '',
            '{{< gallery >}}',
            '  {{< photo src="plain-1.svg" alt="无题注一" >}}',
            '  {{< photo src="plain-2.svg" alt="无题注二" >}}',
            '{{< /gallery >}}',
            '',
            '![小尺寸无题注截图](tiny.svg)',
            '',
          ].join('\n'),
        },
      ],
      assets,
    },
  });

  fixtureRoot = fixture.projectRoot;
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      writeFile(
        path.join(fixtureRoot, `content/posts/gallery-suite/g3-${i + 1}.png`),
        makePng(800, 500, [40 + i * 8, 70 + i * 5, 80 + i * 4]),
      ),
    ),
  );
  const build = await buildSite({
    projectRoot: fixtureRoot,
    clock: fixture.clock,
  });
  siteBaseURL = await serve(build.publicDir);
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
});

test('inline gallery layout: equal height, variable width, prose-width column, 12px radius, hidden captions, >7 sliding window, no-overflow progress, and 320px no overflow', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);

  const galleries = page.locator('[data-gallery]');
  await expect(galleries).toHaveCount(3);
  const g1 = galleries.nth(0);
  await expect(g1).toHaveClass(/is-enhanced/);

  // 1. Equal height (420px on desktop), variable natural aspect ratio width, max-width 85%, right peek, 12px border radius, hidden inline captions
  const g1Metrics = await g1.evaluate((root) => {
    const viewport = root.querySelector('[data-gallery-viewport]');
    const track = root.querySelector('[data-gallery-track]');
    const cards = [...root.querySelectorAll('[data-gallery-card]')];
    const links = cards.map((c) => c.querySelector('.gallery-link'));
    const captions = [...root.querySelectorAll('.gallery-caption')];
    const vpRect = viewport.getBoundingClientRect();
    const cardRects = cards.map((c) => c.getBoundingClientRect());
    return {
      trackHeight: track.getBoundingClientRect().height,
      viewportWidth: vpRect.width,
      viewportRight: vpRect.right,
      cardWidths: cardRects.map((r) => Math.round(r.width)),
      cardHeights: cardRects.map((r) => Math.round(r.height)),
      cardLefts: cardRects.map((r) => r.left),
      cardRights: cardRects.map((r) => r.right),
      linkRadii: links.map((l) => globalThis.getComputedStyle(l).borderRadius),
      captionsHidden: captions.every(
        (cap) => globalThis.getComputedStyle(cap).display === 'none',
      ),
    };
  });

  expect(g1Metrics.trackHeight).toBe(420);
  expect(g1Metrics.viewportWidth).toBe(740);
  expect(g1Metrics.cardHeights.every((h) => h === 420)).toBe(true);
  // Wide (800x500 -> ~672px) vs Tall (400x600 -> ~280px) vs Square (500x500 -> 420px)
  expect(g1Metrics.cardWidths[0]).toBeGreaterThan(g1Metrics.cardWidths[2]);
  expect(g1Metrics.cardWidths[2]).toBeGreaterThan(g1Metrics.cardWidths[1]);
  // Ultra-wide card (1600x400) is constrained by max-width 85% of viewport
  expect(g1Metrics.cardWidths[3]).toBeLessThanOrEqual(
    Math.ceil(g1Metrics.viewportWidth * 0.85),
  );
  // Second card peeks on the right edge of the first card inside viewport
  expect(g1Metrics.cardLefts[1]).toBeLessThan(g1Metrics.viewportRight);
  expect(g1Metrics.linkRadii.every((r) => r === '12px')).toBe(true);
  expect(g1Metrics.captionsHidden).toBe(true);

  // 2. Gallery 2 fits completely in the prose-width gallery column -> arrows auto-hide, progress stays visible
  const g2 = galleries.nth(1);
  await expect(g2).toHaveAttribute('data-gallery-static', '');
  const g2Progress = g2.locator('[data-gallery-progress]');
  await expect(g2Progress).toBeVisible();
  await expect(g2Progress.locator('.gallery-progress-segment')).toHaveCount(2);
  await expect(
    g2Progress.locator('.gallery-progress-segment.is-active'),
  ).toHaveAttribute('data-index', '0');
  await expect(g2.locator('[data-gallery-prev]')).toBeHidden();
  await expect(g2.locator('[data-gallery-next]')).toBeHidden();

  // 3. Gallery 3 (10 images) has >7 snaps -> progress bar renders at most 7 segments with edge dot
  const g3 = galleries.nth(2);
  const g3Progress = g3.locator('[data-gallery-progress]');
  await expect(g3Progress).toBeVisible();
  const g3Segments = g3Progress.locator('.gallery-progress-segment');
  await expect(g3Segments).toHaveCount(7);
  await expect(g3Segments.nth(0)).toHaveClass(/is-active/);
  await expect(g3Segments.nth(6)).toHaveClass(/is-edge/);

  // 4. Light and dark theme token adaptation
  const readThemeColors = () =>
    g1.evaluate((root) => {
      const activeSeg = root.querySelector(
        '.gallery-progress-segment.is-active',
      );
      const inactiveSeg = root.querySelector(
        '.gallery-progress-segment:not(.is-active)',
      );
      const link = root.querySelector('.gallery-link');
      return {
        activeBg: globalThis.getComputedStyle(activeSeg).backgroundColor,
        inactiveBg: globalThis.getComputedStyle(inactiveSeg).backgroundColor,
        cardBg: globalThis.getComputedStyle(link).backgroundColor,
      };
    });
  const lightColors = await readThemeColors();
  expect(lightColors.activeBg).toBe('rgb(23, 23, 23)');
  expect(lightColors.inactiveBg).toBe('rgb(229, 229, 229)');
  expect(lightColors.cardBg).toBe('rgb(245, 245, 245)');

  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  const darkColors = await readThemeColors();
  expect(darkColors.activeBg).toBe('rgb(229, 229, 229)');
  expect(darkColors.inactiveBg).toBe('rgb(64, 64, 64)');
  expect(darkColors.cardBg).toBe('rgb(38, 38, 38)');
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'light';
  });

  // 5. On 320px narrow viewport: no page-level horizontal overflow, and Gallery 2 now requires scrolling so its progress bar appears
  await page.setViewportSize({ width: 320, height: 800 });
  const narrowState = await page.evaluate(() => ({
    docWidth: globalThis.document.documentElement.scrollWidth,
    viewport: globalThis.innerWidth,
  }));
  expect(narrowState.docWidth).toBeLessThanOrEqual(narrowState.viewport);
  await expect(g2.locator('[data-gallery-progress]')).toBeVisible();
});

test('inline gallery desktop and mobile interactions: arrows, trimSnaps end alignment, drag without accidental lightbox, wheel, keyboard, and touch', async ({
  page,
  browser,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);

  const g1 = page.locator('[data-gallery]').first();
  const prevBtn = g1.locator('[data-gallery-prev]');
  const nextBtn = g1.locator('[data-gallery-next]');
  const activeSegment = g1.locator(
    '[data-gallery-progress] .gallery-progress-segment.is-active',
  );

  // At start: arrows stay hidden until the pointer enters the gallery; then next arrow shows with >=44x44px hit box
  await expect(prevBtn).toBeHidden();
  await expect(nextBtn).toBeHidden();
  await g1.scrollIntoViewIfNeeded();
  const galleryBox = await g1.boundingBox();
  const hoverX = galleryBox.x + galleryBox.width * 0.5;
  const hoverY = galleryBox.y + galleryBox.height * 0.5;
  await page.mouse.move(hoverX, hoverY);
  await expect(nextBtn).toBeVisible();
  const nextBox = await nextBtn.boundingBox();
  expect(nextBox.width).toBeGreaterThanOrEqual(44);
  expect(nextBox.height).toBeGreaterThanOrEqual(44);
  await expect(activeSegment).toHaveAttribute('data-index', '0');

  // Leaving the gallery hides the arrows again; re-entering restores them
  await page.mouse.move(0, 0);
  await expect(nextBtn).toBeHidden();
  await page.mouse.move(hoverX, hoverY);
  await expect(nextBtn).toBeVisible();

  // Mouse drag starting directly on a card link moves the gallery without opening the lightbox dialog
  const firstCardLink = g1.locator('a[data-lightbox]').first();
  await expect(activeSegment).toHaveAttribute('data-index', '0');
  const firstLinkBox = await firstCardLink.boundingBox();
  const dragStartX = firstLinkBox.x + firstLinkBox.width * 0.8;
  const dragStartY = firstLinkBox.y + firstLinkBox.height * 0.5;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX - 400, dragStartY, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
  await expect(activeSegment).not.toHaveAttribute('data-index', '0');
  await prevBtn.click();
  await expect(activeSegment).toHaveAttribute('data-index', '0');

  // Click next arrow -> advances 1 snap, prev arrow becomes visible
  await nextBtn.click();
  await expect(activeSegment).toHaveAttribute('data-index', '1');
  await expect(prevBtn).toBeVisible();

  // Horizontal wheel gesture advances to next snap
  const viewport = g1.locator('[data-gallery-viewport]');
  await viewport.dispatchEvent('wheel', {
    deltaX: 60,
    deltaY: 0,
    cancelable: true,
  });
  await expect(activeSegment).toHaveAttribute('data-index', '2');

  // Keyboard ArrowRight / ArrowLeft when focused inside gallery
  await g1.locator('a[data-lightbox]').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(activeSegment).toHaveAttribute('data-index', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(activeSegment).toHaveAttribute('data-index', '2');

  // Step to the last snap: next arrow hides, and last card aligns flush with right edge of viewport (trimSnaps)
  while (await nextBtn.isVisible()) {
    await nextBtn.click();
  }
  await expect(nextBtn).toBeHidden();
  const endAlignment = await g1.evaluate((root) => {
    const vpRect = root
      .querySelector('[data-gallery-viewport]')
      .getBoundingClientRect();
    const cards = [...root.querySelectorAll('[data-gallery-card]')];
    const lastRect = cards.at(-1).getBoundingClientRect();
    return Math.abs(vpRect.right - lastRect.right);
  });
  expect(endAlignment).toBeLessThanOrEqual(2);

  // Mobile / coarse touch context hides navigation arrows completely
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: browserName !== 'firefox',
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${siteBaseURL}/posts/gallery-suite/`);
  const touchG1 = touchPage.locator('[data-gallery]').first();
  await expect(touchG1.locator('[data-gallery-prev]')).toBeHidden();
  await expect(touchG1.locator('[data-gallery-next]')).toBeHidden();
  const touchHeight = await touchG1
    .locator('[data-gallery-track]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(touchHeight).toBe(340);
  await touchContext.close();
});

/**
 * Dispatch a horizontal touch swipe across an Embla viewport element.
 * @param {import('@playwright/test').Locator} viewport - Scrollable viewport locator.
 * @param {number} deltaX - Horizontal drag offset in pixels (negative swipes forward).
 * @returns {Promise<void>} Completion.
 */
async function swipeHorizontal(viewport, deltaX) {
  await viewport.evaluate((el, dx) => {
    const rect = el.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.6;
    const startY = rect.top + rect.height * 0.5;
    const createTouch = (x, y) =>
      new globalThis.Touch({
        identifier: 1,
        target: el,
        clientX: x,
        clientY: y,
      });
    const emit = (type, x, y, includeActive) => {
      const touch = createTouch(x, y);
      el.dispatchEvent(
        new globalThis.TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: includeActive ? [touch] : [],
          targetTouches: includeActive ? [touch] : [],
          changedTouches: [touch],
        }),
      );
    };
    emit('touchstart', startX, startY, true);
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      emit('touchmove', startX + (dx * step) / steps, startY, true);
    }
    emit('touchend', startX + dx, startY, false);
  }, deltaX);
}

test('gallery-mode lightbox: fullscreen dark canvas, reserved caption slot stability, blank-space dismissal without drag false positives, syncs inline gallery and restores focus', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);

  const g1 = page.locator('[data-gallery]').first();
  const dialog = page.locator('#image-dialog[data-lightbox-dialog]');
  const dialogProgress = dialog.locator('[data-lightbox-progress]');
  const dialogCaption = dialog.locator('[data-lightbox-caption]');

  // Click the 2nd card (index 1, portrait tall image)
  await g1.locator('a[data-lightbox]').nth(1).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-lightbox-mode', 'gallery');
  await expect(dialog).toHaveAttribute('data-lightbox-has-captions', '');
  await expect(dialog).toHaveCSS('background-color', 'rgba(10, 10, 10, 0.92)');

  // Fullscreen dimensions and sharp image corners (border-radius: 0)
  const canvasBox = await dialog.boundingBox();
  expect(canvasBox.width).toBeCloseTo(1440, 0);
  expect(canvasBox.height).toBeCloseTo(900, 0);
  await expect(dialog.locator('[data-lightbox-slide="1"] img')).toHaveCSS(
    'border-radius',
    '0px',
  );

  // Lightbox progress bar matches total image count (5) and uses high-contrast white active segment on dark canvas
  const lbSegments = dialogProgress.locator('.gallery-progress-segment');
  await expect(lbSegments).toHaveCount(5);
  await expect(lbSegments.nth(1)).toHaveClass(/is-active/);
  await expect(lbSegments.nth(1)).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(dialogCaption).toBeVisible();
  await expect(dialogCaption).toHaveText('第二张竖图图注');

  // Measure stage height on captioned slide (index 1)
  const stageBoxOnCaptioned = await dialog
    .locator('[data-lightbox-gallery-stage]')
    .boundingBox();

  // Navigate to index 2 (square image without caption) via lightbox next button
  const lbNext = dialog.locator('[data-lightbox-next]');
  const lbPrev = dialog.locator('[data-lightbox-prev]');
  await expect(lbPrev).toBeVisible();
  await expect(lbNext).toBeVisible();
  await lbNext.click();

  await expect(lbSegments.nth(2)).toHaveClass(/is-active/);
  // Slide 2 has no caption -> reserved bottom slot stays mounted with empty text so stage height does not jump
  await expect(dialogCaption).toHaveText('');
  const stageBoxOnUncaptioned = await dialog
    .locator('[data-lightbox-gallery-stage]')
    .boundingBox();
  expect(
    Math.abs(stageBoxOnUncaptioned.height - stageBoxOnCaptioned.height),
  ).toBeLessThanOrEqual(1);

  // Navigate to index 3 (ultra-wide) and index 4 (last image) via ArrowRight
  await page.keyboard.press('ArrowRight');
  await expect(lbSegments.nth(3)).toHaveClass(/is-active/);
  await expect(dialogCaption).toBeVisible();
  await expect(dialogCaption).toHaveText('第四张超宽图图注');

  await page.keyboard.press('ArrowRight');
  await expect(lbSegments.nth(4)).toHaveClass(/is-active/);
  await expect(dialogCaption).toHaveText('第五张末尾图注');
  // At last image: next arrow is hidden and pressing ArrowRight does not wrap around
  await expect(lbNext).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(lbSegments.nth(4)).toHaveClass(/is-active/);

  // Clicking the image itself, caption text, or progress bar does NOT close the lightbox
  await dialog.locator('[data-lightbox-slide="4"] img').click();
  await expect(dialog).toBeVisible();
  await dialogCaption.click();
  await expect(dialog).toBeVisible();
  const progBox = await dialogProgress.boundingBox();
  await page.mouse.click(
    progBox.x + progBox.width / 2,
    progBox.y + progBox.height / 2,
  );
  await expect(dialog).toBeVisible();

  // Dragging across blank area of the slide switches slides without accidentally closing the lightbox
  const stageBox = await dialog
    .locator('[data-lightbox-gallery-stage]')
    .boundingBox();
  await page.mouse.move(stageBox.x + 120, stageBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 420, stageBox.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(lbSegments.nth(3)).toHaveClass(/is-active/);

  // Close with Escape: inline gallery automatically synced to the last viewed image (index 3) and focus returns to its trigger link
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(g1.locator('a[data-lightbox]').nth(3)).toBeFocused();

  // Reopen at index 4, step back to index 3, and dismiss by clicking blank space inside the slide margin around the image
  const fifthLink = g1.locator('a[data-lightbox]').nth(4);
  await fifthLink.click();
  await expect(dialog).toBeVisible();
  await expect(lbSegments.nth(4)).toHaveClass(/is-active/);
  await page.keyboard.press('ArrowLeft');
  await expect(lbSegments.nth(3)).toHaveClass(/is-active/);
  const blankBox = await dialog
    .locator('[data-lightbox-gallery-stage]')
    .boundingBox();
  await page.mouse.click(blankBox.x + 16, blankBox.y + 16);
  await expect(dialog).not.toBeVisible();
  await expect(g1.locator('a[data-lightbox]').nth(3)).toBeFocused();

  // Reopen and dismiss via explicit close button
  await g1.locator('a[data-lightbox]').nth(3).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-close]').click();
  await expect(dialog).not.toBeVisible();
  await expect(g1.locator('a[data-lightbox]').nth(3)).toBeFocused();

  // All-uncaptioned gallery hides the bottom caption slot completely; tiny standalone image does not upscale beyond natural dimensions
  await page.goto(`${siteBaseURL}/posts/lightbox-edges/`);
  await page.locator('[data-gallery] a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-lightbox-has-captions', '');
  await expect(dialogCaption).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  await page.locator('figure.wide a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialogCaption).toBeHidden();
  const tinyMetrics = await dialog
    .locator('[data-lightbox-content] > img')
    .evaluate((img) => {
      const box = img.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    });
  expect(tinyMetrics.width).toBeCloseTo(220, 0);
  expect(tinyMetrics.height).toBeCloseTo(140, 0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('gallery-mode lightbox: lazy ±1 preloading, image load failure fallback, and mobile touch swipe without arrows', async ({
  page,
  browser,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });

  const requestedPaths = new Set();
  page.on('request', (req) => {
    requestedPaths.add(new URL(req.url()).pathname);
  });

  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);
  const g3 = page.locator('[data-gallery]').nth(2);
  const dialog = page.locator('#image-dialog[data-lightbox-dialog]');
  const lbSegments = dialog.locator(
    '[data-lightbox-progress] .gallery-progress-segment',
  );
  const targetUrl9 = await g3
    .locator('a[data-lightbox]')
    .nth(8)
    .getAttribute('data-lightbox-src');
  const targetUrl10 = await g3
    .locator('a[data-lightbox]')
    .nth(9)
    .getAttribute('data-lightbox-src');

  // Open 10-image gallery at index 0: distant full-resolution slides are not eagerly loaded or requested
  await g3.locator('a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  await expect(lbSegments.first()).toHaveAttribute('data-index', '0');
  expect(requestedPaths.has(targetUrl9)).toBe(false);
  expect(requestedPaths.has(targetUrl10)).toBe(false);
  await expect(
    dialog.locator('[data-lightbox-slide="8"] img'),
  ).not.toHaveAttribute('src', targetUrl9);
  await expect(
    dialog.locator('[data-lightbox-slide="9"] img'),
  ).not.toHaveAttribute('src', targetUrl10);

  // Step forward to index 7: slide 8 (+1) is preloaded, while slide 9 (+2) is still unloaded
  for (let step = 0; step < 7; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(
    dialog.locator(
      '[data-lightbox-progress] .gallery-progress-segment.is-active',
    ),
  ).toHaveAttribute('data-index', '7');
  await expect(dialog.locator('[data-lightbox-slide="8"] img')).toHaveAttribute(
    'src',
    targetUrl9,
  );
  await expect(
    dialog.locator('[data-lightbox-slide="9"] img'),
  ).not.toHaveAttribute('src', targetUrl10);
  expect(requestedPaths.has(targetUrl10)).toBe(false);

  // Step to index 8: slide 9 (+1) is now preloaded
  await page.keyboard.press('ArrowRight');
  await expect(
    dialog.locator(
      '[data-lightbox-progress] .gallery-progress-segment.is-active',
    ),
  ).toHaveAttribute('data-index', '8');
  await expect(dialog.locator('[data-lightbox-slide="9"] img')).toHaveAttribute(
    'src',
    targetUrl10,
  );
  expect(requestedPaths.has(targetUrl10)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // Failure fallback: abort g3-10 requests on a fresh load and verify alt, caption, and status text
  await page.route('**/g3-10*', (route) => route.abort());
  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);
  const g3Reloaded = page.locator('[data-gallery]').nth(2);
  await g3Reloaded.locator('a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 9; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
  const failedSlide = dialog.locator('[data-lightbox-slide="9"]');
  await expect(failedSlide).toHaveAttribute('data-slide-failed', '');
  await expect(failedSlide.locator('img')).toHaveAttribute(
    'alt',
    '长画廊第 10 张',
  );
  await expect(dialog.locator('[data-lightbox-caption]')).toBeVisible();
  await expect(dialog.locator('[data-lightbox-caption]')).toHaveText(
    '长画廊图注 10',
  );
  await expect(dialog.locator('[data-lightbox-status]')).toBeVisible();
  await expect(dialog.locator('[data-lightbox-status]')).toHaveText(
    '图片加载失败，请稍后重试。',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('[data-lightbox-status]')).toHaveText('');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.unroute('**/g3-10*');

  // Mobile / coarse touch context: lightbox hides arrows and advances via touch swipe
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: browserName !== 'firefox',
  });
  const touchPage = await touchContext.newPage();
  await touchPage.emulateMedia({ reducedMotion: 'reduce' });
  await touchPage.goto(`${siteBaseURL}/posts/gallery-suite/`);
  const touchG1 = touchPage.locator('[data-gallery]').first();
  const touchDialog = touchPage.locator('#image-dialog[data-lightbox-dialog]');
  await touchG1.locator('a[data-lightbox]').first().tap();
  await expect(touchDialog).toBeVisible();
  await expect(touchDialog).toHaveAttribute('data-lightbox-mode', 'gallery');
  await expect(touchDialog.locator('[data-lightbox-prev]')).toBeHidden();
  await expect(touchDialog.locator('[data-lightbox-next]')).toBeHidden();
  await expect(touchDialog.locator('[data-lightbox-caption]')).toHaveText(
    '第一张横图图注',
  );

  await swipeHorizontal(
    touchDialog.locator('[data-lightbox-gallery-viewport]'),
    -220,
  );
  await expect(
    touchDialog.locator(
      '[data-lightbox-progress] .gallery-progress-segment.is-active',
    ),
  ).toHaveAttribute('data-index', '1');
  await expect(touchDialog.locator('[data-lightbox-caption]')).toHaveText(
    '第二张竖图图注',
  );
  await touchDialog.locator('[data-dialog-close]').tap();
  await expect(touchDialog).not.toBeVisible();
  await touchContext.close();
});

test('single-image gallery and standalone image use single-image lightbox while multi-image photo wall uses gallery-mode lightbox and syncs on close', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${siteBaseURL}/posts/gallery-suite/`);

  const dialog = page.locator('#image-dialog[data-lightbox-dialog]');

  // 1. Single-image gallery is visible without manual scrolling, keeps 12px radius + aspect ratio, and opens single-image lightbox
  const singleLink = page.locator('.gallery.gallery-single a[data-lightbox]');
  await singleLink.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-lightbox-mode', 'gallery');
  await expect(dialog.locator('[data-lightbox-progress]')).toBeHidden();
  await expect(dialog.locator('[data-lightbox-gallery-stage]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  const singleMetrics = await singleLink.evaluate((link) => {
    const img = link.querySelector('.gallery-image');
    const rect = img.getBoundingClientRect();
    return {
      linkRadius: globalThis.getComputedStyle(link).borderRadius,
      imgRadius: globalThis.getComputedStyle(img).borderRadius,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(singleMetrics.linkRadius).toBe('12px');
  expect(singleMetrics.imgRadius).toBe('12px');
  expect(
    Math.abs(singleMetrics.width / singleMetrics.height - 600 / 400),
  ).toBeLessThan(0.02);

  // 2. Standalone article image opens standard single-image lightbox
  const standaloneLink = page.locator(
    'figure.wide a.image-open[data-lightbox]',
  );
  await standaloneLink.scrollIntoViewIfNeeded();
  await standaloneLink.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-lightbox-mode', 'gallery');
  await expect(dialog.locator('[data-lightbox-progress]')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // 3. Multi-image photo wall opens gallery-mode lightbox with segmented progress bar and syncs photo wall state on close
  const photoWall = page.locator('.photo-stack[data-photo-stack]');
  await photoWall.scrollIntoViewIfNeeded();
  await photoWall.locator('a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-lightbox-mode', 'gallery');
  const photoSegments = dialog.locator(
    '[data-lightbox-progress] .gallery-progress-segment',
  );
  await expect(photoSegments).toHaveCount(2);
  await expect(photoSegments.nth(0)).toHaveClass(/is-active/);
  await expect(dialog.locator('[data-lightbox-caption]')).toHaveText(
    '照片墙图一',
  );
  await page.keyboard.press('ArrowRight');
  await expect(photoSegments.nth(1)).toHaveClass(/is-active/);
  await expect(dialog.locator('[data-lightbox-caption]')).toHaveText(
    '照片墙图二',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(photoWall.locator('[data-photo-counter]')).toHaveText('2 / 2');
  await expect(photoWall.locator('a[data-lightbox]').nth(1)).toBeFocused();
});

test('no-JS fallback, multi-gallery independence, and partial page navigation lifecycle without duplicate bindings or unused chunk loads', async ({
  page,
  browser,
}) => {
  // 1. No-JS fallback: readable horizontal scroll stream, visible captions, hidden controls, working original image hrefs
  const noJsContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1024, height: 768 },
  });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(`${siteBaseURL}/posts/gallery-suite/`);
  const noJsGallery = noJsPage.locator('[data-gallery]').first();
  await expect(noJsGallery).not.toHaveClass(/is-enhanced/);
  await expect(noJsGallery.locator('[data-gallery-progress]')).toBeHidden();
  await expect(noJsGallery.locator('[data-gallery-prev]')).toBeHidden();
  await expect(noJsGallery.locator('[data-gallery-next]')).toBeHidden();
  await expect(noJsGallery.locator('.gallery-caption').first()).toBeVisible();
  await expect(noJsGallery.locator('a[data-lightbox]').first()).toHaveAttribute(
    'href',
    /g1-1-wide\.svg$/,
  );
  await noJsContext.close();

  // 2. Pages without galleries do NOT load the gallery JS chunk; navigating into a gallery article loads and initializes it cleanly
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const loadedScripts = [];
  page.on('request', (req) => {
    if (req.url().includes('/night-theme/js/')) {
      loadedScripts.push(req.url());
    }
  });

  await page.goto(`${siteBaseURL}/posts/plain-post/`);
  expect(loadedScripts.some((url) => url.includes('gallery-'))).toBe(false);

  // Navigate to gallery-suite and back twice via partial navigation
  for (let visit = 0; visit < 2; visit += 1) {
    await page.goto(`${siteBaseURL}/`);
    await page.locator('a[href="/posts/gallery-suite/"]').first().click();
    await expect(page).toHaveURL(`${siteBaseURL}/posts/gallery-suite/`);

    const g1 = page.locator('[data-gallery]').nth(0);
    const g3 = page.locator('[data-gallery]').nth(2);
    await expect(g1).toHaveClass(/is-enhanced/);
    await expect(g3).toHaveClass(/is-enhanced/);

    // Clicking next on g1 advances g1 by exactly 1 step (no duplicate listeners) and does not affect g3
    await g1.hover();
    await g1.locator('[data-gallery-next]').click();
    await expect(
      g1.locator('[data-gallery-progress] .gallery-progress-segment.is-active'),
    ).toHaveAttribute('data-index', '1');
    await expect(
      g3.locator('[data-gallery-progress] .gallery-progress-segment.is-active'),
    ).toHaveAttribute('data-index', '0');

    await page.locator('[data-article-back]').click();
    await expect(page).toHaveURL(`${siteBaseURL}/`);
  }
});
