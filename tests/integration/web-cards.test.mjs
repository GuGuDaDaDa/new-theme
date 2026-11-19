/** Hugo integration coverage for build-time external web cards. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import path from 'node:path';
import { load } from 'cheerio';
import { buildSite } from '../../scripts/build.mjs';
import { readJson } from '../../scripts/lib.mjs';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { createLocalCertificate } from '../helpers/tls.mjs';

/** Start the controlled metadata and GitHub API server. @param {string} fixtureRoot - Fixture root used for the certificate. @returns {Promise<{origin: string, requests: Map<string, number>, close: () => Promise<void>}>} Running server details. */
async function startMetadataServer(fixtureRoot) {
  const certificate = await createLocalCertificate(
    path.join(fixtureRoot, '.build', 'web-card-tls'),
  );
  const requests = new Map();
  const server = createServer(certificate, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost');
    requests.set(url.pathname, (requests.get(url.pathname) ?? 0) + 1);
    if (url.pathname === '/page') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<meta property="og:title" content="外部 > 页面">
<meta property="og:description" content="这是外部网页简介。">
<meta property="og:image" content="/og-cover.png?v=1&amp;size=2">
<meta name="twitter:image" content="https://cdn.example.test/ignored.png">
<link rel="apple-touch-icon" href="/apple.png">
<link rel="icon" href="/icon.svg">
</head><body>page</body></html>`);
      return;
    }
    if (url.pathname === '/twitter') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<meta property="twitter:title" content="Twitter 备用标题">
<meta name="twitter:description" content="忽略的 Twitter 简介。">
<meta name="description" content="Twitter 备用简介。">
<meta name='twitter:image' content='//cdn.example.test/twitter-card.png'>
<link rel="icon" href="http://cdn.example.test/icon.png">
</head><body>twitter</body></html>`);
      return;
    }
    if (url.pathname === '/docs/guide') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<title>相对路径文档</title>
<meta property="og:image" content="images/guide-preview.png">
<link rel="icon" href="favicon.png">
</head><body>guide</body></html>`);
      return;
    }
    if (url.pathname === '/unsafe-preview') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<title>非安全预览图</title>
<meta property="og:image" content="http://insecure.example.test/cover.png">
<meta name="twitter:image" content="data:image/png;base64,iVBORw0KGgo=">
<link rel="icon" href="data:image/svg+xml,<svg/>">
</head><body>unsafe</body></html>`);
      return;
    }
    if (url.pathname === '/no-preview') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
