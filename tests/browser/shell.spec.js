/** Browser coverage for the global shell, theme menu, navigation, and footer. */

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';

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

test('theme menu persists manual choices and system mode follows media changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const trigger = page.locator('[data-theme-trigger]');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger.click();
  await page.getByRole('menuitemradio', { name: '浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'light',
  );
  await expect(trigger).toHaveAttribute('aria-label', '主题：浅色，当前浅色');
  expect(await page.evaluate(() => localStorage.getItem('bugu-theme'))).toBe(
    'light',
  );

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await trigger.click();
  await page.getByRole('menuitemradio', { name: '跟随系统' }).click();
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
    await page.getByRole('menuitemradio', { name: '深色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { name: '最新文章' })).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('theme menu supports radio keyboard navigation, Escape, and natural Tab exit', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.locator('[data-theme-trigger]');
  const menu = page.getByRole('menu');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitemradio', { name: '跟随系统' }),
  ).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitemradio', { name: '深色' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitemradio', { name: '浅色' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(menu).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-mode',
    'light',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(
    page.getByRole('menuitemradio', { name: '跟随系统' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();

  await trigger.click();
  await page.getByRole('heading', { name: '最新文章' }).click();
  await expect(menu).toBeHidden();

  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toBeHidden();
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
            '.brand, .header nav > a, [data-theme-trigger], .footer a',
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
    await page.locator('[data-theme-trigger]').click();
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
  await expect(page.getByRole('menu')).toBeVisible();
});

test('configuration hides unresolved pages and unsafe social links', async () => {
  const fixtureDefinition = JSON.parse(
    await readFile(
      path.join(projectRoot, 'tests/fixtures/boundaries/site.json'),
      'utf8',
    ),
  );
  const config = `${await readFile(path.join(projectRoot, 'hugo.toml'), 'utf8')}
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
