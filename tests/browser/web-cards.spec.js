/** Browser coverage for redesigned web cards, responsive layout, themes, and media fallbacks. */

import { test, expect } from '@playwright/test';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildSite } from '../../scripts/build.mjs';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { createLocalCertificate } from '../helpers/tls.mjs';

const PREVIEW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1f2937"/><text x="60" y="320" fill="#f9fafb" font-size="64">Preview 2:1</text></svg>';
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#496b73"/></svg>';

let certificateRoot;
let fixtureRoot;
let siteBaseURL;
let metadataOrigin;
let staticServer;

/** Start a local HTTPS metadata server used only while building the browser fixture. @param {string} directory - Certificate workspace directory. @returns {Promise<{origin: string, certFile: string, close: () => Promise<void>}>} Running HTTPS server. */
async function startMetadataServer(directory) {
  const certificate = await createLocalCertificate(directory);
  const server = createHttpsServer(certificate, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost');
    if (url.pathname === '/long-generic') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<meta property="og:title" content="${'Long external article title for testing two-line clamping behavior across desktop and mobile viewports without expanding card height. '.repeat(4)}">
<meta property="og:description" content="${'Long external webpage description text for verifying that the full-width description area clamps cleanly to at most two lines across browsers. '.repeat(4)}">
<meta property="og:image" content="https://images.example.test/preview.svg">
<link rel="icon" href="https://images.example.test/favicon.svg">
</head><body>long</body></html>`);
      return;
    }
    if (url.pathname === '/no-preview') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<title>没有预览图的极简外部页面标题</title>
<link rel="icon" href="https://images.example.test/favicon.svg">
</head><body>minimal</body></html>`);
      return;
    }
    if (url.pathname === '/broken-media') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<meta property="og:title" content="破图回退测试页面标题">
<meta property="og:description" content="用于验证预览图与网站图标 404 时的运行时降级回退。">
<meta property="og:image" content="https://images.example.test/missing-preview.png">
<link rel="icon" href="https://images.example.test/missing-favicon.png">
</head><body>broken</body></html>`);
      return;
    }
    if (url.pathname === '/repos/owner/repo') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          full_name: 'owner/repo',
          description: '一个用于验证桌面横版预览图与顶栏样式的受控仓库。',
          owner: { avatar_url: 'https://avatars.example.test/owner.png' },
        }),
      );
      return;
    }
    if (url.pathname === '/repos/owner/empty') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          full_name: 'owner/empty',
          description: null,
          owner: { avatar_url: 'https://avatars.example.test/empty.png' },
        }),
      );
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    origin: `https://localhost:${port}`,
    certFile: certificate.certFile,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Serve the built fixture output over local HTTP. @param {string} directory - Built public directory. @returns {Promise<{baseURL: string, server: import('node:http').Server}>} Static server details. */
async function serveStatic(directory) {
  const types = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  const server = createHttpServer(async (request, response) => {
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
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    server,
  };
}

/** Intercept external card preview and favicon image requests with local controlled responses. @param {import('@playwright/test').Page} page - Active Playwright page. @returns {Promise<void>} Completion. */
async function stubExternalCardMedia(page) {
  await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (
      url.startsWith('https://opengraph.githubassets.com/') ||
      url === 'https://images.example.test/preview.svg'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: PREVIEW_SVG,
      });
      return;
    }
    if (url === 'https://images.example.test/favicon.svg') {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: FAVICON_SVG,
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'Not Found',
    });
  });
}

