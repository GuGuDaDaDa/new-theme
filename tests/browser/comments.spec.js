/** Browser coverage for the production article comment module. */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { buildSite } from '../../scripts/build.mjs';

const postURL = '/posts/demo/';
/** One transparent pixel served for intercepted image emoticons. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const definition = {
  clock: '2026-09-10T00:00:00Z',
  content: [
    { path: '_index.md', source: '---\ntitle: 首页\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: 全部文章\n---\n' },
    {
      path: 'posts/demo/index.md',
      source:
        '---\ntitle: 评论演示文章\ndate: 2026-09-09T12:00:00+08:00\n---\n\n这是用于评论浏览器用例的正文段落，用来形成阅读栏并验证评论模块与正文的对齐。\n',
    },
  ],
};

let fixtureRoot;
let fixtureBaseURL;
let server;

/** Serve an isolated production build over HTTP. @param {string} directory - Public output directory. @returns {Promise<string>} Server base URL. */
async function serve(directory) {
  const types = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
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

/** Build one comment record with production field names. @param {number} id - Comment id. @param {object} [overrides] - Field overrides. @returns {object} Comment record. */
function comment(id, overrides = {}) {
  return {
    id,
    name: `访客 ${id}`,
    email: 'hidden@example.test',
    url: '',
    contentText: `评论 **${id}**`,
    created: '2026-09-10T04:00:00.000Z',
    avatar: '',
    isAdmin: false,
    replyToAuthor: null,
    parentId: null,
    replies: [],
    ...overrides,
  };
}

/** Build one list payload. @param {object[]} roots - Root comments. @param {object} [pagination] - Pagination overrides. @returns {object} List payload. */
function listPayload(roots, pagination = {}) {
  return {
    data: roots,
    pagination: {
      page: 1,
      limit: 10,
      total: 1,
      totalCount: roots.length,
      ...pagination,
    },
  };
}

/**
 * Install deterministic comment API responses for one page.
 * @param {import('@playwright/test').Page} page - Active page.
 * @param {{config?: object, emoji?: object, list: Function, post?: Function, verify?: Function}} options - Scenario responses.
 * @returns {Promise<{listCalls: number, posts: object[], verifications: string[], requests: object[]}>} Recorded request state.
 */
async function mockComments(page, options) {
  const state = { listCalls: 0, posts: [], verifications: [], requests: [] };
  await page.route('**/__comments/**', async (route) => {
    const request = route.request();
    const requestURL = new URL(request.url());
    const { pathname } = requestURL;
    state.requests.push({ method: request.method(), pathname });
    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (pathname === '/__comments/api/config/comments') {
      return json(
        200,
        options.config ?? { adminBadge: '博主', adminEnabled: true },
      );
    }
    if (pathname === '/__comments/emoji.json') {
      if (!options.emoji)
        return route.fulfill({ status: 404, body: 'missing emoji' });
      return json(200, options.emoji);
    }
    if (pathname.endsWith('.png')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PIXEL,
      });
    }
    if (
      pathname === '/__comments/api/verify-admin' &&
      request.method() === 'POST'
    ) {
      const body = JSON.parse(request.postData());
      state.verifications.push(body.adminToken);
      const result = options.verify
        ? options.verify(body.adminToken, state)
        : { status: 200, body: { message: '验证通过' } };
      return json(result.status, result.body);
    }
    if (
      pathname === '/__comments/api/comments' &&
      request.method() === 'POST'
    ) {
      const body = JSON.parse(request.postData());
      state.posts.push(body);
      const result = options.post
        ? options.post(body, state)
        : { status: 200, body: { status: 'approved', data: {} } };
      return json(result.status, result.body);
    }
    if (pathname === '/__comments/api/comments') {
      state.listCalls += 1;
      const result = options.list(
        Number(requestURL.searchParams.get('page') ?? 1),
        state,
      );
      if (result.error)
        return json(result.status ?? 500, {
          message: result.message ?? 'boom',
        });
      return json(200, result);
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
  return state;
}

/** Open the demo article with the given mock API. @param {import('@playwright/test').Page} page - Active page. @param {object} options - Scenario responses. @returns {Promise<object>} Recorded request state. */
async function openArticle(page, options) {
  const state = await mockComments(page, options);
  await page.goto(`${fixtureBaseURL}${postURL}`);
  return state;
}

/** Build a pack whose image entries share one intercepted origin. @param {string} name - Pack name. @param {number} count - Item count. @returns {object} OwO pack. */
function imagePack(name, count) {
  return {
    type: 'image',
    container: Array.from({ length: count }, (_, index) => ({
      text: `${name}-${index}`,
      icon: `<img src="/__comments/emoji/${name}-${index}.png">`,
    })),
  };
}

test.beforeAll(async () => {
  const fixture = await buildBoundarySite({
    name: 'browser-comments',
    definition,
  });
  fixtureRoot = fixture.projectRoot;
  const build = await buildSite({
    projectRoot: fixtureRoot,
    clock: fixture.clock,
  });
  fixtureBaseURL = await serve(build.publicDir);
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await removeBoundarySite(fixtureRoot);
});

test('renders server data, owner badge, replies and restricted markdown', async ({
  page,
}) => {
  const roots = [
    comment(1, {
      isAdmin: true,
      url: 'https://guest.example.test/',
      contentText: 'Hello **world** <b>raw</b> [bad](javascript:alert(1))',
      replies: [
        comment(11, { parentId: 1, replyToAuthor: '访客 1' }),
        comment(12, { parentId: 1 }),
        comment(13, { parentId: 1 }),
        comment(14, { parentId: 1 }),
      ],
    }),
    comment(2),
  ];
  await openArticle(page, {
    list: () => listPayload(roots, { totalCount: 6 }),
  });

  await expect(page.locator('[data-comment-count]')).toHaveText('6');
  await expect(page.locator('.comment-root')).toHaveCount(2);
  await expect(
    page.locator('#comment-1 > .comment-card .comment-name'),
  ).toHaveText('访客 1');
  await expect(
    page.locator('#comment-1 > .comment-card .comment-name'),
  ).toHaveAttribute('href', 'https://guest.example.test/');
  const badge = page.locator('#comment-1 .owner-badge');
  await expect(badge).toHaveAttribute('role', 'img');
  await expect(badge).toHaveAttribute('aria-label', '博主');
  await expect(badge.locator('svg')).toHaveCount(1);
  expect(
    await badge.evaluate((node) => globalThis.getComputedStyle(node).color),
  ).toBe('rgb(180, 83, 9)');
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = 'dark';
  });
  expect(
    await badge.evaluate((node) => globalThis.getComputedStyle(node).color),
  ).toBe('rgb(219, 133, 13)');
  await expect(page.locator('#comment-2 .owner-badge')).toHaveCount(0);
  await expect(
    page.locator('#comment-1 > .comment-card .comment-body strong'),
  ).toHaveText('world');
  const body = await page
    .locator('#comment-1 > .comment-card .comment-body')
    .innerHTML();
  expect(body).not.toContain('<b>');
  expect(body).toContain('&lt;b&gt;');
  expect(
    await page.locator('#comment-1 > .comment-card .comment-body a').count(),
  ).toBe(0);
  await expect(page.locator('.comment-reply')).toHaveCount(3);
  await expect(page.locator('#comment-11 .comment-meta .reply-to')).toHaveText(
    '回复 @访客 1',
  );
  expect(
    await page.evaluate(() => {
      const doc = globalThis.document;
      const name = doc.querySelector('#comment-11 .comment-name');
      const target = doc.querySelector('#comment-11 .reply-to');
      return Math.abs(
        name.getBoundingClientRect().top - target.getBoundingClientRect().top,
      );
    }),
  ).toBeLessThan(4);
  expect(
    await page
      .locator('#comment-1 .replies > li')
      .first()
      .evaluate((node) => globalThis.getComputedStyle(node).paddingTop),
  ).toBe('8px');
  expect(
    await page.locator('#comment-1').evaluate((node) => {
      const style = globalThis.getComputedStyle(node);
      return [style.paddingTop, style.paddingBottom];
    }),
  ).toEqual(['16px', '16px']);
  await expect(page.locator('#comment-1 .fold-replies')).toHaveText(
    '展开其余 1 条回复',
  );
  expect(
    await page.locator('#comment-11 .reply-button').evaluate((node) => {
      const style = globalThis.getComputedStyle(node);
      return {
        display: style.display,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        height: Math.round(node.getBoundingClientRect().height),
      };
    }),
  ).toEqual({
    display: 'block',
    marginTop: '-4px',
    marginBottom: '4px',
    height: 28,
  });
  await page.locator('#comment-1 .fold-replies').click();
  await expect(page.locator('.comment-reply')).toHaveCount(4);
  await expect(page.locator('#comment-1 .fold-replies')).toHaveText('收起回复');
});

