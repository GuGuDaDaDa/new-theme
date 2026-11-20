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
    await expect(page.locator('[data-lightbox-original]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
    await page.locator('[data-article-back]').click();
    await expect(page).toHaveURL('/');
    await retained(page);
  }
});

test('photo stack material surface stays neutral while the paper print stays white', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/posts/gallery-walk/');
  const wall = page.locator('.photo-stack.is-enhanced').first();
  const counter = page
    .locator('.photo-stack.is-enhanced .stack-counter')
    .first();
  await expect(wall).toBeVisible();

  await expect(wall).toHaveCSS('background-color', 'rgb(232, 232, 232)');
  await expect(page.locator('.photo-print').first()).toHaveCSS(
    'background-color',
    'rgb(250, 250, 250)',
  );
  await expect(counter).toHaveCSS('color', 'rgb(97, 97, 97)');

  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  await expect(wall).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await expect(page.locator('.photo-print').first()).toHaveCSS(
    'background-color',
    'rgb(245, 245, 245)',
  );
  await expect(counter).toHaveCSS('color', 'rgb(163, 163, 163)');
});

test('image lightbox uses a fullscreen dark canvas, explicit captions, smooth load transitions, and blank-space dismissal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const dialog = page.locator('#image-dialog[data-lightbox-dialog]');
  const preview = dialog.locator('[data-lightbox-content] > img');
  const caption = dialog.locator('[data-lightbox-caption]');
  const closeBtn = dialog.locator('[data-dialog-close]');

  // 1. Explicit caption post: fullscreen dark canvas stays identical in light and dark themes, sharp corners, no fly-in transform.
  await page.goto('/posts/vibecoding/');
  const captionedTrigger = page.locator('a[data-lightbox]').nth(1);
  await captionedTrigger.scrollIntoViewIfNeeded();
  await captionedTrigger.click();
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute('data-lightbox-ready', '');
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText('人机协同的持续闭环流');

  const lightCanvas = await page.evaluate(() => {
    const dlg = globalThis.document.querySelector('[data-lightbox-dialog]');
    const img = dlg.querySelector('[data-lightbox-content] > img');
    const dlgBox = dlg.getBoundingClientRect();
    const dlgStyle = globalThis.getComputedStyle(dlg);
    const imgStyle = globalThis.getComputedStyle(img);
    return {
      width: dlgBox.width,
      height: dlgBox.height,
      background: dlgStyle.backgroundColor,
      borderRadius: dlgStyle.borderRadius,
      transform: dlgStyle.transform,
      imgRadius: imgStyle.borderRadius,
      flying: dlg.hasAttribute('data-lightbox-flying'),
      opening: dlg.hasAttribute('data-lightbox-opening'),
    };
  });
  expect(lightCanvas.width).toBeCloseTo(1280, 0);
  expect(lightCanvas.height).toBeCloseTo(900, 0);
  expect(lightCanvas.background).toBe('rgba(10, 10, 10, 0.92)');
  expect(lightCanvas.borderRadius).toBe('0px');
  expect(lightCanvas.transform).toBe('none');
  expect(lightCanvas.imgRadius).toBe('0px');
  expect(lightCanvas.flying).toBe(false);
  expect(lightCanvas.opening).toBe(false);

  // Dark theme renders the exact same dark canvas background.
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  await expect(dialog).toHaveCSS('background-color', 'rgba(10, 10, 10, 0.92)');

  // Clicking the image itself or the caption text does NOT close the lightbox.
  await preview.click();
  await expect(dialog).toBeVisible();
  await caption.click();
  await expect(dialog).toBeVisible();

  // Clicking blank space around the image closes the lightbox immediately and restores focus to the trigger.
  await page.mouse.click(20, 450);
  await expect(dialog).not.toBeVisible();
  await expect(captionedTrigger).toBeFocused();

  // 2. Alt-only image (no explicit caption): caption stays hidden instead of falling back to img.alt.
  await page.goto('/posts/post-3/');
  const altOnlyTrigger = page.locator('a[data-lightbox]').first();
  await altOnlyTrigger.click();
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute('data-lightbox-ready', '');
  await expect(preview).toHaveAttribute('alt', 'Bryce Canyon National Park');
  await expect(caption).toBeHidden();
  await closeBtn.click();
  await expect(dialog).not.toBeVisible();
  await expect(altOnlyTrigger).toBeFocused();

  // 3. Slow network with decoded thumbnail: displays thumbnail immediately and swaps in full image without pending spinner.
  let releaseThumbUpgrade;
  const heldUpgrade = new Promise((resolve) => {
    releaseThumbUpgrade = resolve;
  });
  await page.goto('/posts/vibecoding/');
  await page.waitForFunction(() => {
    const img = globalThis.document.querySelector('a[data-lightbox] img');
    return Boolean(img?.complete && img.naturalWidth);
  });
  await page.route('**/posts/vibecoding/*.webp', async (route) => {
    await heldUpgrade;
    await route.continue();
  });
  await page.locator('a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  const loadingWithThumb = await page.evaluate(() => {
    const trigger = globalThis.document.querySelector('a[data-lightbox]');
    const thumb = trigger.querySelector('img');
    const dlg = globalThis.document.querySelector('[data-lightbox-dialog]');
    const img = dlg.querySelector('[data-lightbox-content] > img');
    return {
      loading: dlg.hasAttribute('data-lightbox-loading'),
      pending: dlg.hasAttribute('data-lightbox-pending'),
      thumbSrc: thumb.currentSrc || thumb.src,
      fullSrc: new URL(
        trigger.dataset.lightboxSrc || trigger.href,
        globalThis.location.href,
      ).href,
      previewSrc: img.src,
      ready: img.hasAttribute('data-lightbox-ready'),
    };
  });
  expect(loadingWithThumb.loading).toBe(true);
  expect(loadingWithThumb.pending).toBe(false);
  expect(loadingWithThumb.ready).toBe(true);
  expect(loadingWithThumb.previewSrc).toBe(loadingWithThumb.thumbSrc);

  releaseThumbUpgrade();
  await page.waitForFunction(() => {
    const dlg = globalThis.document.querySelector('[data-lightbox-dialog]');
    return !dlg.hasAttribute('data-lightbox-loading');
  });
  await expect(preview).toHaveJSProperty('src', loadingWithThumb.fullSrc);
  await page.unroute('**/posts/vibecoding/*.webp');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // 4. Slow network WITHOUT a decoded thumbnail: shows pending spinner until loaded, then marks ready and fades in.
  let releaseColdImage;
  const heldCold = new Promise((resolve) => {
    releaseColdImage = resolve;
  });
  await page.route('**/posts/vibecoding/flow*.webp', async (route) => {
    await heldCold;
    await route.continue();
  });
  await page.goto('/posts/vibecoding/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html[data-js="ready"]');
  const coldTrigger = page.locator('a[data-lightbox]').nth(1);
  await coldTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-lightbox-pending', '');
  await expect(preview).not.toHaveAttribute('data-lightbox-ready', '');
  releaseColdImage();
  await expect(preview).toHaveAttribute('data-lightbox-ready', '');
  await expect(dialog).not.toHaveAttribute('data-lightbox-pending', '');
  await expect(preview).toHaveCSS('opacity', '1');
  await page.unroute('**/posts/vibecoding/flow*.webp');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // 5. Image load failure without thumbnail shows failure message while keeping caption and close path working.
  await page.route('**/posts/vibecoding/flow*.webp', (route) => route.abort());
  await page.goto('/posts/vibecoding/');
  await page.locator('a[data-lightbox]').nth(1).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-lightbox-status]')).toHaveText(
    '图片加载失败，请稍后重试。',
  );
  await expect(caption).toHaveText('人机协同的持续闭环流');
  await page.mouse.click(20, 450);
  await expect(dialog).not.toBeVisible();
  await page.unroute('**/posts/vibecoding/flow*.webp');

  // 6. Reduced motion: zero animations on dialog and image.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/posts/vibecoding/');
  await page.locator('a[data-lightbox]').first().click();
  await expect(dialog).toBeVisible();
  await expect(preview).toHaveAttribute('data-lightbox-ready', '');
  expect(
    await page.evaluate(() => ({
      dialog: globalThis.document
        .querySelector('[data-lightbox-dialog]')
        .getAnimations().length,
      image: globalThis.document
        .querySelector('[data-lightbox-dialog] [data-lightbox-content] > img')
        .getAnimations().length,
    })),
  ).toEqual({ dialog: 0, image: 0 });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('image lightbox fits the preview and its caption inside fullscreen bounds without scrolling', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const viewports = [
    { width: 1280, height: 900 },
    { width: 1024, height: 700 },
    { width: 390, height: 844 },
  ];
  const shots = [
    '/posts/engineering-notes/',
    '/posts/gallery-walk/',
    '/posts/blender-mesh/',
    '/posts/vibecoding/',
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const url of shots) {
      await page.goto(url);
      await page.locator('a[data-lightbox]').first().click();
      await page.waitForFunction(() => {
        const dialog = globalThis.document.querySelector(
          '[data-lightbox-dialog]',
        );
        const image = dialog?.querySelector('[data-lightbox-content] > img');
        return Boolean(
          dialog?.open &&
          image?.hasAttribute('data-lightbox-ready') &&
          image.complete &&
          image.naturalWidth,
        );
      });
      const frame = await page.evaluate(() => {
        const dialog = globalThis.document.querySelector(
          '[data-lightbox-dialog]',
        );
        const topbar = dialog.querySelector('[data-lightbox-topbar]');
        const image = dialog.querySelector('[data-lightbox-content] > img');
        const caption = dialog.querySelector('[data-lightbox-caption]');
        const canvas = dialog.getBoundingClientRect();
        const topbarBox = topbar.getBoundingClientRect();
        const picture = image.getBoundingClientRect();
        const captionBox = caption.hidden
          ? null
          : caption.getBoundingClientRect();
        return {
          viewportWidth: globalThis.window.innerWidth,
          viewportHeight: globalThis.window.innerHeight,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          scrollHeight: dialog.scrollHeight,
          clientHeight: dialog.clientHeight,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          paintedWidth: picture.width,
          paintedHeight: picture.height,
          naturalRatio: image.naturalWidth / image.naturalHeight,
          paintedRatio: picture.width / picture.height,
          imgRadius: globalThis.getComputedStyle(image).borderRadius,
          belowTopbar: picture.top >= topbarBox.bottom - 1,
          aboveCaption: captionBox
            ? picture.bottom <= captionBox.top + 1
            : true,
          inside:
            picture.top >= canvas.top - 1 &&
            picture.bottom <= canvas.bottom + 1 &&
            picture.left >= canvas.left - 1 &&
            picture.right <= canvas.right + 1,
        };
      });
      const label = `${url} at ${viewport.width}x${viewport.height}`;
      expect(frame.canvasWidth, label).toBeCloseTo(frame.viewportWidth, 0);
      expect(frame.canvasHeight, label).toBeCloseTo(frame.viewportHeight, 0);
      expect(frame.scrollHeight, label).toBeLessThanOrEqual(
        frame.clientHeight + 1,
      );
      expect(frame.paintedRatio, label).toBeCloseTo(frame.naturalRatio, 2);
      expect(frame.paintedWidth, label).toBeLessThanOrEqual(
        frame.naturalWidth + 1,
      );
      expect(frame.paintedHeight, label).toBeLessThanOrEqual(
        frame.naturalHeight + 1,
      );
      expect(frame.imgRadius, label).toBe('0px');
      expect(frame.belowTopbar, label).toBe(true);
      expect(frame.aboveCaption, label).toBe(true);
      expect(frame.inside, label).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
    }
  }

  // Classic non-overlay scrollbar (e.g. Edge on Windows): locking scroll on open must not shift page layout, and fullscreen dialog spans edge-to-edge.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/posts/vibecoding/');
  await page.addStyleTag({
    content:
      'html:not(:has(dialog[open])) { overflow-y: scroll; scrollbar-gutter: stable; }',
  });
  const beforeOpen = await page.evaluate(() => {
    const prose = globalThis.document.querySelector('.prose');
    const brand = globalThis.document.querySelector('.brand');
    return {
      gap:
        globalThis.window.innerWidth -
        globalThis.document.documentElement.getBoundingClientRect().width,
      bodyWidth: globalThis.document.body.getBoundingClientRect().width,
      proseLeft: prose.getBoundingClientRect().left,
      brandLeft: brand.getBoundingClientRect().left,
    };
  });
  await page.locator('a[data-lightbox]').first().click();
  await expect(page.locator('[data-lightbox-dialog]')).toBeVisible();
  const duringOpen = await page.evaluate(() => {
    const prose = globalThis.document.querySelector('.prose');
    const brand = globalThis.document.querySelector('.brand');
    const dialog = globalThis.document.querySelector('[data-lightbox-dialog]');
    const canvas = dialog.getBoundingClientRect();
    return {
      scrollbarGapVar:
        globalThis.document.documentElement.style.getPropertyValue(
          '--scrollbar-gap',
        ),
      bodyWidth: globalThis.document.body.getBoundingClientRect().width,
      proseLeft: prose.getBoundingClientRect().left,
      brandLeft: brand.getBoundingClientRect().left,
      canvasLeft: canvas.left,
      canvasWidth: canvas.width,
      viewportWidth: globalThis.window.innerWidth,
    };
  });
  if (beforeOpen.gap > 0) {
    expect(duringOpen.scrollbarGapVar).toBe(`${beforeOpen.gap}px`);
  }
  expect(duringOpen.bodyWidth).toBeCloseTo(beforeOpen.bodyWidth, 1);
  expect(duringOpen.proseLeft).toBeCloseTo(beforeOpen.proseLeft, 1);
  expect(duringOpen.brandLeft).toBeCloseTo(beforeOpen.brandLeft, 1);
  expect(duringOpen.canvasLeft).toBeCloseTo(0, 1);
  expect(duringOpen.canvasWidth).toBeCloseTo(duringOpen.viewportWidth, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lightbox-dialog]')).not.toBeVisible();
  const afterClose = await page.evaluate(() => ({
    scrollbarGapVar:
      globalThis.document.documentElement.style.getPropertyValue(
        '--scrollbar-gap',
      ),
    bodyWidth: globalThis.document.body.getBoundingClientRect().width,
    proseLeft: globalThis.document
      .querySelector('.prose')
      .getBoundingClientRect().left,
  }));
  expect(afterClose.scrollbarGapVar).toBe('');
  expect(afterClose.bodyWidth).toBeCloseTo(beforeOpen.bodyWidth, 1);
  expect(afterClose.proseLeft).toBeCloseTo(beforeOpen.proseLeft, 1);
});