test.beforeAll(async () => {
  const certSite = await createBoundarySite({
    name: 'browser-web-cards-tls',
    definition: {
      clock: '2026-09-10T00:00:00Z',
      content: [{ path: '_index.md', source: '---\ntitle: TLS\n---\n' }],
    },
  });
  certificateRoot = certSite.projectRoot;
  const previousCertificateFile = process.env.SSL_CERT_FILE;
  const metadataServer = await startMetadataServer(
    path.join(certificateRoot, '.build', 'web-card-tls'),
  );
  try {
    metadataOrigin = metadataServer.origin;
    process.env.SSL_CERT_FILE = metadataServer.certFile;
    const fixture = await createBoundarySite({
      name: 'browser-web-cards',
      definition: {
        clock: '2026-09-10T00:00:00Z',
        content: [
          { path: '_index.md', source: '---\ntitle: Cards Home\n---\n' },
          { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
          {
            path: 'posts/cards/index.md',
            source: `---
title: 网页卡片浏览器验证
date: 2026-09-09T00:00:00Z
---

第一段正文。

https://github.com/owner/repo

https://github.com/owner/empty

${metadataOrigin}/long-generic

${metadataOrigin}/no-preview

${metadataOrigin}/broken-media

最后一段正文。
`,
          },
        ],
        templates: [
          {
            path: 'layouts/_partials/web-card/github-url.html',
            source: `{{- return (printf "%s/repos%s" ${JSON.stringify(metadataOrigin)} .path) -}}`,
          },
        ],
      },
    });
    fixtureRoot = fixture.projectRoot;
    await appendFile(
      path.join(fixtureRoot, 'hugo.toml'),
      `
[security]
allowContent = ['.*']
[security.http]
urls = ['^https://localhost']
`,
    );
    const build = await buildSite({
      projectRoot: fixtureRoot,
      clock: fixture.clock,
    });
    const served = await serveStatic(build.publicDir);
    siteBaseURL = served.baseURL;
    staticServer = served.server;
  } finally {
    await metadataServer.close();
    if (previousCertificateFile === undefined) delete process.env.SSL_CERT_FILE;
    else process.env.SSL_CERT_FILE = previousCertificateFile;
  }
});

test.afterAll(async () => {
  await new Promise((resolve) => staticServer?.close(resolve) ?? resolve());
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
  if (certificateRoot) await removeBoundarySite(certificateRoot);
});

test('desktop renders 180x90 preview beside title, full-width description, and 2-line clamp', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubExternalCardMedia(page);
  await page.goto(`${siteBaseURL}/posts/cards/`);

  const githubCard = page.locator(
    '.web-card[href="https://github.com/owner/repo"]',
  );
  await githubCard.scrollIntoViewIfNeeded();
  await expect(githubCard.locator('.web-card-preview img')).toHaveJSProperty(
    'complete',
    true,
  );
  await expect
    .poll(() =>
      githubCard
        .locator('.web-card-preview img')
        .evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0);

  const ghPreview = await githubCard.locator('.web-card-preview').boundingBox();
  const ghTitle = await githubCard.locator('.web-card-title').boundingBox();
  const ghDesc = await githubCard
    .locator('.web-card-description')
    .boundingBox();
  expect(Math.abs(ghPreview.width - 180)).toBeLessThanOrEqual(1);
  expect(Math.abs(ghPreview.height - 90)).toBeLessThanOrEqual(1);
  expect(ghTitle.x).toBeGreaterThanOrEqual(ghPreview.x + ghPreview.width);
  expect(ghTitle.y).toBeGreaterThanOrEqual(ghPreview.y - 2);
  expect(ghTitle.y + ghTitle.height).toBeLessThanOrEqual(
    ghPreview.y + ghPreview.height + 2,
  );
  expect(ghDesc.y).toBeGreaterThanOrEqual(ghPreview.y + ghPreview.height);
  expect(Math.abs(ghDesc.x - ghPreview.x)).toBeLessThanOrEqual(2);
  expect(ghDesc.width).toBeGreaterThan(ghTitle.width + 100);

  const longCard = page.locator(
    `.web-card[href="${metadataOrigin}/long-generic"]`,
  );
  await longCard.scrollIntoViewIfNeeded();
  const clampMetrics = await longCard.evaluate((card) => {
    const title = card.querySelector('.web-card-title');
    const desc = card.querySelector('.web-card-description');
    const titleStyle = globalThis.getComputedStyle(title);
    const descStyle = globalThis.getComputedStyle(desc);
    return {
      titleHeight: title.getBoundingClientRect().height,
      titleLineHeight: parseFloat(titleStyle.lineHeight),
      titleOverflow: title.scrollHeight > title.clientHeight,
      descHeight: desc.getBoundingClientRect().height,
      descLineHeight: parseFloat(descStyle.lineHeight),
      descOverflow: desc.scrollHeight > desc.clientHeight,
    };
  });
  expect(clampMetrics.titleHeight).toBeLessThanOrEqual(
    clampMetrics.titleLineHeight * 2 + 2,
  );
  expect(clampMetrics.titleOverflow).toBe(true);
  expect(clampMetrics.descHeight).toBeLessThanOrEqual(
    clampMetrics.descLineHeight * 2 + 2,
  );
  expect(clampMetrics.descOverflow).toBe(true);

  const noPreviewCard = page.locator(
    `.web-card[href="${metadataOrigin}/no-preview"]`,
  );
  const noPreviewTitle = await noPreviewCard
    .locator('.web-card-title')
    .boundingBox();
  const noPreviewMain = await noPreviewCard
    .locator('.web-card-main')
    .boundingBox();
  expect(Math.abs(noPreviewTitle.width - noPreviewMain.width)).toBeLessThan(2);
  await expect(noPreviewCard.locator('.web-card-preview')).toHaveCount(0);
  await expect(noPreviewCard.locator('.web-card-description')).toHaveCount(0);
});