test('moves the single editor into a reply target and restores it on cancel', async ({
  page,
}) => {
  await openArticle(page, {
    list: () =>
      listPayload([
        comment(1, { replies: [comment(11, { parentId: 1 })] }),
        comment(2),
      ]),
  });
  await expect(page.locator('.comment-root')).toHaveCount(2);
  await page.locator('[data-comment-body]').fill('草稿内容');

  await page.locator('#comment-1 > .comment-card .reply-button').click();
  await expect(page.locator('[data-reply-notice]')).toBeVisible();
  await expect(page.locator('[data-reply-name]')).toHaveText('@访客 1');
  await expect(page.locator('[data-submit]')).toHaveText('发表回复');
  await expect(page.locator('#comment-1 [data-composer]')).toHaveCount(1);
  await expect(page.locator('[data-comment-body]')).toHaveValue('草稿内容');

  await page.locator('#comment-11 > .comment-card .reply-button').click();
  await expect(page.locator('#comment-11 [data-composer]')).toHaveCount(1);
  await expect(page.locator('[data-comment-body]')).toHaveValue('草稿内容');

  await page.locator('[data-cancel-reply]').click();
  await expect(page.locator('[data-reply-notice]')).toBeHidden();
  await expect(
    page.locator('[data-composer-home] > [data-composer]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-submit]')).toHaveText('发表评论');
  await expect(page.locator('[data-comment-body]')).toHaveValue('草稿内容');
});

