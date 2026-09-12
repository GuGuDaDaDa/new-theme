/** Browser coverage for the global shell, theme button, navigation, and footer. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import {
  buildBoundarySite,
  createBoundarySite,
  removeBoundarySite,
} from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';

const projectRoot = process.cwd();

/** Wait for scroll work queued through requestAnimationFrame. @param {import('@playwright/test').Page} page - Active page. @returns {Promise<void>} Completion. */
async function waitForScrollFrame(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
}

/** Calculate relative luminance for a six-digit hex color. @param {string} hex - CSS hex color. @returns {number} Relative luminance. */
function relativeLuminance(hex) {
  const normalized =
    hex.length === 4
      ? `#${[...hex.slice(1)].map((value) => value.repeat(2)).join('')}`
      : hex;
  const channels = normalized
    .slice(1)
    .match(/.{2}/g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Calculate WCAG contrast between two six-digit hex colors. @param {string} first - First CSS color. @param {string} second - Second CSS color. @returns {number} Contrast ratio. */
function contrastRatio(first, second) {
  const brighter = Math.max(
    relativeLuminance(first),
    relativeLuminance(second),
  );
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

test('head synchronously resolves first-paint theme modes without the main module', async ({
  browser,
}) => {
  const cases = [
    { stored: 'light', system: 'dark', mode: 'light', theme: 'light' },
    { stored: 'dark', system: 'light', mode: 'dark', theme: 'dark' },
    { stored: 'system', system: 'dark', mode: 'system', theme: 'dark' },
    { stored: 'unknown', system: 'dark', mode: 'system', theme: 'dark' },
  ];

  for (const item of cases) {
    const context = await browser.newContext({ colorScheme: item.system });
    const page = await context.newPage();
    await page.addInitScript((stored) => {
      localStorage.setItem('bugu-theme', stored);
    }, item.stored);
    await page.route('**/js/main-*.js', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme-mode',
      item.mode,
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      item.theme,
    );
    await expect(page.locator('html')).toHaveCSS('color-scheme', item.theme);
    await context.close();
  }
});

test('theme button cycles manual choices and system mode follows media changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const trigger = page.locator('[data-theme-trigger]');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger.click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'light',
  );
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '主题：浅色，当前浅色；点击切换为深色',
  );
  expect(await page.evaluate(() => localStorage.getItem('bugu-theme'))).toBe(
    'light',
  );

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await trigger.click();
  await trigger.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('storage failures do not interrupt current-page theme changes', async ({
  browser,
}) => {
  for (const failure of ['methods', 'getter']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (mode === 'getter') {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          /** Simulate denied browser storage access. */
          get() {
            throw new DOMException('storage disabled', 'SecurityError');
          },
        });
      } else {
        Storage.prototype.getItem = () => {
          throw new Error('storage disabled');
        };
        Storage.prototype.setItem = () => {
          throw new Error('storage disabled');
        };
      }
    }, failure);
    await page.goto('/');
    await page.locator('[data-theme-trigger]').click();
    await page.locator('[data-theme-trigger]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { name: '最新文章' })).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('theme button supports keyboard cycling and natural Tab exit', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.locator('[data-theme-trigger]');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'light',
  );
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'system',
  );
  await expect(trigger).not.toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('header uses the scroll threshold and remains visible during header interaction', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    globalThis.document.body.style.minHeight = '2400px';
  });
  const header = page.locator('[data-header]');

  await page.evaluate(() => globalThis.scrollTo(0, 300));
  await waitForScrollFrame(page);
  await expect(header).toHaveClass(/header-hidden/);
  await page.evaluate(() => globalThis.scrollTo(0, 296));
  await waitForScrollFrame(page);
  await expect(header).toHaveClass(/header-hidden/);
  await page.evaluate(() => globalThis.scrollTo(0, 293));
  await waitForScrollFrame(page);
  await expect(header).not.toHaveClass(/header-hidden/);

  await page
    .locator('[data-theme-trigger]')
    .evaluate((element) => element.focus({ preventScroll: true }));
  await page.evaluate(() => globalThis.scrollTo(0, 700));
  await waitForScrollFrame(page);
  await expect(header).not.toHaveClass(/header-hidden/);
});

test('no-JavaScript shell preserves content and real navigation while hiding theme controls', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '最新文章' })).toBeVisible();
  await expect(page.locator('[data-theme-control]')).toBeHidden();
  await expect(page.getByRole('button', { name: /主题/ })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'BuGuLog 首页' }),
  ).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: '跳到正文' })).toHaveAttribute(
    'href',
    '#main',
  );
  await page.getByRole('link', { name: '跳到正文' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await context.close();
});