test('narrow viewports stack 2:1 full-width preview above title with zero horizontal overflow', async ({
  page,
}) => {
  await stubExternalCardMedia(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${siteBaseURL}/posts/cards/`);

    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth >
        globalThis.document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    const githubCard = page.locator(
      '.web-card[href="https://github.com/owner/repo"]',
    );
    const mainBox = await githubCard.locator('.web-card-main').boundingBox();
    const previewBox = await githubCard
      .locator('.web-card-preview')
      .boundingBox();
    const titleBox = await githubCard.locator('.web-card-title').boundingBox();
    const descBox = await githubCard
      .locator('.web-card-description')
      .boundingBox();

    expect(Math.abs(previewBox.width - mainBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(previewBox.width / previewBox.height - 2)).toBeLessThan(
      0.08,
    );
    expect(titleBox.y).toBeGreaterThanOrEqual(
      previewBox.y + previewBox.height - 1,
    );
    expect(descBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  }
});

test('light and dark themes apply semantic tokens and monochrome GitHub icon color', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubExternalCardMedia(page);
  await page.goto(`${siteBaseURL}/posts/cards/`);

  const readColors = () =>
    page
      .locator('.web-card[href="https://github.com/owner/repo"]')
      .evaluate((card) => ({
        headerBg: globalThis.getComputedStyle(
          card.querySelector('.web-card-header'),
        ).backgroundColor,
        bodyBg: globalThis.getComputedStyle(
          card.querySelector('.web-card-body'),
        ).backgroundColor,
        titleColor: globalThis.getComputedStyle(
          card.querySelector('.web-card-title'),
        ).color,
        descColor: globalThis.getComputedStyle(
          card.querySelector('.web-card-description'),
        ).color,
        previewBorder: globalThis.getComputedStyle(
          card.querySelector('.web-card-preview'),
        ).borderTopColor,
        githubSvgFill: globalThis.getComputedStyle(
          card.querySelector('.web-card-favicon svg'),
        ).fill,
      }));

  const light = await readColors();
  expect(light).toEqual({
    headerBg: 'rgb(245, 245, 245)',
    bodyBg: 'rgb(250, 250, 250)',
    titleColor: 'rgb(73, 107, 115)',
    descColor: 'rgb(107, 107, 107)',
    previewBorder: 'rgb(229, 229, 229)',
    githubSvgFill: 'rgb(107, 107, 107)',
  });

  await page.evaluate(() =>
    globalThis.localStorage.setItem('bugu-theme', 'dark'),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const dark = await readColors();
  expect(dark).toEqual({
    headerBg: 'rgb(38, 38, 38)',
    bodyBg: 'rgb(28, 28, 28)',
    titleColor: 'rgb(157, 197, 232)',
    descColor: 'rgb(163, 163, 163)',
    previewBorder: 'rgb(64, 64, 64)',
    githubSvgFill: 'rgb(163, 163, 163)',
  });
});

test('runtime 404 preview hides container for full-width title and 404 favicon exposes inline link icon', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubExternalCardMedia(page);
  await page.goto(`${siteBaseURL}/posts/cards/`);

  const brokenCard = page.locator(
    `.web-card[href="${metadataOrigin}/broken-media"]`,
  );
  await brokenCard.scrollIntoViewIfNeeded();

  const preview = brokenCard.locator('.web-card-preview');
  const faviconImg = brokenCard.locator('.web-card-favicon img');
  const linkIcon = brokenCard.locator('.web-card-favicon .web-card-link-icon');

  await expect(preview).toHaveAttribute('hidden', '');
  await expect(preview).toBeHidden();
  await expect(faviconImg).toHaveAttribute('hidden', '');
  await expect(faviconImg).toBeHidden();
  await expect(linkIcon).toBeVisible();

  const mainBox = await brokenCard.locator('.web-card-main').boundingBox();
  const titleBox = await brokenCard.locator('.web-card-title').boundingBox();
  expect(Math.abs(titleBox.width - mainBox.width)).toBeLessThanOrEqual(2);
});