test('previews restricted markdown without dropping the draft', async ({
  page,
}) => {
  await openArticle(page, { list: () => listPayload([comment(1)]) });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page
    .locator('[data-comment-body]')
    .fill('**加粗** <img src=x onerror=alert(1)>');
  await page.locator('[data-mode-preview]').click();
  await expect(page.locator('[data-comment-preview]')).toBeVisible();
  await expect(page.locator('[data-comment-preview] strong')).toHaveText(
    '加粗',
  );
  const preview = await page.locator('[data-comment-preview]').innerHTML();
  expect(preview).not.toContain('<img');
  await page.locator('[data-mode-edit]').click();
  await expect(page.locator('[data-comment-body]')).toHaveValue(
    '**加粗** <img src=x onerror=alert(1)>',
  );
});

test('submits an approved comment with the frozen payload and refreshes the list', async ({
  page,
}) => {
  const roots = [comment(1)];
  let approved = false;
  const state = await openArticle(page, {
    list: () =>
      approved
        ? listPayload([comment(99, { name: '新访客' }), comment(1)], {
            totalCount: 2,
          })
        : listPayload(roots),
    post: () => {
      approved = true;
      return { status: 200, body: { status: 'approved', data: { id: 99 } } };
    },
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('New **comment**');
  await page.locator('#comment-nickname').fill('新访客');
  await page.locator('[data-submit]').click();

  await expect(page.locator('[data-submit-status]')).toHaveText('评论已发表。');
  await expect(page.locator('.comment-root')).toHaveCount(2);
  await expect(
    page.locator('.comment-root').first().locator('.comment-name'),
  ).toHaveText('新访客');
  await expect(page.locator('[data-comment-body]')).toHaveValue('');
  expect(state.posts.length).toBe(1);
  const payload = state.posts[0];
  expect(payload.post_slug).toBe(`${fixtureBaseURL}${postURL}`);
  expect(payload.post_title).toBe('评论演示文章');
  const canonical = new URL(payload.post_url);
  expect(canonical.pathname).toBe(postURL);
  expect(payload.post_url).not.toBe(`${fixtureBaseURL}${postURL}`);
  expect(payload.name).toBe('新访客');
  expect(payload.email).toBe('example@example.com');
  expect(payload.content).toBe('New **comment**');
  expect(payload.parent_id).toBeUndefined();
});

test('reports a pending submission without adding it to the public list', async ({
  page,
}) => {
  await openArticle(page, {
    list: () => listPayload([comment(1)]),
    post: () => ({ status: 200, body: { status: 'pending', data: { id: 5 } } }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('待审核内容');
  await page.locator('#comment-nickname').fill('待审核访客');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-submit-status]')).toHaveText(
    '已提交，等待审核。',
  );
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await expect(page.locator('[data-comment-count]')).toHaveText('1');
  await expect(page.locator('[data-comment-body]')).toHaveValue('');
});

test('surfaces the server message and keeps the draft when submission fails', async ({
  page,
}) => {
  await openArticle(page, {
    list: () => listPayload([comment(1)]),
    post: () => ({
      status: 500,
      body: { message: '服务器忙，请稍后再试' },
    }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('失败也要保留');
  await page.locator('#comment-nickname').fill('访客甲');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-submit-status]')).toHaveText(
    '服务器忙，请稍后再试',
  );
  await expect(page.locator('[data-comment-body]')).toHaveValue('失败也要保留');
  await expect(page.locator('#comment-nickname')).toHaveValue('访客甲');
  await expect(page.locator('.comment-root')).toHaveCount(1);
});

test('verifies the administrator key and resends the comment with the token', async ({
  page,
}) => {
  let approved = false;
  const state = await openArticle(page, {
    config: {
      adminEmail: 'admin@example.test',
      adminBadge: '博主',
      adminEnabled: true,
    },
    list: () =>
      approved
        ? listPayload([comment(99, { name: '博主' })], { totalCount: 1 })
        : listPayload([], { totalCount: 0 }),
    post: () => {
      approved = true;
      return { status: 200, body: { status: 'approved' } };
    },
    verify: () => ({ status: 200, body: { message: '验证通过' } }),
  });
  await expect(page.locator('[data-list-status]')).toHaveText(
    '还没有评论，来留下第一条想法吧。',
  );
  await page.locator('[data-comment-body]').fill('管理员评论');
  await page.locator('#comment-nickname').fill('博主');
  await page.locator('#comment-email').fill('admin@example.test');
  await expect(page.locator('[data-admin-notice]')).toBeVisible();

  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-comments-auth-dialog]')).toBeVisible();
  expect(state.posts.length).toBe(0);

  await page.locator('[data-admin-key]').fill('topsecret');
  await page.locator('[data-admin-confirm]').click();
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  await expect(page.locator('[data-submit-status]')).toHaveText('评论已发表。');
  expect(state.verifications).toEqual(['topsecret']);
  expect(state.posts.length).toBe(1);
  expect(state.posts[0].adminToken).toBe('topsecret');
  expect(state.posts[0].email).toBe('admin@example.test');
  const stored = await page.evaluate(() =>
    globalThis.localStorage.getItem('night:comments:admin'),
  );
  expect(JSON.parse(stored).token).toBe('topsecret');

  await page.locator('[data-comment-body]').fill('第二条管理员评论');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-submit-status]')).toHaveText('评论已发表。');
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  expect(state.posts.length).toBe(2);
  expect(state.posts[1].adminToken).toBe('topsecret');

  await page.locator('[data-comment-body]').fill('第三条');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-submit-status]')).toHaveText('评论已发表。');
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  expect(state.posts.length).toBe(3);
  expect(state.posts[2].adminToken).toBe('topsecret');
});

test('keeps the administrator dialog open with the draft when the key is wrong', async ({
  page,
}) => {
  const state = await openArticle(page, {
    config: {
      adminEmail: 'admin@example.test',
      adminBadge: '博主',
      adminEnabled: true,
    },
    list: () => listPayload([comment(1)]),
    verify: () => ({ status: 401, body: { message: '密钥错误' } }),
    post: () => ({ status: 200, body: { status: 'approved' } }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('保留我');
  await page.locator('#comment-nickname').fill('博主');
  await page.locator('#comment-email').fill('admin@example.test');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-comments-auth-dialog]')).toBeVisible();

  await page.locator('[data-admin-key]').fill('wrong');
  await page.locator('[data-admin-confirm]').click();
  await expect(page.locator('[data-admin-status]')).toHaveText('密钥错误');
  await expect(page.locator('[data-comments-auth-dialog]')).toBeVisible();
  await expect(page.locator('[data-comment-body]')).toHaveValue('保留我');
  expect(state.posts.length).toBe(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  await expect(page.locator('[data-submit]')).toBeFocused();
});

test('does not prompt for a non-administrator email', async ({ page }) => {
  const state = await openArticle(page, {
    config: {
      adminEmail: 'admin@example.test',
      adminBadge: '博主',
      adminEnabled: true,
    },
    list: () => listPayload([comment(1)]),
    post: () => ({ status: 200, body: { status: 'approved' } }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('普通评论');
  await page.locator('#comment-nickname').fill('访客');
  await page.locator('#comment-email').fill('user@example.test');
  await expect(page.locator('[data-admin-notice]')).toBeHidden();
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-submit-status]')).toHaveText('评论已发表。');
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  expect(state.posts.length).toBe(1);
  expect(state.posts[0].adminToken).toBeUndefined();
});

test('falls back to the key dialog when the server requires authentication', async ({
  page,
}) => {
  let firstPost = true;
  const state = await openArticle(page, {
    list: () => listPayload([comment(1)]),
    post: () => {
      if (firstPost) {
        firstPost = false;
        return {
          status: 401,
          body: { message: '请输入管理员密钥', requireAuth: true },
        };
      }
      return { status: 200, body: { status: 'approved' } };
    },
    verify: () => ({ status: 200, body: { message: '验证通过' } }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await page.locator('[data-comment-body]').fill('需要密钥');
  await page.locator('#comment-nickname').fill('博主');
  await page.locator('#comment-email').fill('admin@example.test');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-comments-auth-dialog]')).toBeVisible();
  expect(state.posts.length).toBe(1);

  await page.locator('[data-admin-key]').fill('topsecret');
  await page.locator('[data-admin-confirm]').click();
  await expect(page.locator('[data-comments-auth-dialog]')).toBeHidden();
  expect(state.posts.length).toBe(2);
  expect(state.posts[1].adminToken).toBe('topsecret');
});

test('shows the empty state when the API has no comments', async ({ page }) => {
  await openArticle(page, {
    list: () => listPayload([], { totalCount: 0 }),
  });
  await expect(page.locator('[data-list-status]')).toHaveText(
    '还没有评论，来留下第一条想法吧。',
  );
  await expect(page.locator('[data-list-status]')).not.toHaveText('');
  await expect(page.locator('[data-load-more]')).toBeHidden();
  await expect(page.locator('[data-comment-count]')).toHaveText('0');
});

test('recovers from a failed load through the retry control', async ({
  page,
}) => {
  let failList = true;
  await openArticle(page, {
    list: () =>
      failList ? { error: true, message: '离线' } : listPayload([comment(7)]),
  });
  await expect(page.locator('[data-list-status]')).toContainText(
    '评论暂时没有加载出来。',
  );
  failList = false;
  await page.locator('[data-list-status] button').click();
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await expect(page.locator('[data-list-status]')).toHaveText('');
});

test('appends pages through load more and stops at the last page', async ({
  page,
}) => {
  const firstPage = Array.from({ length: 10 }, (_, index) =>
    comment(index + 1),
  );
  const secondPage = [comment(11), comment(12)];
  await openArticle(page, {
    list: (pageNumber) =>
      pageNumber === 1
        ? listPayload(firstPage, { page: 1, total: 2, totalCount: 12 })
        : listPayload(secondPage, { page: 2, total: 2, totalCount: 12 }),
  });
  await expect(page.locator('.comment-root')).toHaveCount(10);
  await expect(page.locator('[data-comment-count]')).toHaveText('12');
  await page.locator('[data-load-more]').click();
  await expect(page.locator('.comment-root')).toHaveCount(12);
  await expect(page.locator('[data-load-more]')).toBeHidden();
  await expect(page.locator('[data-load-status]')).toHaveText('已显示全部评论');
});

test('renders the OwO panel, paginates packs and inserts image emoticons', async ({
  page,
}) => {
  const emoji = {
    图片: imagePack('picture', 30),
    颜文字: {
      type: 'emoticon',
      container: [
        { text: '笑', icon: '(>_<)' },
        { text: '哭', icon: '(T_T)' },
      ],
    },
  };
  await openArticle(page, {
    emoji,
    list: () => listPayload([comment(1)]),
  });
  await expect(page.locator('[data-comment-list] .comment-root')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-emoji-toggle]')).toBeVisible();
  await page.locator('[data-emoji-toggle]').click();
  await expect(page.locator('[data-emoji-categories] button')).toHaveCount(2);
  await expect(page.locator('[data-emoji-grid] button')).toHaveCount(24);
  await expect(page.locator('[data-emoji-page]')).toHaveText('1 / 2');
  await page.locator('[data-emoji-next]').click();
  await expect(page.locator('[data-emoji-grid] button')).toHaveCount(6);
  await expect(page.locator('[data-emoji-page]')).toHaveText('2 / 2');
  await expect(page.locator('[data-emoji-next]')).toBeDisabled();
  await page.locator('[data-emoji-prev]').click();
  await page.locator('[data-emoji-grid] button').first().click();
  await expect(page.locator('[data-emoji-panel]')).toBeHidden();
  await expect(page.locator('[data-comment-body]')).toHaveValue(
    /!\[picture-0\]\(<http:\/\/127\.0\.0\.1:\d+\/__comments\/emoji\/picture-0\.png>\)/,
  );

  await page.locator('[data-emoji-toggle]').click();
  await page
    .locator('[data-emoji-categories] button', { hasText: '颜文字' })
    .click();
  await expect(page.locator('[data-emoji-grid] button')).toHaveCount(2);
  await page.locator('[data-emoji-grid] button').first().click();
  await expect(page.locator('[data-comment-body]')).toHaveValue(/\(>_<\)/);
});

test('degrades when the emoji file is unavailable', async ({ page }) => {
  await openArticle(page, { list: () => listPayload([comment(1)]) });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  await expect(page.locator('[data-emoji-toggle]')).toBeHidden();
  await expect(page.locator('[data-emoji-status]')).toHaveText(
    '表情包暂时无法加载，请刷新重试。',
  );
});

test('keeps the reading column aligned without horizontal overflow', async ({
  page,
}) => {
  await openArticle(page, {
    list: () =>
      listPayload([
        comment(1, {
          contentText:
            '一段较长的评论内容，用来撑开阅读栏并检查换行与溢出行为是否稳定。',
          replies: [comment(11, { parentId: 1 })],
        }),
      ]),
  });
  await expect(page.locator('.comment-root')).toHaveCount(1);
  for (const [width, expected] of [
    [320, 'single'],
    [360, 'single'],
    [390, 'single'],
    [768, 'single'],
    [1024, 'triple'],
    [1440, 'triple'],
    [1920, 'triple'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.evaluate(() => {
      const comments = globalThis.document.querySelector('.comments');
      const prose = globalThis.document.querySelector('.prose');
      const fields = globalThis.document.querySelector(
        '.comments .identity-fields',
      );
      const columns = globalThis
        .getComputedStyle(fields)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length;
      return {
        overflow:
          globalThis.document.documentElement.scrollWidth >
          globalThis.innerWidth,
        commentsWidth: comments.getBoundingClientRect().width,
        commentsLeft: comments.getBoundingClientRect().left,
        proseLeft: prose.getBoundingClientRect().left,
        columns,
      };
    });
    expect(geometry.overflow, `${width}px overflow`).toBe(false);
    expect(geometry.columns, `${width}px identity columns`).toBe(
      expected === 'triple' ? 3 : 1,
    );
    if (width >= 1024) {
      expect(Math.abs(geometry.commentsWidth - 740)).toBeLessThan(1);
      expect(Math.abs(geometry.commentsLeft - geometry.proseLeft)).toBeLessThan(
        1,
      );
    }
  }
});

test('keeps the focus ring for keyboard input only', async ({ page }) => {
  await openArticle(page, { list: () => listPayload([comment(1)]) });
  await expect(page.locator('.comment-root')).toHaveCount(1);

  const outline = (selector) =>
    page.evaluate((sel) => {
      const style = globalThis.getComputedStyle(
        globalThis.document.querySelector(sel),
      );
      return {
        mode: globalThis.document.documentElement.dataset.inputMode ?? null,
        style: style.outlineStyle,
        width: style.outlineWidth,
      };
    }, selector);

  await page.locator('[data-comment-body]').click();
  expect((await outline('[data-comment-body]')).style).toBe('none');

  await page.locator('#comment-nickname').click();
  expect((await outline('#comment-nickname')).style).toBe('none');

  await page.keyboard.press('Tab');
  const keyboard = await outline('#comment-email');
  expect(keyboard.mode).toBe('keyboard');
  expect(keyboard.style).toBe('solid');
  expect(keyboard.width).toBe('3px');

  await page
    .locator('[data-comments-auth-dialog]')
    .evaluate((dialog) => dialog.showModal());
  await page.locator('[data-admin-key]').click();
  expect((await outline('[data-admin-key]')).style).toBe('none');
});
