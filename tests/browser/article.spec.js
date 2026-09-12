/** Browser coverage for Cycle 05 article layout and reading boundaries. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';
import { readJson } from '../../scripts/lib.mjs';

const projectRoot = process.cwd();
const sourceFixture = await readJson(
  path.join(projectRoot, 'tests/fixtures/article/site.json'),
);
let fixtureRoot;
let fixtureBaseURL;
let server;

/** Return the article fixture with local visual cover assets. @returns {object} Browser fixture definition. */
function browserDefinition() {
  const definition = structuredClone(sourceFixture);
  const replacements = new Map([
    ['complete-frontmatter', 'cover-wide.svg'],
    ['horizontal-cover', 'cover.jpg'],
    ['vertical-cover', 'cover-tall.svg'],
  ]);
  for (const entry of definition.content) {
    const slug = entry.path.match(/^posts\/([^/]+)\/index\.md$/)?.[1];
    if (!replacements.has(slug)) continue;
    entry.source = entry.source.replace(
      /cover: https:\/\/images\.example\.test\/[^\n]+/,
      `cover: ${replacements.get(slug)}`,
    );
    if (slug === 'complete-frontmatter') {
      entry.source += [
        '',
        '## 从一个具体的问题开始',
        '',
        '把当前状态、希望发生的变化和不能改变的约束写下来，下一次迭代就不必从头猜测。',
        '',
        '> 把注意力放在正在解决的问题上，允许答案在尝试中逐渐清晰。',
        '',
        '### 在小范围内反复验证',
        '',
        '文字承担说明，图片承担观察。它们不需要争夺注意力。',
        '',
      ].join('\n');
    }
  }
  definition.assets = [
    {
      path: 'content/posts/complete-frontmatter/cover-wide.svg',
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 700"><defs><linearGradient id="g"><stop stop-color="#263241"/><stop offset="1" stop-color="#6f8ca6"/></linearGradient></defs><rect width="1600" height="700" fill="url(#g)"/><circle cx="1180" cy="210" r="120" fill="#dbe5ef" opacity=".62"/><path d="M0 560 420 260 760 510 1070 330 1600 620V700H0Z" fill="#182331" opacity=".78"/></svg>',
    },
    {
      path: 'content/posts/vertical-cover/cover-tall.svg',
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 1100"><rect width="420" height="1100" fill="#7892a8"/><circle cx="210" cy="260" r="120" fill="#e9eef3"/><path d="M0 920 210 530 420 920V1100H0Z" fill="#263241"/></svg>',
    },
  ];
  return definition;
}

