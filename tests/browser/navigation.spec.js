/** Real Hugo navigation regression coverage using the existing preview. */
import { test, expect } from '@playwright/test';

// Match the example site's canonical origin, including original image URLs.
test.use({ baseURL: 'http://localhost:4173' });

/** Wait for the navigation controller and capture persistent DOM identity. @param {import('@playwright/test').Page} page - Browser page. @returns {Promise<void>} Completion. */
async function start(page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute(
    'data-navigation',
    'ready',
  );
  await page.evaluate(() => {
    globalThis.savedHeader = globalThis.document.querySelector('[data-header]');
  });
}

/** Assert a completed partial navigation retained the original header. @param {import('@playwright/test').Page} page - Browser page. @returns {Promise<void>} Completion. */
async function retained(page) {
  await expect(page.locator('[data-navigation-progress]')).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        globalThis.savedHeader ===
        globalThis.document.querySelector('[data-header]'),
    ),
  ).toBe(true);
  await expect(page.locator('main')).toHaveCSS('animation-name', 'none');
}

test('header and theme persist through article, back, about and friends with current metadata', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await page.locator('[data-theme-trigger]').click();
  const theme = await page.locator('html').getAttribute('data-theme');
  const article = page.locator('[data-post-title]').first();
  const url = await article.getAttribute('href');
  await article.click();
  await expect(page).toHaveURL(url);
  await retained(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    new RegExp(url),
  );
  expect(await page.title()).toContain(await page.locator('h1').textContent());
  await page.locator('[data-article-back]').click();
  await expect(page).toHaveURL('/');
  await retained(page);
  for (const route of ['about', 'friends']) {
    await page.locator(`[data-header] a[href="/${route}/"]`).click();
    await expect(page).toHaveURL(`/${route}/`);
    await retained(page);
    await expect(page.locator('[data-header]')).not.toHaveClass(
      /header-overlay/,
    );
  }
  await page.goBack();
  await expect(page).toHaveURL('/about/');
  await retained(page);
  await page.goForward();
  await expect(page).toHaveURL('/friends/');
  await retained(page);
  expect(errors).toEqual([]);
});

test('slow navigation preserves old content and displays progress; latest click wins', async ({
  page,
}) => {
  await start(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/about/', async (route) => {
    await gate;
    await route.continue();
  });
  await page.locator('[data-header] a[href="/about/"]').click();
  await expect(page.locator('[data-navigation-progress]')).toBeVisible();
  await expect(page.locator('#latest-title')).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  await page.locator('[data-header] a[href="/friends/"]').click();
  await expect(page).toHaveURL('/friends/');
  release();
  await retained(page);
  await expect(page).toHaveURL('/friends/');
});

for (const failure of ['network', 'build', 'non-html', '404']) {
  test(`${failure} response falls back to a real document navigation`, async ({
    page,
  }) => {
    await start(page);
    await page.route('**/about/', async (route) => {
      if (route.request().isNavigationRequest()) {
        await route.continue();
        return;
      }
      if (failure === 'network') await route.abort();
      else if (failure === 'build') {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replace(
            /name="?night-build"? content="[^"]+"/,
            'name="night-build" content="new-build"',
          ),
        });
      } else
        await route.fulfill({
          status: failure === '404' ? 404 : 200,
          contentType: 'text/plain',
          body: 'Unavailable',
        });
    });
    await page.locator('[data-header] a[href="/about/"]').click();
    await expect(page).toHaveURL('/about/');
    await expect(page.locator('html')).toHaveAttribute(
      'data-navigation',
      'ready',
    );
    expect(await page.evaluate(() => globalThis.savedHeader)).toBeUndefined();
    await expect(page.locator('main h1')).toBeVisible();
  });
}