test('supported widths and both themes keep full-width chrome, touch targets, and contrast', async ({
  page,
  browser,
}) => {
  const widths = [320, 360, 390, 768, 1024, 1440, 1920];
  await page.goto('/');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => localStorage.setItem('bugu-theme', value),
        theme,
      );
      await page.reload();
      const geometry = await page.evaluate(() => ({
        viewport: globalThis.innerWidth,
        pageWidth: globalThis.document.documentElement.scrollWidth,
        headerWidth: globalThis.document
          .querySelector('.header')
          .getBoundingClientRect().width,
        footerWidth: globalThis.document
          .querySelector('.footer')
          .getBoundingClientRect().width,
        targets: [
          ...globalThis.document.querySelectorAll(
            '.brand, .header nav > a, [data-theme-trigger]',
          ),
        ].map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      }));
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
      expect(Math.abs(geometry.headerWidth - geometry.viewport)).toBeLessThan(
        1,
      );
      expect(Math.abs(geometry.footerWidth - geometry.viewport)).toBeLessThan(
        1,
      );
      for (const target of geometry.targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      for (const link of await page.locator('.footer-links > a').all()) {
        await expect(link).toHaveCSS('padding', '0px');
        await expect(link).toHaveCSS('margin', '0px');
      }
      for (const link of await page.locator('.footer-bottom a').all()) {
        await expect(link).toHaveCSS('padding', '0px');
        await expect(link).toHaveCSS('margin-top', '0px');
        await expect(link).toHaveCSS('margin-bottom', '0px');
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const axeSource = await readFile(
    path.join(projectRoot, 'node_modules/axe-core/axe.min.js'),
    'utf8',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => localStorage.setItem('bugu-theme', value),
      theme,
    );
    await page.reload();
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const result = await globalThis.axe.run(globalThis.document, {
        runOnly: ['color-contrast'],
      });
      return result.violations;
    });
    expect(violations).toEqual([]);
    const colors = await page.evaluate(() => {
      const style = globalThis.getComputedStyle(
        globalThis.document.documentElement,
      );
      return {
        background: style.getPropertyValue('--bg').trim(),
        surface: style.getPropertyValue('--surface').trim(),
        focus: style.getPropertyValue('--focus').trim(),
      };
    });
    expect(
      contrastRatio(colors.focus, colors.background),
    ).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.focus, colors.surface)).toBeGreaterThanOrEqual(
      3,
    );
  }

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto('/');
  const touchTrigger = touchPage.locator('[data-theme-trigger]');
  await touchTrigger.tap();
  await touchTrigger.tap();
  await touchPage.waitForTimeout(500);
  await expect(touchTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await touchContext.close();
});

test('reduced motion and repeated pageshow retain a single usable enhancement', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.PageTransitionEvent('pageshow', { persisted: true }),
    );
    globalThis.dispatchEvent(
      new globalThis.PageTransitionEvent('pageshow', { persisted: true }),
    );
  });
  await expect(page.locator('.header')).toHaveCSS('transition-duration', '0s');
  await page.locator('[data-theme-trigger]').click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'light',
  );
});

test('first load plays the content entry animation and every opt-out keeps it still', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-entry', 'on');
  await expect(page.locator('main')).toHaveCSS('animation-name', 'night-entry');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('main')).toHaveCSS('animation-name', 'none');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() =>
    globalThis.sessionStorage.setItem('night:return', '{"entryId":"test"}'),
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-entry', 'restore');
  await expect(page.locator('main')).toHaveCSS('animation-name', 'none');
});