test('scripted content focus keeps no ring for keyboard navigation', async ({
  page,
}) => {
  await start(page);
  await page.locator('a[href="/about/"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/about/');
  await retained(page);
  const main = page.locator('#main');
  await expect(main).toBeFocused();
  expect(await main.evaluate((node) => node.matches(':focus-visible'))).toBe(
    true,
  );
  await expect(main).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => ({
    outlineStyle: globalThis.getComputedStyle(globalThis.document.activeElement)
      .outlineStyle,
    outlineWidth: globalThis.getComputedStyle(globalThis.document.activeElement)
      .outlineWidth,
  }));
  expect(next.outlineStyle).toBe('solid');
  expect(next.outlineWidth).toBe('3px');
});

test('friends placeholder renders one grid aligned with the reading column', async ({
  page,
}) => {
  await page.goto('/friends/');
  const grid = page.locator('.prose .friends-grid');
  await expect(grid).toHaveCount(1);
  await expect(page.locator('.friends-grid')).toHaveCount(1);
  const card = grid.locator('.friend-card').first();
  await expect(card).toHaveCSS('text-decoration-line', 'none');
  const metrics = await page.evaluate(() => {
    const prose = globalThis.document.querySelector('.prose');
    const gridNode = globalThis.document.querySelector('.prose .friends-grid');
    const paragraph = globalThis.document.querySelector('.prose > p');
    const firstCard = globalThis.document.querySelector(
      '.prose .friends-grid .friend-card',
    );
    return {
      proseLeft: prose.getBoundingClientRect().left,
      gridLeft: gridNode.getBoundingClientRect().left,
      textColor: globalThis.getComputedStyle(paragraph).color,
      cardColor: globalThis.getComputedStyle(firstCard).color,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewportWidth: globalThis.window.innerWidth,
    };
  });
  expect(metrics.gridLeft).toBeCloseTo(metrics.proseLeft, 0);
  expect(metrics.cardColor).toBe(metrics.textColor);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  const cards = grid.locator('.friend-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  expect(second.x).toBeGreaterThan(first.x);
  await page.setViewportSize({ width: 390, height: 844 });
  const stacked = await cards.nth(0).boundingBox();
  const stackedBelow = await cards.nth(1).boundingBox();
  expect(stackedBelow.y - stacked.y).toBeGreaterThan(50);
  expect(stackedBelow.x).toBeCloseTo(stacked.x, 0);
});
