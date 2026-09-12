/** Browser coverage for Cycle 03 cards, shortest columns, tags, and real pagination. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';
import { hash } from '../../scripts/prepare-content.mjs';

const projectRoot = process.cwd();
const sharedTag = '共同标签';
let fixtureRoot;
let fixtureBaseURL;
let server;

/**
 * Create varied cards with one local cover and one failing HTTPS cover.
 * @returns {object} Isolated site definition.
 */
function browserDefinition() {
  const content = [
    { path: '_index.md', source: '---\ntitle: Browser Home\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: Browser Posts\n---\n' },
  ];
  for (let index = 0; index < 13; index += 1) {
    const title =
      index === 11
        ? 'https://example.com/research/a-very-long-unbroken-address-without-natural-wrap-points'
        : `浏览器卡片 ${String(index).padStart(2, '0')}`;
    const cover =
      index === 0
        ? '\ncover: cover.jpg\ncover_alt: 峡谷风景\ncover_position: 40% 50%'
        : index === 1
          ? '\ncover: https://images.example.invalid/broken.jpg\ncover_alt: 远程封面'
          : '';
    content.push({
      path: `posts/card-${String(index).padStart(2, '0')}/index.md`,
      source: [
        '---',
        `title: "${title}"`,
        'date: 2026-09-09T12:00:00+08:00',
        `created: 2026-09-09T23:${String(59 - index).padStart(2, '0')}:00+08:00${cover}`,
        index === 10
          ? ''
          : `description: "${'用于验证不同高度的中文摘要。'.repeat((index % 4) + 1)}"`,
        'tags:',
        `  - "${sharedTag}"`,
        index === 2 ? '  - "AI"' : '',
        '---',
        index === 10 ? '<!--more-->\n无摘要正文。' : `正文 ${index}。`,
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  return { clock: '2026-09-10T00:00:00Z', content };
}

/**
 * Start a local static server for an isolated production build.
 * @param {string} directory - Public output directory.
 * @returns {Promise<string>} Server base URL.
 */
async function serve(directory) {
  const types = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://fixture').pathname,
      );
      let file = path.resolve(directory, `.${pathname}`);
      if (!file.startsWith(`${directory}${path.sep}`) && file !== directory) {
        throw new Error('Request escaped fixture output.');
      }
      if ((await stat(file)).isDirectory())
        file = path.join(file, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Wait until desktop masonry positioning is committed.
 * @param {import('@playwright/test').Page} page - Active page.
 * @returns {Promise<void>} Completion.
 */
async function waitForMasonry(page) {
  await expect(page.locator('[data-cards]')).toHaveClass(/masonry-enhanced/);
  await expect(page.locator('.post').first()).toHaveCSS('position', 'absolute');
}

test.beforeAll(async () => {
  const fixture = await createBoundarySite({
    name: 'browser-lists',
    definition: browserDefinition(),
  });
  fixtureRoot = fixture.projectRoot;
  await cp(
    path.join(projectRoot, 'content/posts/post-3/bryce-canyon.jpg'),
    path.join(fixtureRoot, 'content/posts/card-00/cover.jpg'),
  );
  const build = await buildSite({
    projectRoot: fixtureRoot,
    clock: fixture.clock,
  });
  fixtureBaseURL = await serve(build.publicDir);
  await mkdir(path.join(projectRoot, 'docs/agent-work/cycle-03/screenshots'), {
    recursive: true,
  });
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
});

test('real HTML pagination remains readable without JavaScript and on direct page two', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(fixtureBaseURL);
  await expect(page.locator('[data-post-list]')).toHaveAttribute(
    'data-page',
    '1',
  );
  await expect(page.locator('.section-count')).toHaveText('13 篇');
  await expect(page.locator('.masonry > article[data-post-url]')).toHaveCount(
    12,
  );
  await expect(page.locator('[data-next]')).toHaveAttribute('href', '/page/2/');
  await expect(page.locator('.post').first()).not.toHaveAttribute(
    'tabindex',
    '0',
  );
  await expect(page.locator('[data-post-title]').first()).not.toHaveAttribute(
    'tabindex',
    '-1',
  );

  await page.locator('[data-next]').click();
  await expect(page).toHaveURL(`${fixtureBaseURL}/page/2/`);
  await expect(page.locator('[data-post-list]')).toHaveAttribute(
    'data-page',
    '2',
  );
  await expect(page.locator('.masonry > article[data-post-url]')).toHaveCount(
    1,
  );
  await expect(page.locator('[rel="prev"]')).toHaveAttribute('href', '/');
  await context.close();
});

test('responsive breakpoints use 1/2/2/3 columns and shortest-column geometry', async ({
  page,
}) => {
  const resizeErrors = [];
  page.on('pageerror', (error) => {
    if (/ResizeObserver loop/i.test(error.message))
      resizeErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (/ResizeObserver loop/i.test(message.text()))
      resizeErrors.push(message.text());
  });
  await page.goto(fixtureBaseURL);
  for (const [width, columns] of [
    [768, 1],
    [769, 2],
    [1100, 2],
    [1101, 3],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    if (columns === 1) {
      await expect(page.locator('[data-cards]')).not.toHaveClass(
        /masonry-enhanced/,
      );
      await expect(page.locator('.post').first()).toHaveCSS(
        'position',
        'static',
      );
    } else {
      await waitForMasonry(page);
      await expect
        .poll(() =>
          page
            .locator('.post')
            .evaluateAll(
              (cards, expectedColumns) =>
                new Set(
                  cards
                    .slice(0, expectedColumns)
                    .map((card) => Math.round(card.getBoundingClientRect().x)),
                ).size,
              columns,
            ),
        )
        .toBe(columns);
    }
  }

  await page.setViewportSize({ width: 1101, height: 900 });
  await waitForMasonry(page);
  await page.locator('.post-inner').evaluateAll((elements) => {
    const heights = [
      320, 160, 240, 180, 140, 260, 120, 220, 170, 280, 130, 200,
    ];
    elements.forEach((element, index) => {
      element.style.height = `${heights[index]}px`;
    });
    globalThis.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(100);

  const result = await page.locator('[data-cards]').evaluate((container) => {
    const cards = [...container.querySelectorAll(':scope > .post')];
    const containerBox = container.getBoundingClientRect();
    const boxes = cards.map((card) => card.getBoundingClientRect());
    const columns = [
      ...new Set(boxes.slice(0, 3).map((box) => Math.round(box.x))),
    ].sort((a, b) => a - b);
    const heights = [0, 0, 0];
    const errors = [];
    boxes.forEach((box, index) => {
      let shortest = 0;
      for (let column = 1; column < heights.length; column += 1) {
        if (heights[column] < heights[shortest]) shortest = column;
      }
      const actualColumn = columns.indexOf(Math.round(box.x));
      const actualY = box.y - containerBox.y;
      if (
        actualColumn !== shortest ||
        Math.abs(actualY - heights[shortest]) > 1
      ) {
        errors.push({
          index,
          actualColumn,
          shortest,
          actualY,
          expectedY: heights[shortest],
        });
      }
      heights[shortest] += box.height + 36;
    });
    return {
      errors,
      urls: cards.map((card) => card.dataset.postUrl),
      covered: containerBox.height >= Math.max(...heights) - 36 - 1,
    };
  });
  expect(result.errors).toEqual([]);
  expect(result.covered).toBe(true);
  expect(result.urls).toEqual(
    Array.from(
      { length: 12 },
      (_, index) => `/posts/card-${String(index).padStart(2, '0')}/`,
    ),
  );

  const focused = page.locator('.post').nth(4);
  await focused.focus();
  await focused.evaluate((card) => {
    globalThis.__cycle03FocusedCard = card;
  });
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(focused).toHaveCSS('position', 'static');
  expect(
    await page.evaluate(
      () =>
        globalThis.__cycle03FocusedCard === globalThis.document.activeElement,
    ),
  ).toBe(true);
  expect(resizeErrors).toEqual([]);

  await page.setViewportSize({ width: 1101, height: 900 });
  await waitForMasonry(page);
  const cards = page.locator('[data-cards]');
  await cards.evaluate((container) => {
    container.style.width = '1px';
    globalThis.dispatchEvent(new Event('resize'));
  });
  await expect(cards).not.toHaveClass(/masonry-enhanced/);
  await expect(page.locator('.post').first()).toHaveCSS('position', 'static');
  await cards.evaluate((container) => {
    container.style.removeProperty('width');
    globalThis.dispatchEvent(new Event('resize'));
  });
  await waitForMasonry(page);
});

test('card enhancement preserves tag links, native title actions, selection, and keyboard entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1101, height: 900 });
  await page.goto(fixtureBaseURL);
  await waitForMasonry(page);
  const firstCard = page.locator('.post').first();
  const title = firstCard.locator('[data-post-title]');
  await expect(firstCard.locator('[data-post-cover]')).toHaveAttribute(
    'width',
    '300',
  );
  await expect(firstCard.locator('[data-post-cover]')).toHaveAttribute(
    'height',
    '200',
  );
  await expect(firstCard.locator('[data-post-cover]')).toHaveAttribute(
    'srcset',
    /300w/,
  );
  await expect(firstCard).toHaveAttribute('tabindex', '0');
  await expect(firstCard).toHaveAttribute('role', 'link');
  await expect(firstCard).toHaveAttribute('aria-label', '浏览器卡片 00');
  await expect(title).toHaveAttribute('tabindex', '-1');
  await expect(firstCard.locator('.post-tag').first()).not.toHaveAttribute(
    'tabindex',
    '-1',
  );
  const tagBox = await firstCard.locator('.post-tag').first().boundingBox();
  expect(tagBox.height).toBeCloseTo(17.6, 1);
  const tagsBox = await firstCard.locator('.post-tags').boundingBox();
  expect(tagBox.x).toBeCloseTo(tagsBox.x, 1);

  await firstCard.focus();
  await page.keyboard.press('Tab');
  await expect(firstCard.locator('.post-tag').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.post').nth(1)).toBeFocused();

  await title.click({ button: 'right' });
  await expect(page).toHaveURL(`${fixtureBaseURL}/`);
  const newTabPromise = page.context().waitForEvent('page');
  await title.click({ modifiers: ['Control'] });
  const newTab = await newTabPromise;
  await newTab.waitForLoadState('domcontentloaded');
  await expect(newTab).toHaveURL(`${fixtureBaseURL}/posts/card-00/`);
  await newTab.close();
  await firstCard.locator('p').evaluate((paragraph) => {
    const range = globalThis.document.createRange();
    range.selectNodeContents(paragraph);
    const selection = globalThis.document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(
      new globalThis.MouseEvent('click', { bubbles: true, button: 0 }),
    );
  });
  await expect(page).toHaveURL(`${fixtureBaseURL}/`);
  await firstCard.locator('p').evaluate((paragraph) => {
    globalThis.document.getSelection().removeAllRanges();
    paragraph.dispatchEvent(
      new globalThis.MouseEvent('click', {
        bubbles: true,
        button: 0,
        ctrlKey: true,
      }),
    );
  });
  await expect(page).toHaveURL(`${fixtureBaseURL}/`);

  const termKey = `t-${hash(sharedTag)}`;
  await firstCard.locator('.post-tag').first().click();
  await expect(page).toHaveURL(`${fixtureBaseURL}/tags/${termKey}/`);
  await expect(page.locator('[data-list-id]')).toHaveAttribute(
    'data-list-id',
    `tag:${termKey}`,
  );

  await page.goto(fixtureBaseURL);
  await waitForMasonry(page);
  await page.locator('.post').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${fixtureBaseURL}/posts/card-00/`);

  await page.goto(fixtureBaseURL);
  await waitForMasonry(page);
  await page.locator('.post').nth(1).focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(`${fixtureBaseURL}/posts/card-01/`);
});

test('failed HTTPS covers become readable text cards and do not overlap', async ({
  page,
}) => {
  await page.route('https://images.example.invalid/**', (route) =>
    route.abort(),
  );
  await page.setViewportSize({ width: 1101, height: 900 });
  await page.goto(fixtureBaseURL);
  const failedCard = page.locator('.post').nth(1);
  await expect(failedCard).toHaveClass(/post-cover-failed/);
  await expect(failedCard.locator('.post-cover-link')).toBeHidden();
  await expect(failedCard.locator('h2')).toHaveText('浏览器卡片 01');
  await waitForMasonry(page);
  const overlaps = await page.locator('.post').evaluateAll((cards) => {
    const boxes = cards.map((card) => card.getBoundingClientRect());
    return boxes.some((first, index) =>
      boxes
        .slice(index + 1)
        .some(
          (second) =>
            first.left < second.right &&
            first.right > second.left &&
            first.top < second.bottom &&
            first.bottom > second.top,
        ),
    );
  });
  expect(overlaps).toBe(false);
});

test('delayed covers trigger a stable relayout without overlap', async ({
  page,
}) => {
  await page.route('**/posts/card-00/*.jpg', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.route('https://images.example.invalid/**', (route) =>
    route.abort(),
  );
  await page.setViewportSize({ width: 1101, height: 900 });
  await page.goto(fixtureBaseURL, { waitUntil: 'domcontentloaded' });
  await waitForMasonry(page);
  await expect
    .poll(() =>
      page
        .locator('[data-post-cover]')
        .first()
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.locator('.post').evaluateAll((cards) => {
        const boxes = cards.map((card) => card.getBoundingClientRect());
        return boxes.some((first, index) =>
          boxes
            .slice(index + 1)
            .some(
              (second) =>
                first.left < second.right &&
                first.right > second.left &&
                first.top < second.bottom &&
                first.bottom > second.top,
            ),
        );
      }),
    )
    .toBe(false);
});

test('list visuals retain reference spacing in desktop/mobile and light/dark modes', async ({
  page,
}) => {
  for (const width of [320, 360, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixtureBaseURL);
    await expect(page.locator('.post').nth(10).locator('p')).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      viewport: globalThis.innerWidth,
      documentWidth: globalThis.document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
  }

  for (const [width, height, size] of [
    [1440, 900, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(fixtureBaseURL);
      await page.evaluate(
        (value) => globalThis.localStorage.setItem('bugu-theme', value),
        theme,
      );
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (width > 768) await waitForMasonry(page);
      else {
        await expect(page.locator('[data-cards]')).not.toHaveClass(
          /masonry-enhanced/,
        );
      }
      const geometry = await page.evaluate(() => ({
        viewport: globalThis.innerWidth,
        documentWidth: globalThis.document.documentElement.scrollWidth,
        sectionIcon: globalThis.document
          .querySelector('.section-title > svg')
          .getBoundingClientRect().width,
        coverRadius: globalThis.getComputedStyle(
          globalThis.document.querySelector('.post img'),
        ).borderRadius,
        gap: globalThis.getComputedStyle(
          globalThis.document.querySelector('[data-cards]'),
        ).gap,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.sectionIcon).toBe(22);
      expect(geometry.coverRadius).toBe('3px');
      expect(geometry.gap).toBe(width <= 768 ? '34px' : '36px');
      await page.screenshot({
        path: path.join(
          projectRoot,
          `docs/agent-work/cycle-03/screenshots/list-${size}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${fixtureBaseURL}/tags/t-${hash(sharedTag)}/`);
  await page.evaluate(() =>
    globalThis.localStorage.setItem('bugu-theme', 'light'),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('[data-list-id]')).toHaveAttribute(
    'data-list-id',
    `tag:t-${hash(sharedTag)}`,
  );
  await page.screenshot({
    path: path.join(
      projectRoot,
      'docs/agent-work/cycle-03/screenshots/list-tag-desktop-light.png',
    ),
    fullPage: true,
  });
});
