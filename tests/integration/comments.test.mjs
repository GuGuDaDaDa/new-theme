/** Hugo integration coverage for the production article comment section. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildBoundarySite, removeBoundarySite } from '../helpers/site.mjs';
import { files, readJson, root } from '../../scripts/lib.mjs';

const fixture = await readJson(
  path.join(root, 'tests/fixtures/article/site.json'),
);
const commentKeys = [
  'comments.legend',
  'comments.previewEmpty',
  'comments.emojiImage',
  'comments.emojiUnavailable',
  'comments.rememberFailed',
  'comments.submit',
  'comments.submitReply',
  'comments.submitting',
  'comments.statusInvalid',
  'comments.statusFailed',
  'comments.statusSubmitted',
  'comments.statusPending',
  'comments.ownerBadge',
  'comments.reply',
  'comments.unfoldReplies',
  'comments.foldingWhileReplying',
  'comments.sampleBold',
  'comments.sampleLink',
  'comments.sampleQuote',
  'comments.sampleCode',
  'comments.loading',
  'comments.loadFailed',
  'comments.retry',
  'comments.empty',
  'comments.allShown',
  'comments.loadMore',
  'comments.adminNotice',
  'comments.adminKeyVerifying',
  'comments.adminKeyRequired',
  'comments.adminKeyFailed',
  'comments.replyLegend',
  'comments.cardLabel',
  'comments.replyTo',
  'comments.foldReplies',
];
let site;

/** Read one generated document. @param {string} relative - Path under the public directory. @returns {Promise<{html: string, $: import('cheerio').CheerioAPI}>} Source and parsed document. */
async function readPage(relative) {
  const html = await readFile(
    path.join(site.build.publicDir, relative),
    'utf8',
  );
  return { html, $: load(html) };
}

test.before(async () => {
  site = await buildBoundarySite({
    name: 'article-comments',
    definition: fixture,
  });
});

test.after(async () => {
  if (site) await removeBoundarySite(site.projectRoot);
});

test('article page mounts the comment section after the footer navigation', async () => {
  const { html, $ } = await readPage('posts/complete-frontmatter/index.html');
  const section = $('section.comments[data-comments]');
  assert.equal(section.length, 1);
  assert.equal(section.attr('id'), 'comments');
  assert.equal(section.attr('aria-labelledby'), 'comments-title');
  assert.equal(section.attr('data-api-base'), '/__comments');
  assert.equal(section.attr('data-site-id'), '');
  assert.equal(section.attr('data-emoji'), '/__comments/emoji.json');
  assert.equal(section.attr('data-post-title'), '完整文章头');
  const permalink = new URL(section.attr('data-post-url'));
  assert.equal(permalink.pathname, '/posts/complete-frontmatter/');
  assert.ok(['http:', 'https:'].includes(permalink.protocol));
  assert.ok(
    html.indexOf('article-nav') < html.indexOf('data-comments'),
    'Comment section must follow the footer navigation.',
  );
});

test('comment shell exposes composer, list, emoji and status regions', async () => {
  const { $ } = await readPage('posts/complete-frontmatter/index.html');
  const section = $('section.comments[data-comments]');
  assert.equal(section.find('.comments-heading h2').text().trim(), '评论');
  assert.equal(section.find('[data-comment-count]').text().trim(), '');
  assert.equal(section.find('[data-composer]').length, 1);
  assert.equal(section.find('[data-comment-body]').length, 1);
  assert.equal(section.find('[data-comment-preview]').length, 1);
  assert.equal(section.find('[data-comment-list]').length, 1);
  assert.equal(section.find('[data-load-more]').length, 1);
  assert.equal(section.find('[data-emoji-toggle]').length, 1);
  assert.equal(section.find('[data-emoji-panel]').length, 1);
  assert.equal(section.find('[data-submit-status]').length, 1);
  assert.equal(section.find('[data-reply-notice]').is('[hidden]'), true);
  assert.equal(section.find('[data-load-more]').is('[hidden]'), true);
  assert.equal(section.find('[data-emoji-panel]').is('[hidden]'), true);
});