/** Serve an isolated production build over HTTP. @param {string} directory - Public output directory. @returns {Promise<string>} Server base URL. */
async function serve(directory) {
  const types = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
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

/** Set one persisted theme and reload the page. @param {import('@playwright/test').Page} page - Active page. @param {'light'|'dark'} theme - Theme mode. @returns {Promise<void>} Completion. */
async function setTheme(page, theme) {
  await page.evaluate(
    (value) => globalThis.localStorage.setItem('bugu-theme', value),
    theme,
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test.beforeAll(async () => {
  const fixture = await createBoundarySite({
    name: 'browser-article',
    definition: browserDefinition(),
  });
  fixtureRoot = fixture.projectRoot;
  await cp(
    path.join(projectRoot, 'content/posts/post-3/bryce-canyon.jpg'),
    path.join(fixtureRoot, 'content/posts/horizontal-cover/cover.jpg'),
  );
  const build = await buildSite({
    projectRoot: fixtureRoot,
    clock: fixture.clock,
  });
  fixtureBaseURL = await serve(build.publicDir);
  await mkdir(path.join(projectRoot, 'docs/agent-work/cycle-05/screenshots'), {
    recursive: true,
  });
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
});

test('article matches desktop and mobile reading geometry in both themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height, size] of [
    [1440, 1000, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
      await setTheme(page, theme);
      await expect(page.locator('[data-article-cover]')).toHaveJSProperty(
        'complete',
        true,
      );
      const geometry = await page.evaluate(() => {
        const reading = globalThis.document.querySelector('.reading');
        const prose = globalThis.document.querySelector('.prose');
        const title = globalThis.document.querySelector('.article-heading h1');
        const cover = globalThis.document.querySelector('[data-article-cover]');
        const coverStyle = globalThis.getComputedStyle(cover);
        return {
          documentWidth: globalThis.document.documentElement.scrollWidth,
          viewport: globalThis.innerWidth,
          readingWidth: reading.getBoundingClientRect().width,
          proseWidth: prose.getBoundingClientRect().width,
          titleSize: globalThis.getComputedStyle(title).fontSize,
          proseSize: globalThis.getComputedStyle(prose).fontSize,
          proseLineHeight: globalThis.getComputedStyle(prose).lineHeight,
          coverHeight: cover.getBoundingClientRect().height,
          coverFit: coverStyle.objectFit,
          coverPosition: coverStyle.objectPosition,
          coverBackground: coverStyle.backgroundColor,
        };
      });
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.readingWidth).toBeLessThanOrEqual(960);
      expect(geometry.proseWidth).toBeLessThanOrEqual(740);
      expect(geometry.coverFit).toBe('contain');
      expect(geometry.coverPosition).toBe('50% 50%');
      expect(geometry.coverBackground).toBe('rgba(0, 0, 0, 0)');
      expect(geometry.coverHeight).toBeLessThanOrEqual(width > 768 ? 420 : 360);
      expect(geometry.titleSize).toBe(width > 768 ? '42px' : '31px');
      expect(geometry.proseSize).toBe(width > 768 ? '17px' : '16px');
      expect(geometry.proseLineHeight).toBe(width > 768 ? '29.24px' : '26.4px');
      const headingGaps = await page
        .locator('.article-heading')
        .evaluate((heading) => {
          const boxes = [...heading.children].map((element) =>
            element.getBoundingClientRect(),
          );
          return boxes
            .slice(1)
            .map((box, index) => box.top - boxes[index].bottom);
        });
      for (const [index, gap] of [
        20,
        10,
        width > 768 ? 17 : 12,
        width > 768 ? 22 : 18,
      ].entries()) {
        expect(headingGaps[index]).toBeCloseTo(gap, 1);
      }
      await page.screenshot({
        path: path.join(
          projectRoot,
          'docs/agent-work/cycle-05/screenshots',
          `article-${size}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
  }
});

test('wide code and tables scroll locally without hiding page overflow', async ({
  page,
}) => {
  for (const width of [320, 360, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixtureBaseURL}/posts/wide-content/`);
    await expect(page.locator('.prose pre code').first()).toHaveCSS(
      'font-size',
      width > 768 ? '14px' : '12px',
    );
    const widths = await page.evaluate(() => ({
      viewport: globalThis.innerWidth,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      bodyOverflow: globalThis.getComputedStyle(globalThis.document.body)
        .overflowX,
    }));
    expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewport);
    expect(widths.bodyOverflow).not.toBe('hidden');
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${fixtureBaseURL}/posts/wide-content/`);
  for (const selector of ['.prose pre', '.prose table']) {
    const state = await page.locator(selector).evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: globalThis.getComputedStyle(element).overflowX,
    }));
    expect(state.scrollWidth).toBeGreaterThan(state.clientWidth);
    expect(state.overflowX).toBe('auto');
    await page.locator(selector).focus();
    await expect(page.locator(selector)).toBeFocused();
    for (let index = 0; index < 8; index += 1)
      await page.keyboard.press('ArrowRight');
    expect(
      await page.locator(selector).evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
  }
});

test('long title, tag, and summary wrap inside a 320px article header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${fixtureBaseURL}/posts/long-header/`);
  const geometry = await page.evaluate(() => {
    const selectors = [
      '.article-heading h1',
      '.article-heading .post-tag',
      '.article-heading .dek',
    ];
    return {
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewport: globalThis.innerWidth,
      boxes: selectors.map((selector) => {
        const element = globalThis.document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          scrollWidth: element.scrollWidth,
        };
      }),
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  for (const box of geometry.boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(geometry.viewport);
    expect(box.scrollWidth).toBeLessThanOrEqual(Math.ceil(box.width));
  }
});

test('horizontal raster and vertical cover remain complete and centered', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [slug, aspectRatio] of [
    ['horizontal-cover', 3 / 2],
    ['vertical-cover', 420 / 1100],
  ]) {
    await page.goto(`${fixtureBaseURL}/posts/${slug}/`);
    const image = page.locator('[data-article-cover]');
    await expect(image).toHaveJSProperty('complete', true);
    const state = await image.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        width: element.getAttribute('width'),
        height: element.getAttribute('height'),
        fit: style.objectFit,
        position: style.objectPosition,
        boxHeight: box.height,
      };
    });
    expect(state.naturalWidth).toBeGreaterThan(0);
    expect(state.naturalHeight).toBeGreaterThan(0);
    expect(state.naturalWidth / state.naturalHeight).toBeCloseTo(
      aspectRatio,
      2,
    );
    expect(state.fit).toBe('contain');
    expect(state.position).toBe('50% 50%');
    expect(state.boxHeight).toBeLessThanOrEqual(420);
    if (slug === 'horizontal-cover') {
      expect(state.width).toBe('300');
      expect(state.height).toBe('200');
    }
  }
});

test('heading, link, footnote, and optional content remain keyboard readable', async ({
  page,
  browser,
}) => {
  await page.goto(`${fixtureBaseURL}/posts/wide-content/`);
  await page.locator('.footnote-ref').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#fn:/);
  await expect(page.locator('.footnotes li').first()).toBeVisible();

  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  await expect(noScriptPage.locator('[data-article-body]')).toContainText(
    '从一个具体的问题开始',
  );
  await expect(noScriptPage.locator('[data-article-back]')).toHaveAttribute(
    'href',
    '/posts/',
  );
  await expect(noScriptPage.locator('.post-tag')).toHaveCount(2);
  await noScript.close();
});

test('failed title image keeps alt text and never blocks the article body', async ({
  page,
}) => {
  await page.route('**/cover-wide.svg', (route) => route.abort());
  await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  await expect(page.locator('[data-article-cover]')).toHaveAttribute(
    'alt',
    '横向山谷标题图',
  );
  await expect(page.locator('[data-article-body]')).toContainText(
    '从一个具体的问题开始',
  );
  expect(
    await page
      .locator('[data-article-cover]')
      .evaluate((image) => image.complete && image.naturalWidth === 0),
  ).toBe(true);
});

test('article content has no automated accessibility violations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${fixtureBaseURL}/posts/wide-content/`);
  const axeSource = await readFile(
    path.join(projectRoot, 'node_modules/axe-core/axe.min.js'),
    'utf8',
  );
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    return result.violations;
  });
  expect(violations).toEqual([]);
});