test('search result closes persistent modal and remains usable after navigation', async ({
  page,
}) => {
  await start(page);
  await page.locator('[data-search-trigger]').click();
  await page.locator('[data-search-input]').fill('手记');
  const result = page.locator('[data-search-results] a').first();
  await expect(result).toBeVisible();
  await result.click();
  await retained(page);
  await expect(page.locator('[data-search-dialog]')).not.toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await page.locator('[data-search-trigger]').click();
  await expect(page.locator('[data-search-input]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-search-dialog]')).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.document.activeElement.outerHTML),
    )
    .toContain('data-search-trigger');
});

test('reduced motion, keyboard card entry and repeated article enhancements survive navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  const card = page.locator('[data-card-enhanced]').first();
  const url = await card.getAttribute('data-post-url');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url);
  await retained(page);
  await expect(page.locator('[data-navigation-progress]')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await page.goBack();
  await expect(page).toHaveURL('/');
  await retained(page);
  await expect(page.locator('[data-card-enhanced]').first()).toBeFocused();
});

test('article hash navigation and traversal keep content and restore reading position', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await page.locator('a[href="/posts/vibecoding/"]').first().click();
  await expect(page).toHaveURL('/posts/vibecoding/');
  await retained(page);
  const heading = page.locator('.prose h2[id]').first();
  const id = await heading.getAttribute('id');
  await page.locator('[data-toc] a').first().click();
  await expect(page).toHaveURL(new RegExp(`#${encodeURIComponent(id)}$`, 'i'));
  const offset = await heading.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await page.locator('[data-header] a[href="/about/"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/about/');
  await retained(page);
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(`/posts/vibecoding/#${encodeURIComponent(id)}$`, 'i'),
  );
  await retained(page);
  expect(
    await heading.evaluate((node) => node.getBoundingClientRect().top),
  ).toBeCloseTo(offset, 0);
  await page.goBack();
  await expect(page).toHaveURL('/posts/vibecoding/');
  await retained(page);
});

