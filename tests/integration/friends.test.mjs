/** Hugo integration coverage for the friend-links placeholder contract. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildSite } from '../../scripts/build.mjs';
import { createBoundarySite, removeBoundarySite } from '../helpers/site.mjs';

const clock = '2026-09-10T00:00:00Z';

/** Read one published page from a fixture build. @param {string} publicDir - Published output directory. @param {string} relative - Page path relative to the output root. @returns {Promise<import('cheerio').CheerioAPI>} Parsed page. */
async function readPage(publicDir, relative) {
  const html = await readFile(path.join(publicDir, relative), 'utf8');
  return load(html);
}

/** Declare the content shared by the friends fixtures. @param {string} friendsBody - Markdown body of `/friends/`. @returns {object[]} Fixture content entries. */
function friendsContent(friendsBody) {
  return [
    { path: '_index.md', source: '---\ntitle: Home\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
    {
      path: 'friends/index.md',
      source: `---\ntitle: Friends\ntype: friends\n---\n\n${friendsBody}`,
    },
  ];
}

test('friends page without the placeholder keeps the grid after the prose block', async () => {
  const fixture = await createBoundarySite({
    name: 'friends-default',
    definition: {
      clock,
      content: [
        ...friendsContent('Friends body.\n'),
        {
          path: 'contacts/index.md',
          source:
            '---\ntitle: Contacts\ntype: friends\n---\n\nContacts body.\n',
        },
      ],
    },
  });
  try {
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const $ = await readPage(build.publicDir, 'contacts/index.html');
    assert.equal($('.prose .friends-grid').length, 0);
    assert.equal($('.standalone-page > .friends-grid').length, 1);
    assert.equal($('.friends-grid .friend-card').length, 4);
    assert.ok($('.prose').index() < $('.friends-grid').index());
    assert.ok(
      $('.friends-grid').index() < $('section.comments[data-comments]').index(),
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('placeholder renders a single grid between the surrounding paragraphs', async () => {
  const fixture = await createBoundarySite({
    name: 'friends-placeholder',
    definition: {
      clock,
      content: friendsContent(
        'Intro line.\n\n{{< friends >}}\n\nOutro line.\n',
      ),
    },
  });
  try {
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const $ = await readPage(build.publicDir, 'friends/index.html');
    assert.equal($('.friends-grid').length, 1);
    assert.equal($('.prose .friends-grid').length, 1);
    assert.equal($('.standalone-page > .friends-grid').length, 0);
    assert.equal($('.friends-grid .friend-card').length, 4);
    const children = $('.prose').children();
    assert.equal(children.eq(0).is('p'), true);
    assert.equal(children.eq(1).is('.friends-grid'), true);
    assert.equal(children.eq(2).is('p'), true);
    assert.equal(children.eq(0).text().trim(), 'Intro line.');
    assert.equal(children.eq(2).text().trim(), 'Outro line.');
    assert.equal(
      $('.standalone-page')
        .children()
        .last()
        .is('section.comments[data-comments]'),
      true,
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('empty friend data renders the empty state at the placeholder', async () => {
  const fixture = await createBoundarySite({
    name: 'friends-empty',
    definition: {
      clock,
      content: friendsContent('Intro line.\n\n{{< friends >}}\n'),
      templates: [{ path: 'data/friends.yaml', source: '[]\n' }],
    },
  });
  try {
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const $ = await readPage(build.publicDir, 'friends/index.html');
    assert.equal($('.friends-grid').length, 0);
    assert.equal($('.friends-empty').length, 1);
    assert.equal($('.prose .friends-empty').length, 1);
    assert.equal($('.prose .friends-empty').text().trim(), '友链整理中。');
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('two placeholders fail the build with the offending position', async () => {
  const fixture = await createBoundarySite({
    name: 'friends-duplicate',
    definition: {
      clock,
      content: friendsContent(
        'Intro line.\n\n{{< friends >}}\n\nOutro line.\n\n{{< friends >}}\n',
      ),
    },
  });
  try {
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock: fixture.clock }),
      /friends: only one placeholder is allowed \(friends\/index\.md\)/,
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});
