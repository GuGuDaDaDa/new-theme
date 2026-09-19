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
        '最后一段藏着一个 {{< spoiler >}}被黑色方块遮住的答案{{< /spoiler >}}，先自己猜一猜。',
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
    path.join(projectRoot, 'exampleSite/content/posts/post-3/bryce-canyon.jpg'),
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
      // Firefox quantizes layout to 1/60px.
      expect(
        Math.abs(
          Number.parseFloat(geometry.proseLineHeight) -
            (width > 768 ? 28.9 : 26.4),
        ),
      ).toBeLessThan(0.02);
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

test('article footer and navigation keep the reading column and stack on mobile', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const screenshotDir = path.join(
    projectRoot,
    'docs/agent-work/article-footer/screenshots',
  );
  await mkdir(screenshotDir, { recursive: true });
  for (const [width, height, size] of [
    [1440, 1000, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
      await setTheme(page, theme);
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const element = globalThis.document.querySelector(selector);
          return element ? element.getBoundingClientRect() : null;
        };
        const nav = globalThis.document.querySelector('.article-nav');
        const item = nav.querySelector('.article-nav-item');
        const link = nav.querySelector('a');
        const prev = nav.querySelector('.prev').getBoundingClientRect();
        const next = nav.querySelector('.next').getBoundingClientRect();
        const navBox = nav.getBoundingClientRect();
        return {
          documentWidth: globalThis.document.documentElement.scrollWidth,
          viewport: globalThis.innerWidth,
          prose: box('.prose'),
          footer: box('.article-footer'),
          nav: navBox,
          navOverflow: nav.scrollWidth - nav.clientWidth,
          linkHeight: link.getBoundingClientRect().height,
          borderColor: globalThis.getComputedStyle(item).borderTopColor,
          prevRight: prev.right,
          prevBottom: prev.bottom,
          nextLeft: next.left,
          nextTop: next.top,
        };
      });
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.navOverflow).toBeLessThanOrEqual(0);
      expect(geometry.footer.width).toBeCloseTo(geometry.prose.width, 1);
      expect(geometry.nav.width).toBeCloseTo(geometry.prose.width, 1);
      expect(geometry.footer.left).toBeCloseTo(geometry.prose.left, 1);
      expect(geometry.nav.left).toBeCloseTo(geometry.prose.left, 1);
      expect(geometry.linkHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.borderColor).not.toBe('rgba(0, 0, 0, 0)');
      if (width > 768)
        expect(geometry.prevRight).toBeLessThanOrEqual(geometry.nextLeft);
      else expect(geometry.prevBottom).toBeLessThanOrEqual(geometry.nextTop);
      await page.screenshot({
        path: path.join(screenshotDir, `article-footer-${size}-${theme}.png`),
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${fixtureBaseURL}/posts/long-header/`);
  const narrow = await page.evaluate(() => {
    const nav = globalThis.document.querySelector('.article-nav');
    const title = nav.querySelector('.article-nav-title');
    return {
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewport: globalThis.innerWidth,
      navOverflow: nav.scrollWidth - nav.clientWidth,
      titleInsideCard:
        title.getBoundingClientRect().right <=
        title.closest('.article-nav-item').getBoundingClientRect().right,
    };
  });
  expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.viewport);
  expect(narrow.navOverflow).toBeLessThanOrEqual(0);
  expect(narrow.titleInsideCard).toBe(true);
});

test('spoiler text stays covered until hover, click, tap, or keyboard activation', async ({
  page,
  browser,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  const spoiler = page.locator('.spoiler');
  await expect(spoiler).toHaveAttribute('role', 'button');
  await expect(spoiler).toHaveAttribute('tabindex', '0');
  await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
  await expect(spoiler).not.toHaveAttribute('data-spoiler-state', /.+/);
  const styles = await spoiler.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      cursor: style.cursor,
    };
  });
  expect(styles.background).toBe('rgb(13, 17, 23)');
  expect(styles.color).toBe('rgba(0, 0, 0, 0)');
  expect(styles.cursor).toBe('pointer');

  // A fine pointer reveals the text only while it hovers the cover.
  await spoiler.hover();
  await expect(spoiler).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(spoiler).toHaveCSS('color', 'rgb(37, 43, 52)');
  await page.mouse.move(0, 0);
  await expect(spoiler).toHaveCSS('background-color', 'rgb(13, 17, 23)');

  // Clicking pins the revealed state and pins the covered state back.
  await spoiler.click();
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'shown');
  await expect(spoiler).toHaveAttribute('aria-expanded', 'true');
  await expect(spoiler).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await spoiler.click();
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'hidden');
  await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
  // The explicit hide wins over the pointer that is still over the cover.
  await expect(spoiler).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await spoiler.click();
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'shown');

  // Keyboard users reveal and hide with Enter and Space.
  await page.reload();
  await spoiler.focus();
  await page.keyboard.press('Enter');
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'shown');
  await page.keyboard.press(' ');
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'hidden');
  await page.keyboard.press('Enter');
  await expect(spoiler).toHaveAttribute('data-spoiler-state', 'shown');

  // Touch devices have no hover, so a tap is the only reveal.
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: browserName !== 'firefox',
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  const touchSpoiler = touchPage.locator('.spoiler');
  expect(
    await touchPage.evaluate(
      () => globalThis.matchMedia('(hover: hover)').matches,
    ),
  ).toBe(false);
  await expect(touchSpoiler).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await touchSpoiler.tap();
  await expect(touchSpoiler).toHaveAttribute('aria-expanded', 'true');
  await expect(touchSpoiler).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await touchSpoiler.tap();
  await expect(touchSpoiler).toHaveAttribute('aria-expanded', 'false');
  await expect(touchSpoiler).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await touchContext.close();

  // Without scripting the text must stay readable instead of covered forever.
  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
  });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  const noScriptStyles = await noScriptPage
    .locator('.spoiler')
    .evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
  expect(noScriptStyles).toEqual({
    background: 'rgba(0, 0, 0, 0)',
    color: 'rgb(37, 43, 52)',
  });
  await noScriptContext.close();
});

test('spoiler cover keeps the reading column in both themes and viewports', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const screenshotDir = path.join(
    projectRoot,
    'docs/agent-work/spoiler/screenshots',
  );
  await mkdir(screenshotDir, { recursive: true });
  for (const [width, height, size] of [
    [1440, 1000, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
      await setTheme(page, theme);
      const spoiler = page.locator('.spoiler');
      const geometry = await spoiler.evaluate((element) => ({
        documentWidth: globalThis.document.documentElement.scrollWidth,
        viewport: globalThis.innerWidth,
        coverHeight: element.getBoundingClientRect().height,
        paragraphHeight: element.closest('p').getBoundingClientRect().height,
        padding: globalThis.getComputedStyle(element).padding,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.coverHeight).toBeLessThan(geometry.paragraphHeight);
      expect(geometry.padding).toBe(width > 768 ? '1.7px 4.25px' : '1.6px 4px');
      await spoiler.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(screenshotDir, `spoiler-${size}-${theme}.png`),
        fullPage: true,
      });
      if (size !== 'desktop' || theme !== 'light') continue;
      await spoiler.hover();
      await expect(spoiler).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await spoiler
        .locator('xpath=..')
        .screenshot({ path: path.join(screenshotDir, 'spoiler-revealed.png') });
    }
  }
});

test('AI notices keep the theme block shape, round controls, and both themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);

  const summary = page.locator('details.ai-summary');
  await expect(summary).not.toHaveAttribute('open', '');
  await expect(page.locator('.ai-summary-label')).toHaveText('AI 摘要');
  await expect(page.locator('.ai-warning-title')).toHaveText('透明声明');
  await expect(page.locator('.ai-warning-label')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const toggle = globalThis.document.querySelector('.ai-summary-toggle');
    const close = globalThis.document.querySelector('.ai-warning-close');
    const summaryLabel = globalThis.document.querySelector('.ai-summary-label');
    const card = globalThis.document.querySelector('.ai-summary');
    const warning = globalThis.document.querySelector('.ai-warning');
    const warningBody = warning.querySelector('.ai-warning-body');
    const warningTitle = warning.querySelector('.ai-warning-title');
    const warningIcon = warning.querySelector('.ai-warning-icon');
    const summaryHeader = card.querySelector('summary');
    const rowBoxes = [...summaryHeader.children].map((element) =>
      element.getBoundingClientRect(),
    );
    const cardStyle = globalThis.getComputedStyle(card);
    return {
      toggleRadius: globalThis.getComputedStyle(toggle).borderRadius,
      closeRadius: globalThis.getComputedStyle(close).borderRadius,
      cardRadius: cardStyle.borderRadius,
      warningRadius: globalThis.getComputedStyle(warning).borderRadius,
      labelSize: globalThis.getComputedStyle(summaryLabel).fontSize,
      labelSpacing: globalThis.getComputedStyle(summaryLabel).letterSpacing,
      summaryContentSize: globalThis.getComputedStyle(
        globalThis.document.querySelector('.ai-summary-content'),
      ).fontSize,
      warningSize: globalThis.getComputedStyle(warning).fontSize,
      warningDisplay: globalThis.getComputedStyle(warning).display,
      cardBackground: cardStyle.backgroundColor,
      cardBorderWidth: cardStyle.borderTopWidth,
      headerHeight: summaryHeader.getBoundingClientRect().height,
      rowHeight:
        Math.max(...rowBoxes.map((box) => box.bottom)) -
        Math.min(...rowBoxes.map((box) => box.top)),
      warningHeight: warning.getBoundingClientRect().height,
      warningBodyHeight: warningBody.getBoundingClientRect().height,
      titleIconDelta: Math.abs(
        (warningTitle.getBoundingClientRect().top +
          warningTitle.getBoundingClientRect().bottom) /
          2 -
          (warningIcon.getBoundingClientRect().top +
            warningIcon.getBoundingClientRect().bottom) /
            2,
      ),
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewport: globalThis.innerWidth,
    };
  });
  expect(geometry.toggleRadius).toBe('50%');
  expect(geometry.closeRadius).toBe('50%');
  expect(geometry.cardRadius).toBe('2px');
  expect(geometry.warningRadius).toBe('2px');
  expect(geometry.labelSize).toBe('11px');
  expect(geometry.labelSpacing).toBe('0.88px');
  expect(geometry.summaryContentSize).toBe('13px');
  expect(geometry.warningSize).toBe('12px');
  expect(geometry.warningDisplay).toBe('flex');
  expect(geometry.cardBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(geometry.cardBorderWidth).toBe('1px');
  expect(geometry.rowHeight).toBeLessThan(30);
  expect(geometry.headerHeight).toBeGreaterThan(geometry.rowHeight);
  expect(geometry.warningHeight).toBeLessThanOrEqual(60);
  expect(geometry.warningBodyHeight).toBeCloseTo(32, 0);
  expect(geometry.titleIconDelta).toBeLessThan(4);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);

  const chevronStyle = () =>
    page
      .locator('.ai-summary-toggle')
      .evaluate((element) =>
        globalThis
          .getComputedStyle(element, '::before')
          .transform.replace(/\s+/g, ' '),
      );
  const collapsedChevron = await chevronStyle();
  await summary.locator('summary').click();
  await expect(summary).toHaveAttribute('open', '');
  const expandedChevron = await chevronStyle();
  expect(expandedChevron).not.toBe(collapsedChevron);
  expect(expandedChevron).not.toBe('none');
  await summary.locator('summary').click();
  await expect(summary).not.toHaveAttribute('open', '');
  expect(await chevronStyle()).toBe(collapsedChevron);

  const lightBackground = geometry.cardBackground;
  await setTheme(page, 'dark');
  const darkBackground = await page
    .locator('.ai-summary')
    .evaluate(
      (element) => globalThis.getComputedStyle(element).backgroundColor,
    );
  expect(darkBackground).not.toBe(lightBackground);
  await setTheme(page, 'light');

  const closeButton = page.locator('.ai-warning-close');
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.locator('aside.ai-warning')).toBeHidden();
  await expect(page.locator('[data-article-body]')).toBeFocused();
  await page.reload();
  await expect(page.locator('aside.ai-warning')).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.keys(globalThis.localStorage),
  );
  expect(stored.filter((key) => /notice|ai/i.test(key))).toEqual([]);

  const axeSource = await readFile(
    path.join(projectRoot, 'node_modules/axe-core/axe.min.js'),
    'utf8',
  );
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(
      globalThis.document.querySelector('[data-article-body]'),
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
    );
    return result.violations;
  });
  expect(violations).toEqual([]);
});

test('AI notices preserve reading alignment across viewports and without scripting', async ({
  page,
  browser,
}) => {
  const screenshotDir = path.join(
    projectRoot,
    'docs/agent-work/ai-notices-redesign/screenshots',
  );
  await mkdir(screenshotDir, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height, size] of [
    [1440, 1000, 'desktop'],
    [390, 844, 'mobile'],
    [320, 844, '320'],
    [360, 844, '360'],
    [768, 1000, '768'],
    [1024, 1000, '1024'],
    [1920, 1000, '1920'],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
      await setTheme(page, theme);
      const summary = page.locator('details.ai-summary');
      await summary.screenshot({
        path: path.join(screenshotDir, `ai-collapsed-${size}-${theme}.png`),
      });
      await summary.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(summary).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(summary).not.toHaveAttribute('open', '');
      await summary.locator('summary').click();
      await expect(summary).toHaveAttribute('open', '');
      const alignment = await page.evaluate(() => {
        const label = globalThis.document.querySelector('.ai-summary-label');
        const paragraph = globalThis.document.querySelector(
          '.ai-summary-content p',
        );
        const warning = globalThis.document.querySelector('.ai-warning');
        const close = warning.querySelector('.ai-warning-close');
        const closeBox = close.getBoundingClientRect();
        const warningBox = warning.getBoundingClientRect();
        const warningCenter = (warningBox.top + warningBox.bottom) / 2;
        const centerDelta = (element) => {
          const box = element.getBoundingClientRect();
          return Math.abs((box.top + box.bottom) / 2 - warningCenter);
        };
        return {
          textDelta: Math.abs(
            label.getBoundingClientRect().left -
              paragraph.getBoundingClientRect().left,
          ),
          overflow:
            globalThis.document.documentElement.scrollWidth >
            globalThis.innerWidth,
          closeInside:
            closeBox.left - 6 >= warningBox.left &&
            closeBox.right + 6 <= warningBox.right &&
            closeBox.top - 6 >= warningBox.top &&
            closeBox.bottom + 6 <= warningBox.bottom,
          iconCenterDelta: centerDelta(
            warning.querySelector('.ai-warning-icon'),
          ),
          closeCenterDelta: centerDelta(close),
        };
      });
      expect(alignment.textDelta).toBeLessThan(1);
      expect(alignment.iconCenterDelta).toBeLessThan(1);
      expect(alignment.closeCenterDelta).toBeLessThan(1);
      expect(alignment.overflow).toBe(false);
      expect(alignment.closeInside).toBe(true);
      await page.locator('.ai-summary-content p').click();
      await page.mouse.move(0, 0);
      for (const [block, selector] of [
        ['summary', 'details.ai-summary'],
        ['warning', 'aside.ai-warning'],
      ]) {
        await page.locator(selector).screenshot({
          path: path.join(screenshotDir, `ai-${block}-${size}-${theme}.png`),
        });
      }
    }
  }

  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(`${fixtureBaseURL}/posts/complete-frontmatter/`);
  await noScriptPage.waitForLoadState('load');
  await expect(noScriptPage.locator('.ai-summary-label')).toHaveText('AI 摘要');
  await expect(noScriptPage.locator('.ai-warning-close')).toBeHidden();
  await expect(noScriptPage.locator('.ai-warning-body')).toContainText(
    '本文部分内容在 AI 辅助下完成',
  );
  await expect(noScriptPage.locator('.ai-warning-title')).toHaveText(
    '透明声明',
  );
  await expect(noScriptPage.locator('details.ai-summary')).not.toHaveAttribute(
    'open',
    '',
  );
  await noScriptPage.locator('.ai-summary summary').click();
  await expect(noScriptPage.locator('details.ai-summary')).toHaveAttribute(
    'open',
    '',
  );
  await noScriptContext.close();
});