<title>纯标题页面</title>
</head><body>minimal</body></html>`);
      return;
    }
    if (url.pathname === '/not-html') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('plain text response');
      return;
    }
    if (url.pathname === '/plain') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html><head></head><body>plain</body></html>',
      );
      return;
    }
    if (url.pathname === '/repos/owner/repo') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          full_name: 'owner/repo',
          description: '受控仓库简介。',
          owner: { avatar_url: 'https://avatars.example.test/owner.png' },
          html_url: 'https://github.com/owner/repo',
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
          html_url: 'https://github.com/owner/empty',
        }),
      );
      return;
    }
    if (url.pathname === '/repos/owner/missing') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Not Found' }));
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
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Read a generated page as a Cheerio document. @param {string} publicDir - Published directory. @param {string[]} segments - URL path segments. @returns {Promise<import('cheerio').CheerioAPI>} Parsed page. */
async function readPage(publicDir, ...segments) {
  return load(
    await readFile(path.join(publicDir, ...segments, 'index.html'), 'utf8'),
  );
}

/** Assert the standard card preview image contract on a Cheerio img element. @param {import('cheerio').Cheerio<any>} preview - Preview img selection. @param {string} expectedSrc - Expected absolute HTTPS preview URL. @returns {void} */
function assertPreviewImage(preview, expectedSrc) {
  assert.equal(preview.length, 1);
  assert.equal(preview.attr('src'), expectedSrc);
  assert.equal(preview.attr('width'), '180');
  assert.equal(preview.attr('height'), '90');
  assert.equal(preview.attr('alt'), '');
  assert.equal(preview.attr('loading'), 'lazy');
  assert.equal(preview.attr('decoding'), 'async');
  assert.equal(preview.attr('referrerpolicy'), 'no-referrer');
  assert.match(preview.attr('onerror') ?? '', /parentElement\.hidden/);
}

test('standalone HTTPS URLs render cached static cards without leaking into search text', async () => {
  const certificateWorkspace = await createBoundarySite({
    name: 'web-cards-tls',
    definition: {
      clock: '2026-09-10T00:00:00Z',
      content: [{ path: '_index.md', source: '---\ntitle: TLS\n---\n' }],
    },
  });
  let fixture;
  let server;
  const previousCertificateFile = process.env.SSL_CERT_FILE;
  try {
    server = await startMetadataServer(certificateWorkspace.projectRoot);
    process.env.SSL_CERT_FILE = path.join(
      certificateWorkspace.projectRoot,
      '.build',
      'web-card-tls',
      'localhost.pem',
    );
    const genericURL = `${server.origin}/page`;
    const fallbackURL = `${server.origin}/plain`;
    const twitterURL = `${server.origin}/twitter`;
    const relativeURL = `${server.origin}/docs/guide`;
    const unsafePreviewURL = `${server.origin}/unsafe-preview`;
    const noPreviewURL = `${server.origin}/no-preview`;
    const notHtmlURL = `${server.origin}/not-html`;
    const githubURL = 'https://github.com/owner/repo/';
    const uppercaseGitHubURL = 'https://GITHUB.COM/owner/repo';
    const emptyGitHubURL = 'https://github.com/owner/empty';
    const missingGitHubURL = 'https://github.com/owner/missing';
    const fragmentURL = `${genericURL}#section`;
    const queryURL = `${genericURL}?variant=2`;
    const siteURL = 'https://localhost:4173/site-page';
    fixture = await createBoundarySite({
      name: 'web-cards',
      definition: {
        clock: '2026-09-10T00:00:00Z',
        content: [
          { path: '_index.md', source: '---\ntitle: Cards Home\n---\n' },
          { path: 'posts/_index.md', source: '---\ntitle: Cards Posts\n---\n' },
          {
            path: 'posts/cards/index.md',
            source: `---
title: 网页卡片
date: 2026-09-09T00:00:00Z
---

作者正文开始。

${genericURL}

行内 ${genericURL} 保持链接。

<${genericURL}>

[${genericURL}](${genericURL})

[作者文字](${genericURL})

${fragmentURL}

${queryURL}

${twitterURL}

${relativeURL}

${unsafePreviewURL}

${noPreviewURL}

${notHtmlURL}

${siteURL}

\`\`\`text
${genericURL}
\`\`\`

~~~text
${genericURL}
~~~

    ${genericURL}

${fallbackURL}

${githubURL}

${uppercaseGitHubURL}

${emptyGitHubURL}

${missingGitHubURL}

http://example.com/not-supported

作者正文结束。
`,
          },
          {
            path: 'about/index.md',
            source: `---
title: 关于
date: 2026-09-09T00:00:00Z
---

${genericURL}
`,
          },
        ],
        templates: [
          {
            path: 'layouts/_partials/web-card/github-url.html',
            source: `{{- return (printf "%s/repos%s" ${JSON.stringify(server.origin)} .path) -}}`,
          },
        ],
      },
    });

    await appendFile(
      path.join(fixture.projectRoot, 'hugo.toml'),
      `
[security]
allowContent = ['.*']
[security.http]
urls = ['^https://localhost']
`,
    );
    const firstBuild = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const $ = await readPage(firstBuild.publicDir, 'posts', 'cards');
    assert.equal(
      $('.web-card').length,
      10,
      JSON.stringify(Object.fromEntries(server.requests)),
    );

    const genericCard = $(`.web-card[href="${genericURL}"]`);
    assert.equal(genericCard.length, 1);
    assert.equal(genericCard.attr('target'), undefined);
    assert.equal(genericCard.attr('referrerpolicy'), 'no-referrer');
    assert.equal(
      genericCard.find('.web-card-title').text().trim(),
      '外部 > 页面',
    );
    assert.equal(
      genericCard.find('.web-card-description').text().trim(),
      '这是外部网页简介。',
    );
    assert.equal(
      genericCard.find('.web-card-header .web-card-host').text().trim(),
      new URL(genericURL).host,
    );
    assert.equal(
      genericCard.find('.web-card-header .web-card-arrow').attr('aria-hidden'),
      'true',
    );
    const genericFavicon = genericCard.find('.web-card-favicon img');
    assert.equal(genericFavicon.attr('src'), `${server.origin}/icon.svg`);
    assert.equal(genericFavicon.attr('width'), '16');
    assert.equal(genericFavicon.attr('height'), '16');
    assert.equal(genericFavicon.attr('loading'), 'lazy');
    assert.equal(genericFavicon.attr('decoding'), 'async');
    assert.equal(genericFavicon.attr('referrerpolicy'), 'no-referrer');
    assert.ok(genericFavicon.attr('onerror'));
    assert.equal(genericCard.find('.web-card-favicon svg').length, 1);
    assertPreviewImage(
      genericCard.find('.web-card-preview img'),
      `${server.origin}/og-cover.png?v=1&size=2`,
    );

    const fragmentCard = $(`.web-card[href="${fragmentURL}"]`);
    assert.equal(fragmentCard.length, 1);
    const queryCard = $(`.web-card[href="${queryURL}"]`);
    assert.equal(queryCard.length, 1);
    assert.equal(
      queryCard.find('.web-card-title').text().trim(),
      '外部 > 页面',
    );
    assert.equal(
      queryCard.find('.web-card-host').text().trim(),
      new URL(queryURL).host,
    );

    const twitterCard = $(`.web-card[href="${twitterURL}"]`);
    assert.equal(twitterCard.length, 1);
    assert.equal(
      twitterCard.find('.web-card-title').text().trim(),
      'Twitter 备用标题',
    );
    assert.equal(
      twitterCard.find('.web-card-description').text().trim(),
      'Twitter 备用简介。',
    );
    assert.equal(
      twitterCard.find('.web-card-favicon img').attr('src'),
      `${server.origin}/favicon.ico`,
    );
    assert.equal(
      twitterCard.find('.web-card-preview img').attr('src'),
      'https://cdn.example.test/twitter-card.png',
    );

    const relativeCard = $(`.web-card[href="${relativeURL}"]`);
    assert.equal(relativeCard.length, 1);
    assert.equal(
      relativeCard.find('.web-card-favicon img').attr('src'),
      `${server.origin}/docs/favicon.png`,
    );
    assert.equal(
      relativeCard.find('.web-card-preview img').attr('src'),
      `${server.origin}/docs/images/guide-preview.png`,
    );

    const unsafePreviewCard = $(`.web-card[href="${unsafePreviewURL}"]`);
    assert.equal(unsafePreviewCard.length, 1);
    assert.equal(unsafePreviewCard.find('.web-card-preview').length, 0);
    assert.equal(
      unsafePreviewCard.find('.web-card-favicon img').attr('src'),
      `${server.origin}/favicon.ico`,
    );

    const noPreviewCard = $(`.web-card[href="${noPreviewURL}"]`);
    assert.equal(noPreviewCard.length, 1);
    assert.equal(noPreviewCard.find('.web-card-preview').length, 0);
    assert.equal(noPreviewCard.find('.web-card-description').length, 0);

    const githubCard = $(`.web-card[href="${githubURL}"]`);
    assert.equal(githubCard.length, 1);
    assert.equal(
      githubCard.find('.web-card-header .web-card-host').text().trim(),
      'github.com',
    );
    assert.equal(githubCard.find('.web-card-favicon svg').length, 1);
    assert.equal(githubCard.find('.web-card-favicon img').length, 0);
    assert.equal(
      githubCard.find('.web-card-header .web-card-arrow').attr('aria-hidden'),
      'true',
    );
    assertPreviewImage(
      githubCard.find('.web-card-preview img'),
      'https://opengraph.githubassets.com/1/owner/repo',
    );
    assert.doesNotMatch(githubCard.html() ?? '', /avatars\.example\.test/);
    assert.equal(
      githubCard.find('.web-card-title').text().trim(),
      'owner/repo',
    );
    assert.equal(
      githubCard.find('.web-card-description').text().trim(),
      '受控仓库简介。',
    );

    const uppercaseGitHubCard = $(`.web-card[href="${uppercaseGitHubURL}"]`);
    assert.equal(uppercaseGitHubCard.length, 1);
    assert.equal(
      uppercaseGitHubCard.find('.web-card-header .web-card-host').text().trim(),
      'github.com',
    );
    assert.equal(
      uppercaseGitHubCard.find('.web-card-preview img').attr('src'),
      'https://opengraph.githubassets.com/1/owner/repo',
    );

    const emptyGitHubCard = $(`.web-card[href="${emptyGitHubURL}"]`);
    assert.equal(emptyGitHubCard.length, 1);
    assert.equal(
      emptyGitHubCard.find('.web-card-header .web-card-host').text().trim(),
      'github.com',
    );
    assert.equal(
      emptyGitHubCard.find('.web-card-preview img').attr('src'),
      'https://opengraph.githubassets.com/1/owner/empty',
    );
    assert.equal(
      emptyGitHubCard.find('.web-card-title').text().trim(),
      'owner/empty',
    );
    assert.equal(emptyGitHubCard.find('.web-card-description').length, 0);

    const fallbackLink = $(`[data-article-body] a[href="${fallbackURL}"]`);
    assert.equal(fallbackLink.length, 1);
    assert.equal(fallbackLink.hasClass('web-card'), false);
    assert.equal(fallbackLink.text().trim(), fallbackURL);
    assert.equal(
      $(`[data-article-body] a[href="${notHtmlURL}"]`).hasClass('web-card'),
      false,
    );
    assert.equal(
      $(`[data-article-body] a[href="${siteURL}"]`).hasClass('web-card'),
      false,
    );
    assert.equal(
      $(`[data-article-body] a[href="${missingGitHubURL}"]`).hasClass(
        'web-card',
      ),
      false,
    );
    assert.equal(
      $(
        '[data-article-body] a[href="http://example.com/not-supported"]',
      ).hasClass('web-card'),
      false,
    );
    assert.equal(
      $(`[data-article-body] a[href="${genericURL}"]`).length,
      4,
      'one card, inline link, explicit URL link and custom-text link',
    );

    const about = await readPage(firstBuild.publicDir, 'about');
    assert.equal(about('.web-card').length, 0);

    const index = await readJson(path.join(firstBuild.publicDir, 'index.json'));
    const entry = index.posts.find((post) => post.url === '/posts/cards/');
    assert.ok(entry);
    const excludedCardText =
      /外部 > 页面|这是外部网页简介|受控仓库简介|相对路径文档|非安全预览图|纯标题页面|owner\/repo|owner\/empty/;
    assert.doesNotMatch(entry.content, excludedCardText);
    assert.equal(
      entry.content.match(/github\.com/gi)?.length ?? 0,
      1,
      'only the fallback missing GitHub link should remain in searchable content',
    );
    assert.match(entry.content, /作者正文开始/);
    assert.doesNotMatch($('.dek').text(), excludedCardText);
    assert.equal(
      $('.dek')
        .text()
        .match(/github\.com/gi)?.length ?? 0,
      1,
      'only the fallback missing GitHub link should remain in the summary',
    );

    assert.equal(server.requests.get('/page'), 2);
    assert.equal(server.requests.get('/plain'), 1);
    assert.equal(server.requests.get('/twitter'), 1);
    assert.equal(server.requests.get('/docs/guide'), 1);
    assert.equal(server.requests.get('/unsafe-preview'), 1);
    assert.equal(server.requests.get('/no-preview'), 1);
    assert.equal(server.requests.get('/not-html'), 1);
    assert.equal(server.requests.get('/repos/owner/repo'), 1);
    assert.equal(server.requests.get('/repos/owner/empty'), 1);
    assert.equal(server.requests.get('/repos/owner/missing'), 1);
    assert.equal(server.requests.get('/icon.svg') ?? 0, 0);
    assert.equal(server.requests.get('/og-cover.png') ?? 0, 0);
    assert.equal(server.requests.get('/docs/favicon.png') ?? 0, 0);
    assert.equal(server.requests.get('/docs/images/guide-preview.png') ?? 0, 0);

    await server.close();
    const secondBuild = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const cached = await readPage(secondBuild.publicDir, 'posts', 'cards');
    assert.equal(cached('.web-card').length, 10);
    assert.equal(
      cached(`.web-card[href="${genericURL}"] .web-card-title`).text().trim(),
      '外部 > 页面',
    );
  } finally {
    if (server) await server.close().catch(() => {});
    if (previousCertificateFile === undefined) delete process.env.SSL_CERT_FILE;
    else process.env.SSL_CERT_FILE = previousCertificateFile;
    if (fixture) await removeBoundarySite(fixture.projectRoot);
    await removeBoundarySite(certificateWorkspace.projectRoot);
  }
});