for (const theme of ['light', 'dark']) {
  test(`partial pages match direct Hugo layout across viewports in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await start(page);
    for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      await page.locator('a[href="/posts/vibecoding/"]').first().click();
      await retained(page);
      await expect(page.locator('[data-toc]')).toHaveCount(1);
      const soft = await page.locator('main').boundingBox();
      expect(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      ).toBe(true);
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(`article-${theme}-${width}.png`),
          fullPage: true,
        });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute(
        'data-navigation',
        'ready',
      );
      const direct = await page.locator('main').boundingBox();
      expect(soft.x).toBeCloseTo(direct.x, 0);
      expect(soft.width).toBeCloseTo(direct.width, 0);
      await page.evaluate(() => {
        globalThis.savedHeader =
          globalThis.document.querySelector('[data-header]');
      });
      await page.locator('[data-header] .brand').click();
      await retained(page);
      expect(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      ).toBe(true);
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(`home-${theme}-${width}.png`),
          fullPage: true,
        });
    }
  });
}

test('page media and references reinitialize cleanly after repeated partial visits', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  for (let visit = 0; visit < 2; visit += 1) {
    await page.locator('a[href="/posts/gallery-walk/"]').first().click();
    await retained(page);
    await expect(page.locator('[data-photo-counter]')).toHaveText('1 / 4');
    await page.locator('[data-photo-stack]').focus();
    await page.locator('[data-photo-next]').click();
    await expect(page.locator('[data-photo-counter]')).toHaveText('2 / 4');
    await page.locator('[data-article-back]').click();
    await expect(page).toHaveURL('/');
    await retained(page);
    await page.locator('a[href="/posts/engineering-notes/"]').first().click();
    await retained(page);
    await page.locator('[data-reference]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-reference]').first().hover();
    await expect(page.locator('.popover')).toBeVisible();
    await page.locator('[data-article-back]').click();
    await expect(page).toHaveURL('/');
    await retained(page);
    await expect(page.locator('.popover')).toHaveCount(0);
    await page.locator('a[href="/posts/vibecoding/"]').first().click();
    await retained(page);
    await page.locator('a[data-lightbox]').first().click();
    await expect(page.locator('[data-lightbox-dialog]')).toBeVisible();
    await expect(
      page.locator('[data-lightbox-dialog] [data-lightbox-content] img'),
    ).toHaveAttribute('src', /\.webp$/);
    await expect(page.locator('[data-lightbox-original]')).toHaveAttribute(
      'href',
      /\.(png|jpg)$/,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
    await page.locator('[data-article-back]').click();
    await expect(page).toHaveURL('/');
    await retained(page);
  }
});

/**
 * Assert the card's first frame sits on the trigger's painted area.
 * @param {{x: number, y: number, width: number, height: number}} start - Preview box at the flight's first frame.
 * @param {{x: number, y: number, width: number, height: number}} source - Trigger image box.
 * @param {{x: number, y: number, width: number, height: number}} target - Preview box at rest.
 * @param {boolean} exactSize - Also compare the start size against the trigger box.
 * @returns {void} Completion.
 */
function expectFlightStart(start, source, target, exactSize) {
  expect(start.width).toBeLessThan(target.width);
  expect(
    Math.abs(start.x + start.width / 2 - (source.x + source.width / 2)),
  ).toBeLessThan(1.5);
  expect(
    Math.abs(start.y + start.height / 2 - (source.y + source.height / 2)),
  ).toBeLessThan(1.5);
  if (!exactSize) return;
  expect(start.width).toBeLessThanOrEqual(source.width + 0.5);
  expect(start.height).toBeLessThanOrEqual(source.height + 0.5);
  expect(
    Math.min(
      Math.abs(start.width - source.width),
      Math.abs(start.height - source.height),
    ),
  ).toBeLessThan(0.5);
}

/** Read how the lightbox card is currently painted. @param {import('@playwright/test').Page} page - Browser page. @returns {Promise<{background: string, opening: boolean, flying: boolean}>} Computed card colour and open markers. */
async function cardState(page) {
  return page.evaluate(() => {
    const dialog = globalThis.document.querySelector('[data-lightbox-dialog]');
    return {
      background: globalThis.getComputedStyle(dialog).backgroundColor,
      opening: dialog.hasAttribute('data-lightbox-opening'),
      flying: dialog.hasAttribute('data-lightbox-flying'),
    };
  });
}

/** Resolve the card colour the lightbox settles on. @param {import('@playwright/test').Page} page - Browser page. @returns {Promise<string>} Computed colour of the `--bg` token. */
async function settledCardColor(page) {
  return page.evaluate(() => {
    const probe = globalThis.document.createElement('div');
    probe.style.background = 'var(--bg)';
    globalThis.document.body.append(probe);
    const color = globalThis.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

test('image lightbox flies the card out of its trigger and skips the flight when reduced', async ({
  page,
}) => {
  const triggers = [
    ['/posts/vibecoding/', page.locator('a[data-lightbox]').first(), true],
    ['/posts/vibecoding/', page.locator('a[data-lightbox]').nth(1), true],
    ['/posts/blender-mesh/', page.locator('a[data-lightbox]').first(), true],
    [
      '/posts/gallery-walk/',
      page.locator('.photo-stack a[data-lightbox]').first(),
      false,
    ],
  ];
  let cardColor = '';
  for (const [url, trigger, exactSize] of triggers) {
    await page.goto(url);
    cardColor ||= await settledCardColor(page);
    const flying = page.waitForFunction(() =>
      globalThis.document
        .querySelector('[data-lightbox-dialog]')
        .hasAttribute('data-lightbox-flying'),
    );
    await trigger.click();
    await flying;
    const flight = await page.evaluate(() => {
      const dialog = globalThis.document.querySelector(
        '[data-lightbox-dialog]',
      );
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const preview = dialog.querySelector('[data-lightbox-content] img');
      const animation = dialog
        .getAnimations()
        .find((item) => item.constructor.name === 'Animation');
      animation.pause();
      animation.currentTime = 0;
      const start = rect(preview);
      animation.currentTime = 320;
      const landed = rect(preview);
      animation.currentTime = 0;
      return {
        keyframes: animation.effect
          .getKeyframes()
          .map(({ transform }) => transform ?? null),
        background: globalThis.getComputedStyle(dialog).backgroundColor,
        start,
        landed,
      };
    });
    expect(flight.keyframes, url).toHaveLength(2);
    expect(flight.keyframes[1]).toBeNull();
    expect(flight.background, url).toBe(cardColor);
    expect(await cardState(page), url).toEqual({
      background: cardColor,
      opening: false,
      flying: true,
    });
    for (const selector of [
      '[data-dialog-close]',
      '[data-lightbox-caption]',
      '[data-lightbox-original]',
    ]) {
      await expect(
        page.locator(`[data-lightbox-dialog] ${selector}`),
      ).toHaveCSS('opacity', '0');
    }
    expectFlightStart(
      flight.start,
      await trigger.locator('img').boundingBox(),
      flight.landed,
      exactSize,
    );
    await page.evaluate(() => {
      globalThis.document
        .querySelector('[data-lightbox-dialog]')
        .getAnimations()
        .find((item) => item.constructor.name === 'Animation')
        .play();
    });
    await expect(
      page.locator('[data-lightbox-dialog] [data-dialog-close]'),
    ).toHaveCSS('opacity', '1');
    await expect
      .poll(async () => cardState(page))
      .toEqual({
        background: cardColor,
        opening: false,
        flying: false,
      });
    expect(
      await page.evaluate(
        () =>
          globalThis.getComputedStyle(
            globalThis.document.querySelector('[data-lightbox-dialog]'),
          ).transform,
      ),
      url,
    ).toBe('none');
    const landed = await page
      .locator('[data-lightbox-dialog] [data-lightbox-content] img')
      .boundingBox();
    expect(Math.abs(landed.x - flight.landed.x), url).toBeLessThan(1);
    expect(Math.abs(landed.y - flight.landed.y), url).toBeLessThan(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
  }

  // The loading phase keeps the card out of the way and its controls readable.
  await page.goto(triggers[0][0]);
  expect(
    await page.evaluate(() => {
      const dialog = globalThis.document.querySelector(
        '[data-lightbox-dialog]',
      );
      globalThis.document.querySelector('a[data-lightbox]').click();
      return {
        background: globalThis.getComputedStyle(dialog).backgroundColor,
        opening: dialog.hasAttribute('data-lightbox-opening'),
        flying: dialog.hasAttribute('data-lightbox-flying'),
      };
    }),
  ).toEqual({ background: 'rgba(0, 0, 0, 0)', opening: true, flying: false });
  await expect(
    page.locator('[data-lightbox-dialog] [data-dialog-close]'),
  ).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();

  // Reduced motion: no flight, the card and its controls are ready at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(triggers[0][0]);
  await triggers[0][1].click();
  await expect(page.locator('[data-lightbox-dialog]')).toBeVisible();
  await page.waitForFunction(() => {
    const image = globalThis.document.querySelector(
      '[data-lightbox-dialog] img',
    );
    return Boolean(image?.complete && image.naturalWidth);
  });
  await expect
    .poll(async () => cardState(page))
    .toEqual({
      background: cardColor,
      opening: false,
      flying: false,
    });
  await expect(
    page.locator('[data-lightbox-dialog] [data-dialog-close]'),
  ).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(() => ({
      dialog: globalThis.document
        .querySelector('[data-lightbox-dialog]')
        .getAnimations().length,
      image: globalThis.document
        .querySelector('[data-lightbox-dialog] img')
        .getAnimations().length,
    })),
  ).toEqual({ dialog: 0, image: 0 });
});