test('configuration hides unresolved pages and unsafe social links', async () => {
  const fixtureDefinition = JSON.parse(
    await readFile(
      path.join(projectRoot, 'tests/fixtures/boundaries/site.json'),
      'utf8',
    ),
  );
  const config = `${await readFile(path.join(projectRoot, 'exampleSite/hugo.toml'), 'utf8')}
[params.social]
github = 'javascript:alert(1)'
twitter = 'https://example.com/night-theme'
email = 'data:text/html,unsafe'
[[menus.main]]
name = '文章'
pageRef = '/posts'
weight = 30
`;
  const definition = {
    ...fixtureDefinition,
    content: fixtureDefinition.content.filter(
      (entry) =>
        !entry.path.startsWith('about/') && !entry.path.startsWith('friends/'),
    ),
    templates: [{ path: 'hugo.toml', source: config }],
  };
  const fixture = await buildBoundarySite({
    name: 'shell-config-spec',
    definition,
  });
  try {
    const html = await readFile(
      path.join(fixture.build.publicDir, 'index.html'),
      'utf8',
    );
    const $ = load(html);
    expect($('nav[aria-label="主导航"] > a')).toHaveLength(0);
    expect($('.search-open')).toHaveLength(0);
    expect($('.footer-bottom').text()).toContain('© 2026');
    expect(
      $('.footer-links a[href="https://example.com/night-theme"]'),
    ).toHaveLength(1);
    expect(
      $('.footer-links a').filter(
        (_, element) => $(element).text() === 'GitHub',
      ),
    ).toHaveLength(0);
    expect(
      $('.footer-links a').filter(
        (_, element) => $(element).text() === 'Email',
      ),
    ).toHaveLength(0);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('search dialog hides the automatic focus ring for pointer and touch opens', async ({
  page,
  browser,
}) => {
  const input = page.locator('[data-search-input]');
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('[data-search-trigger]');
  await expect(page.locator('html')).toHaveAttribute(
    'data-input-mode',
    'pointer',
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();

  await page.locator('[data-search-trigger]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute(
    'data-input-mode',
    'keyboard',
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS('outline-style', 'solid');
  await expect(input).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  try {
    await touchPage.goto('/');
    await touchPage.locator('[data-search-trigger]').tap();
    await expect(touchPage.locator('html')).toHaveAttribute(
      'data-input-mode',
      'pointer',
    );
    await expect(touchPage.locator('[data-search-input]')).toBeFocused();
    await expect(touchPage.locator('[data-search-input]')).toHaveCSS(
      'outline-style',
      'none',
    );
  } finally {
    await touchContext.close();
  }
});

test('logo markup keeps the styled size before the stylesheet arrives', async ({
  page,
}) => {
  // Simulate the slow-network first frame: no compiled stylesheet at all.
  await page.route('**/compiled*.css', (route) => route.abort());
  await page.goto('/');
  const brand = page.locator('.brand svg');
  await expect(brand).toHaveAttribute('width', '47');
  await expect(brand).toHaveAttribute('height', '47');
  await expect(brand).toHaveCSS('width', '47px');
  await expect(page.locator('.footer-brand svg')).toHaveCSS('width', '40px');

  // With the stylesheet applied the responsive rules still win.
  await page.unroute('**/compiled*.css');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(brand).toHaveCSS('width', '47px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(brand).toHaveCSS('width', '35px');
});

test('custom brand assets replace the built-in marks and keep the shell sizes', async ({
  browser,
}) => {
  const fixtureDefinition = JSON.parse(
    await readFile(
      path.join(projectRoot, 'tests/fixtures/boundaries/site.json'),
      'utf8',
    ),
  );
  const title = 'BuGuLog';
  const config = (
    await readFile(path.join(projectRoot, 'exampleSite/hugo.toml'), 'utf8')
  ).replace(
    '[params]',
    `[params]
logo = '/brand/logo.svg'
avatar = '/brand/avatar.jpg'
favicon = '/brand/favicon.png'`,
  );
  const definition = {
    ...fixtureDefinition,
    templates: [
      { path: 'hugo.toml', source: config },
      {
        path: 'static/brand/logo.svg',
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#355e85"/></svg>',
      },
      { path: 'static/brand/favicon.png', source: 'FAVICON' },
    ],
  };
  const fixture = await createBoundarySite({
    name: 'shell-brand-spec',
    definition,
  });
  let server;
  try {
    await cp(
      path.join(projectRoot, 'exampleSite/content/about/avatar.jpg'),
      path.join(fixture.projectRoot, 'static/brand/avatar.jpg'),
    );
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const directory = build.publicDir;
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };

    server = createServer(async (req, response) => {
      try {
        let file = path.resolve(directory, `.${req.url}`);
        if ((await stat(file)).isDirectory())
          file = path.join(file, 'index.html');
        const body = await readFile(file);
        response.writeHead(200, {
          'Content-Type':
            types[path.extname(file)] ?? 'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end('Not found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseURL = `http://127.0.0.1:${port}`;

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      await page.goto(baseURL);
      const brandImage = page.locator('.brand img');
      await expect(brandImage).toHaveCount(1);
      await expect(brandImage).toHaveAttribute('width', '47');
      await expect(brandImage).toHaveAttribute('height', '47');
      await expect(brandImage).toHaveAttribute('alt', '');
      await expect(brandImage).toHaveAttribute('src', /\/brand\/logo\.svg$/);
      await expect(page.locator('.brand svg')).toHaveCount(0);
      await expect(page.locator('.brand')).toHaveAttribute(
        'aria-label',
        new RegExp(title),
      );
      await expect(brandImage).toHaveCSS('width', '47px');
      await expect(brandImage).toHaveCSS('height', '47px');
      await expect(page.locator('.footer-brand img')).toHaveCSS(
        'width',
        '40px',
      );
      await expect(page.locator('.footer-brand img')).toHaveCSS(
        'height',
        '40px',
      );
      await expect(page.locator('.footer-brand svg')).toHaveCount(0);
      await expect(page.locator('.footer-brand > span')).toHaveText(title);
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        /\/brand\/favicon\.png$/,
      );
      expect(
        await page.locator('link[rel="icon"]').getAttribute('type'),
      ).toBeNull();

      await page.goto(`${baseURL}/about/`);
      const avatar = page.locator('.about-avatar');
      await expect(avatar).toHaveAttribute('src', /\/brand\/avatar\.jpg$/);
      await expect(avatar).toHaveCSS('width', '112px');
      await expect(avatar).toHaveCSS('height', '112px');

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.brand img')).toHaveCSS('width', '35px');
      await expect(avatar).toHaveCSS('width', '88px');

      await page.setViewportSize({ width: 360, height: 800 });
      await expect(page.locator('.brand img')).toHaveCSS('width', '30px');
    } finally {
      await context.close();
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await removeBoundarySite(fixture.projectRoot);
  }
});
