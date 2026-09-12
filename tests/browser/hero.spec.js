/** Browser coverage for Cycle 04 hero interaction and visual contracts. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';

const projectRoot = process.cwd();
const coverSource = path.join(
  projectRoot,
  'exampleSite/content/posts/post-3/bryce-canyon.jpg',
);
let fixtureRoot;
let fixtureBaseURL;
let coverBytes;
let server;

/**
 * Create three ranked featured posts with local, remote, and absent covers.
 * @returns {object} Isolated site definition.
 */
function browserDefinition() {
  return {
    clock: '2026-09-10T00:00:00Z',
    content: [
      { path: '_index.md', source: '---\ntitle: Hero Browser\n---\n' },
      { path: 'posts/_index.md', source: '---\ntitle: Hero Posts\n---\n' },
      {
        path: 'posts/hero-one/index.md',
        source: [
          '---',
          'title: 雾中写下的第一篇推荐文章',
          'date: 2026-09-09T12:04:00Z',
          'description: 把日常观察与技术实践，安静地收进同一片海雾。',
          'featured: true',
          'cover: cover.jpg',
          'cover_position: 40% 50%',
          '---',
          '第一篇正文。',
          '',
        ].join('\n'),
      },
      {
        path: 'posts/hero-two/index.md',
        source: [
          '---',
          'title: 第二篇推荐',
          'date: 2026-09-09T12:03:00Z',
          'lastmod: 2026-09-09T18:03:00Z',
          'description: 第二篇推荐摘要。',
          'featured: true',
          'cover: cover-two.jpg',
          'cover_position: 25% 40%',
          '---',
          '第二篇正文。',
          '',
        ].join('\n'),
      },
      {
        path: 'posts/hero-three/index.md',
        source: [
          '---',
          'title: 一段很长很长用来确认移动端推荐标题保持单行省略而不会撑破卡片边界的标题并且主推荐标题无论有多少行都必须完整显示不能被固定高度裁切所以这里继续加入足够多的文字验证推荐区域能够随着真实内容自然增长而不是让底部的选择按钮或阅读入口消失',
          'date: 2026-09-09T12:02:00Z',
          'featured: true',
          '---',
          '<!--more-->',
          '第三篇正文。',
          '',
        ].join('\n'),
      },
      {
        path: 'posts/ordinary/index.md',
        source:
          '---\ntitle: 普通列表文章\ndate: 2026-09-08T12:00:00Z\n---\n普通正文。\n',
      },
    ],
  };
}

/**
 * Serve an isolated production build over HTTP.
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
    '.webp': 'image/webp',
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

/**
 * Wait for the dynamically imported hero module.
 * @param {import('@playwright/test').Page} page - Active browser page.
 * @returns {Promise<void>} Completion.
 */
async function waitForHero(page) {
  await expect(page.locator('[data-hero]')).toHaveAttribute(
    'data-hero-enhanced',
    '',
  );
}

/**
 * Capture one viewport and theme combination.
 * @param {import('@playwright/test').Page} page - Active page.
 * @param {number} width - Viewport width.
 * @param {number} height - Viewport height.
 * @param {'light'|'dark'} theme - Stored theme.
 * @param {string} filename - Screenshot filename.
 * @returns {Promise<void>} Completion.
 */
async function capture(page, width, height, theme, filename) {
  await page.setViewportSize({ width, height });
  await page.goto(fixtureBaseURL);
  await waitForHero(page);
  await page.evaluate((value) => {
    localStorage.setItem('bugu-theme', value);
    globalThis.document.documentElement.dataset.themeMode = value;
    globalThis.document.documentElement.dataset.theme = value;
    globalThis.document.documentElement.style.colorScheme = value;
    globalThis.history.scrollRestoration = 'manual';
    globalThis.scrollTo(0, 0);
  }, theme);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: path.join(
      projectRoot,
      'docs/agent-work/cycle-04/screenshots',
      filename,
    ),
  });
}