test('owner badge ships as an inline verified icon template', async () => {
  const { $ } = await readPage('posts/complete-frontmatter/index.html');
  const section = $('section.comments[data-comments]');
  const template = section.find('template[data-owner-badge]');
  assert.equal(template.length, 1);
  assert.equal(template.contents().find('svg path').length, 1);
  assert.doesNotMatch($.html(section), /verified/);
});

test('administrator verification dialog ships with the composer', async () => {
  const { $ } = await readPage('posts/complete-frontmatter/index.html');
  const section = $('section.comments[data-comments]');
  assert.equal(section.find('[data-admin-notice]').is('[hidden]'), true);
  const dialog = section.find('dialog[data-comments-auth-dialog]');
  assert.equal(dialog.length, 1);
  assert.equal(dialog.attr('aria-labelledby'), 'comments-admin-title');
  assert.equal(
    dialog.find('#comments-admin-title').text().trim(),
    '管理员验证',
  );
  assert.equal(dialog.find('[data-dialog-close]').length, 1);
  assert.equal(dialog.find('[data-admin-key]').attr('type'), 'password');
  assert.equal(
    dialog.find('[data-admin-key]').attr('autocomplete'),
    'current-password',
  );
  assert.equal(dialog.find('[data-admin-status]').attr('role'), 'status');
  assert.equal(dialog.find('[data-admin-confirm]').attr('type'), 'submit');
  assert.equal(dialog.find('[data-admin-cancel]').length, 1);
});

test('templates without a comments switch do not mount the comment section', async () => {
  for (const page of [
    'index.html',
    'posts/index.html',
    'standalone/index.html',
  ]) {
    const { $ } = await readPage(page);
    assert.equal($('[data-comments]').length, 0, page);
    assert.equal($('.comments').length, 0, page);
  }
});

test('standalone pages mount the comment section when their switch is on', async () => {
  for (const [page, url] of [
    ['about/index.html', 'http://localhost:4173/about/'],
    ['friends/index.html', 'http://localhost:4173/friends/'],
  ]) {
    const { $ } = await readPage(page);
    const section = $('section.comments[data-comments]');
    assert.equal(section.length, 1, page);
    assert.equal(section.attr('data-api-base'), '/__comments', page);
    assert.equal(section.attr('data-post-url'), url, page);
    assert.ok(section.attr('data-post-title').length > 0, page);
    assert.ok($('.prose').index() < section.index(), page);
  }
});

test('browser i18n payload carries every comment string with placeholders intact', async () => {
  const { $ } = await readPage('posts/complete-frontmatter/index.html');
  const payload = JSON.parse($('script[data-i18n]').text());
  for (const key of commentKeys) {
    assert.equal(typeof payload[key], 'string', key);
    assert.ok(payload[key].length > 0, key);
  }
  assert.deepEqual(
    Object.keys(payload)
      .filter((key) => key.startsWith('comments.'))
      .sort(),
    [...commentKeys].sort(),
  );
  assert.equal(payload['comments.title'], undefined);
  assert.equal(payload['comments.ownerBadge'], '博主');
  assert.match(payload['comments.replyLegend'], /\{Name\}/);
  assert.match(payload['comments.cardLabel'], /\{Name\}/);
  assert.match(payload['comments.replyTo'], /\{Name\}/);
  assert.match(payload['comments.foldReplies'], /\{Count\}/);
});

test('comment templates and scripts keep visible copy in i18n files', async () => {
  const cjk = /[\u4e00-\u9fff]/;
  for (const directory of ['layouts', 'assets/js']) {
    for (const file of await files(path.join(root, directory))) {
      assert.equal(
        cjk.test(await readFile(file, 'utf8')),
        false,
        path.relative(root, file),
      );
    }
  }
  const translation = await readFile(
    path.join(root, 'i18n/zh-CN.toml'),
    'utf8',
  );
  for (const key of [...commentKeys, 'comments.title']) {
    assert.match(translation, new RegExp(`^\\[${key}\\]$`, 'm'), key);
  }
});
