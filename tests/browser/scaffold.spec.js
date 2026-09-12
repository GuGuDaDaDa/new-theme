/** Browser checks for the runnable scaffold and isolated dynamic import contracts. */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';

test('home renders compiled CSS and JavaScript and links to a readable post', async ({
  page,
}) => {
  const errors = [];
  const network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    network.push({
      url: response.url(),
      status: response.status(),
      mime: response.headers()['content-type'] ?? '',
    });
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-js', 'ready');
  await expect(page.locator('#latest-title')).toHaveText('最新文章');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(247, 248, 250)',
  );

  const css = network.find((r) => r.url.includes('/css/compiled.'));
  expect(css).toBeDefined();
  expect(css.status).toBe(200);
  expect(css.mime).toContain('text/css');

  const mainJs = network.find((r) => r.url.includes('/js/main-'));
  expect(mainJs).toBeDefined();
  expect(mainJs.status).toBe(200);
  expect(mainJs.mime).toContain('javascript');

  const ga = network.find(
    (r) => r.url.includes('google-analytics') || r.url.includes('gtag'),
  );
  expect(ga).toBeUndefined();

  await page.locator('.post h2 a').first().click();
  await expect(page.locator('.prose')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('mobile and no-JS basic browsing remain available', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.masonry')).toHaveCSS(
    'grid-template-columns',
    '350px',
  );
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '关于' })
    .click();
  await expect(page).toHaveURL('/about/');
  await expect(page.locator('.about-page h1')).toHaveText('BuGuLog');
  await context.close();
});

test('isolated boundary fixture loads CSS, main entry, and dynamic ESM chunk over HTTP', async ({
  browser,
}) => {
  const fixture = await createBoundarySite({ name: 'browser-chunk-spec' });
  let server;
  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const directory = res.publicDir;
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
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

    const context = await browser.newContext();
    const page = await context.newPage();
    const network = [];
    page.on('response', (response) => {
      network.push({
        url: response.url(),
        status: response.status(),
        mime: response.headers()['content-type'] ?? '',
      });
    });

    await page.goto(baseURL);
    await page.waitForSelector('html[data-dynamic="DYNAMIC_CHUNK_OK"]', {
      timeout: 5000,
    });

    const dynamicLoaded = await page.evaluate(
      () => globalThis.__DYNAMIC_LOADED__,
    );
    expect(dynamicLoaded).toBe('DYNAMIC_CHUNK_OK');

    const cssResp = network.find((r) => r.url.includes('/css/compiled.'));
    expect(cssResp).toBeDefined();
    expect(cssResp.status).toBe(200);
    expect(cssResp.mime).toContain('text/css');

    const mainResp = network.find((r) => r.url.includes('/js/main-'));
    expect(mainResp).toBeDefined();
    expect(mainResp.status).toBe(200);
    expect(mainResp.mime).toContain('javascript');

    const chunkResp = network.find((r) =>
      r.url.includes('/js/chunks/dynamic-sample-'),
    );
    expect(chunkResp).toBeDefined();
    expect(chunkResp.status).toBe(200);
    expect(chunkResp.mime).toContain('javascript');

    const gaResp = network.find(
      (r) => r.url.includes('google') || r.url.includes('gtag'),
    );
    expect(gaResp).toBeUndefined();

    await context.close();

    // Verify no-JS browsing on the fixture
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`${baseURL}/posts/public/`);
    await expect(noJsPage.locator('.prose')).not.toBeEmpty();
    await expect(
      noJsPage.getByRole('link', { name: '返回文章列表' }),
    ).toHaveAttribute('href', '/posts/');
    await noJsContext.close();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await removeBoundarySite(fixture.projectRoot);
  }
});