test.beforeAll(async () => {
  const fixture = await createBoundarySite({
    name: 'browser-hero',
    definition: browserDefinition(),
  });
  fixtureRoot = fixture.projectRoot;
  await cp(
    coverSource,
    path.join(fixtureRoot, 'content/posts/hero-one/cover.jpg'),
  );
  await cp(
    coverSource,
    path.join(fixtureRoot, 'content/posts/hero-two/cover-two.jpg'),
  );
  coverBytes = await readFile(coverSource);
  const build = await buildSite({
    projectRoot: fixtureRoot,
    clock: fixture.clock,
  });
  fixtureBaseURL = await serve(build.publicDir);
  await mkdir(path.join(projectRoot, 'docs/agent-work/cycle-04/screenshots'), {
    recursive: true,
  });
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
});

test('manual selection updates every field, aria state, and never auto-plays', async ({
  page,
}) => {
  await page.goto(fixtureBaseURL);
  await waitForHero(page);
  const choices = page.locator('[data-hero-choice]');
  await expect(choices).toHaveCount(3);
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-hero-link]')).toHaveText(
    '雾中写下的第一篇推荐文章',
  );
  await expect(page.locator('[data-hero-description]')).toHaveText(
    '把日常观察与技术实践，安静地收进同一片海雾。',
  );

  await choices.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${fixtureBaseURL}/`);
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-hero-link]')).toHaveText('第二篇推荐');
  await expect(page.locator('[data-hero-description]')).toHaveText(
    '第二篇推荐摘要。',
  );
  await expect(page.locator('[data-hero-date]')).toContainText('更新于');
  await expect(page.locator('[data-hero-time]')).toHaveText('1 分钟');
  await expect(page.locator('[data-hero-link]')).toHaveAttribute(
    'href',
    '/posts/hero-two/',
  );
  await expect(page.locator('[data-hero-read]')).toHaveAttribute(
    'href',
    '/posts/hero-two/',
  );
  await expect(page.locator('[data-hero-cover]')).toBeVisible();
  await expect(page.locator('[data-hero-cover]')).toHaveAttribute(
    'src',
    /\/posts\/hero-two\/cover-two_.*\.webp$/,
  );
  await expect(page.locator('[data-hero-cover]')).toHaveAttribute(
    'srcset',
    /300w/,
  );
  await expect(page.locator('[data-hero-cover]')).toHaveCSS(
    'object-position',
    '25% 40%',
  );

  await choices.nth(2).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-hero-link]')).toContainText('一段很长很长');
  await expect(page.locator('[data-hero-description]')).toBeHidden();
  const selectedTitle = await page.locator('[data-hero-link]').textContent();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-hero-link]')).toHaveText(selectedTitle);
});

test('failed and stale cover requests keep the current pure-color state', async ({
  page,
}) => {
  let releaseSlow;
  const slow = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  await page.route('**/posts/hero-two/**', async (route) => {
    await slow;
    await route.fulfill({ contentType: 'image/jpeg', body: coverBytes });
  });
  await page.goto(fixtureBaseURL);
  await waitForHero(page);
  await page.locator('[data-hero-choice]').nth(1).click();
  await expect(page.locator('[data-hero-cover]')).toBeHidden();
  await page.locator('[data-hero-choice]').nth(2).click();
  await expect(page.locator('[data-hero-link]')).toContainText('一段很长很长');
  releaseSlow();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-hero-cover]')).toBeHidden();
  await expect(page.locator('[data-hero]')).toHaveClass(/hero-cover-empty/);
});

test('no-JavaScript output keeps the main feature and all candidates reachable', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(fixtureBaseURL);
  await expect(page.locator('[data-hero-link]')).toHaveAttribute(
    'href',
    '/posts/hero-one/',
  );
  await expect(page.locator('.hero-fallback a')).toHaveCount(2);
  await expect(page.locator('.hero-fallback a').nth(0)).toHaveAttribute(
    'href',
    '/posts/hero-two/',
  );
  await expect(page.locator('.hero-fallback a').nth(1)).toHaveAttribute(
    'href',
    '/posts/hero-three/',
  );
  await expect(page.locator('.masonry > .post')).toHaveCount(4);
  await context.close();
});

test('desktop, mobile, and long-title geometry match the latest hero revisions', async ({
  page,
}) => {
  await page.route('https://images.example.test/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureBaseURL);
  await waitForHero(page);
  await expect(page.locator('[data-hero]')).toHaveCSS('height', '440px');
  await expect(page.locator('.hero-read')).toHaveCSS('padding', '8px 18px');
  await expect(page.locator('.hero-read')).toHaveCSS('height', '40px');
  await expect(page.locator('.hero-read')).toHaveCSS('margin-top', '25px');
  await expect(page.locator('.choice-copy small').first()).toHaveCSS(
    'line-height',
    '16.5px',
  );
  await expect(page.locator('[data-header]')).toHaveClass(/header-overlay/);
  await expect(page.locator('[data-header]')).not.toHaveClass(
    /header-scrolled/,
  );
  await page.waitForTimeout(450);
  expect(
    await page
      .locator('[data-header]')
      .evaluate(
        (element) => globalThis.getComputedStyle(element).backgroundColor,
      ),
  ).toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => globalThis.scrollTo(0, 180));
  await expect(page.locator('[data-header]')).toHaveClass(/header-scrolled/);
  expect(
    await page
      .locator('[data-header]')
      .evaluate(
        (element) => globalThis.getComputedStyle(element).backgroundColor,
      ),
  ).not.toBe('rgba(0, 0, 0, 0)');

  for (const [width, height, expectedHero] of [
    [390, 844, 640],
    [360, 800, 600],
    [320, 720, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(fixtureBaseURL);
    await waitForHero(page);
    await expect(page.locator('[data-hero]')).toHaveCSS('padding-top', '72px');
    await expect(page.locator('.hero-read')).toHaveCSS('padding', '7px 15px');
    await expect(page.locator('.hero-read')).toHaveCSS('height', '38px');
    await expect(page.locator('[data-hero]')).toHaveCSS(
      'height',
      `${expectedHero}px`,
    );
    const geometry = await page.locator('[data-hero]').evaluate((hero) => {
      const image = hero.querySelector('.hero-choice-thumb');
      const title = hero.querySelector('.choice-copy > span');
      const box = image.getBoundingClientRect();
      return {
        overflow:
          globalThis.document.documentElement.scrollWidth >
          globalThis.innerWidth,
        ratio: box.width / box.height,
        titleLines: Math.round(
          title.getBoundingClientRect().height /
            Number.parseFloat(globalThis.getComputedStyle(title).lineHeight),
        ),
        buttonPaddingBottom: Number.parseFloat(
          globalThis.getComputedStyle(hero.querySelector('[data-hero-choice]'))
            .paddingBottom,
        ),
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.ratio).toBeCloseTo(1.5, 1);
    expect(geometry.titleLines).toBe(1);
    expect(geometry.buttonPaddingBottom).toBe(6);

    if (width <= 390) {
      await page.locator('[data-hero-choice]').nth(2).click();
      const longTitle = await page.locator('[data-hero]').evaluate((hero) => {
        const heroBox = hero.getBoundingClientRect();
        const panelBox = hero
          .querySelector('.hero-panel')
          .getBoundingClientRect();
        const selectionBox = hero
          .querySelector('.hero-selection')
          .getBoundingClientRect();
        return {
          height: heroBox.height,
          panelInside:
            panelBox.top >= heroBox.top && panelBox.bottom <= heroBox.bottom,
          selectionInside:
            selectionBox.top >= heroBox.top &&
            selectionBox.bottom <= heroBox.bottom,
          ordered: panelBox.bottom <= selectionBox.top,
        };
      });
      expect(longTitle.height).toBeGreaterThan(expectedHero);
      expect(longTitle.panelInside).toBe(true);
      expect(longTitle.selectionInside).toBe(true);
      expect(longTitle.ordered).toBe(true);
    }
  }
});

test('hero has no serious accessibility violations and records visual evidence', async ({
  page,
}) => {
  await page.route('https://images.example.test/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureBaseURL);
  await waitForHero(page);
  const axeSource = await readFile(
    path.join(projectRoot, 'node_modules/axe-core/axe.min.js'),
    'utf8',
  );
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(
      globalThis.document.querySelector('[data-hero]'),
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
    );
    return result.violations.map(({ id, impact }) => ({ id, impact }));
  });
  expect(violations).toEqual([]);

  await capture(page, 1440, 900, 'light', 'hero-desktop-light.png');
  await capture(page, 1440, 900, 'dark', 'hero-desktop-dark.png');
  await capture(page, 390, 844, 'light', 'hero-mobile-light.png');
  await capture(page, 390, 844, 'dark', 'hero-mobile-dark.png');
});
