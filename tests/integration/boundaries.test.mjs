/** Prove isolated roots, fixed clocks, and managed fixture cleanup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { buildSite } from '../../scripts/build.mjs';
import {
  createBoundarySite,
  removeBoundarySite,
  snapshotTree,
} from '../helpers/site.mjs';
import { files, readJson, removeGenerated, root } from '../../scripts/lib.mjs';
import { validateOutput } from '../../scripts/validate-output.mjs';

/**
 * Hash a stable route or term value.
 * @param {string} value - Value to hash.
 * @returns {string} SHA-256 digest.
 */
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('buildSite uses the fixture root and injected clock without touching author inputs', async () => {
  const authorContent = await snapshotTree(path.join(root, 'content'));
  const authorPublic = await snapshotTree(path.join(root, 'public'));
  const fixture = await createBoundarySite({ name: 'boundaries' });
  try {
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    assert.equal(result.projectRoot, fixture.projectRoot);
    assert.equal(result.metadata.buildTime, fixture.clock.toISOString());
    assert.equal(
      result.finalConfig,
      path.join(fixture.projectRoot, '.build/config.json'),
    );
    assert.equal(result.prepareConfig, undefined);
    assert.equal(result.prepareDestination, undefined);
    assert.ok(result.publicDir.startsWith(`${fixture.projectRoot}/`));
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
  assert.deepEqual(
    await snapshotTree(path.join(root, 'content')),
    authorContent,
  );
  assert.deepEqual(await snapshotTree(path.join(root, 'public')), authorPublic);
});

test('public collection keeps only eligible posts and excludes hidden bundles', async () => {
  const clock = '2026-09-10T00:00:00Z';
  const content = [
    { path: '_index.md', source: '---\ntitle: Home\n---\n' },
    { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
    {
      path: 'about/index.md',
      source: '---\ntitle: About\n---\nINDEPENDENT_MARKER\n',
    },
  ];
  for (let index = 0; index < 25; index += 1)
    content.push({
      path: `posts/post-${String(index).padStart(2, '0')}/index.md`,
      source: `---\ntitle: Post ${index}\ndate: ${index === 24 ? '2026-09-09T16:00:00Z' : '2026-09-09T00:00:00Z'}\n${index === 0 ? '' : `created: ${index === 24 ? '2026-09-09T00:30:00Z' : '2026-09-09T01:00:00Z'}\n`}---\nPUBLIC_MARKER_${index}\n`,
    });
  for (const [pathName, marker, metadata] of [
    ['posts/future/index.md', 'FUTURE_MARKER', 'date: 2026-09-10T00:00:01Z'],
    [
      'posts/publish-later/index.md',
      'PUBLISH_LATER_MARKER',
      'date: 2026-09-09T00:00:00Z\npublishDate: 2026-09-10T00:00:01Z',
    ],
    [
      'posts/future-date-past-publish/index.md',
      'FUTURE_DATE_MARKER',
      'date: 2026-09-10T00:00:01Z\npublishDate: 2026-09-09T00:00:00Z',
    ],
    [
      'posts/expired/index.md',
      'EXPIRED_MARKER',
      'date: 2026-09-09T00:00:00Z\nexpiryDate: 2026-09-10T00:00:00Z',
    ],
    [
      'posts/draft/index.md',
      'DRAFT_MARKER',
      'date: 2026-09-09T00:00:00Z\ndraft: true',
    ],
  ])
    content.push({
      path: pathName,
      source: `---\ntitle: Hidden\n${metadata}\n---\n${marker}\n`,
    });
  content.push(
    {
      path: 'posts/draft/secret.txt',
      source: 'HIDDEN_RESOURCE_MARKER',
    },
    {
      path: 'posts/draft/secret.md',
      source:
        '---\ntitle: Nested\ndate: 2026-09-09T00:00:00Z\n---\nHIDDEN_NESTED_MARKER\n',
    },
  );
  const fixture = await createBoundarySite({
    name: 'public-collection',
    definition: { clock, content },
  });
  try {
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const index = await readJson(path.join(result.publicDir, 'index.json'));
    const expectedUrls = [
      24,
      ...Array.from({ length: 23 }, (_, index) => index + 1),
      0,
    ].map((index) => `/posts/post-${String(index).padStart(2, '0')}/`);
    assert.equal(index.posts.length, 25);
    assert.deepEqual(
      index.posts.map((post) => post.rank),
      [...Array(25).keys()],
    );
    assert.deepEqual(
      index.posts.map((post) => post.url),
      expectedUrls,
    );
    assert.equal(
      index.posts.some((post) => post.url.includes('/about/')),
      false,
    );
    const output = await files(result.publicDir);
    for (const forbidden of [
      '/posts/future/',
      '/posts/publish-later/',
      '/posts/future-date-past-publish/',
      '/posts/expired/',
      '/posts/draft/',
    ])
      assert.equal(
        output.some((file) => file.includes(forbidden)),
        false,
      );
    assert.ok(output.some((file) => file.endsWith('/about/index.html')));
    for (const file of output) {
      const text = await readFile(file, 'utf8');
      assert.doesNotMatch(
        text,
        /FUTURE_MARKER|PUBLISH_LATER_MARKER|FUTURE_DATE_MARKER|EXPIRED_MARKER|DRAFT_MARKER|HIDDEN_RESOURCE_MARKER|HIDDEN_NESTED_MARKER/,
      );
    }
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('direct content input preserves UTF-8 BOM, CRLF, and body whitespace', async () => {
  const body = '\ufeff正文\r\n  trailing spaces  \r\n';
  const fixture = await createBoundarySite({
    name: 'raw-body',
    definition: {
      clock: '2026-09-10T00:00:00Z',
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/raw/index.md',
          source: `---\r\ntitle: Raw Body\r\ndate: 2026-09-09T00:00:00Z\r\n---\r\n${body}`,
        },
      ],
    },
  });
  try {
    const sourcePath = path.join(
      fixture.projectRoot,
      'content/posts/raw/index.md',
    );
    const source = await readFile(sourcePath, 'utf8');
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const rendered = await readFile(
      path.join(result.publicDir, 'posts/raw/index.html'),
      'utf8',
    );
    assert.match(rendered, /正文/);
    assert.equal(await readFile(sourcePath, 'utf8'), source);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('managed cleanup rejects source paths and symlink escapes while preserving files', async () => {
  const authorContent = await snapshotTree(path.join(root, 'content'));
  const fixture = await createBoundarySite({ name: 'cleanup' });
  const fixtureContent = await snapshotTree(
    path.join(fixture.projectRoot, 'content'),
  );
  const link = path.join(fixture.projectRoot, '.build', 'outside-link');
  try {
    await assert.rejects(
      removeGenerated(
        path.join(fixture.projectRoot, 'content'),
        fixture.projectRoot,
      ),
      /Refusing to remove unmanaged path/,
    );
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(path.join(root, 'content'), link);
    await assert.rejects(
      removeGenerated(link, fixture.projectRoot),
      /Refusing to remove unmanaged path/,
    );
    assert.deepEqual(
      await snapshotTree(path.join(fixture.projectRoot, 'content')),
      fixtureContent,
    );
    assert.deepEqual(
      await snapshotTree(path.join(root, 'content')),
      authorContent,
    );
  } finally {
    await unlink(link).catch(() => {});
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('real build rejects invalid frontmatter in an isolated fixture with path and field', async () => {
  const cases = [
    {
      name: 'invalid-date',
      field: 'date',
      source:
        '---\ntitle: Invalid Date\ndate: 2026-02-30T00:00:00Z\n---\nBody\n',
    },
    {
      name: 'reserved-false',
      field: '_night',
      source:
        '---\ntitle: Reserved False\ndate: 2026-09-09T00:00:00Z\n_night: false\n---\nBody\n',
    },
    {
      name: 'invalid-cover-position',
      field: 'cover_position',
      source:
        '---\ntitle: Invalid Cover\ndate: 2026-09-09T00:00:00Z\ncover_position: 101% 0%\n---\nBody\n',
    },
  ];
  for (const entry of cases) {
    const fixture = await createBoundarySite({
      name: entry.name,
      definition: {
        clock: '2026-09-10T00:00:00Z',
        content: [{ path: 'posts/invalid/index.md', source: entry.source }],
      },
    });
    try {
      await assert.rejects(
        buildSite({
          projectRoot: fixture.projectRoot,
          clock: fixture.clock,
        }),
        new RegExp(`posts/invalid/index\\.md: ${entry.field}`),
      );
    } finally {
      await removeBoundarySite(fixture.projectRoot);
    }
  }
});

test('tags isolate drafts, distinguish case, support Chinese, and PostView handles covers', async () => {
  const clock = '2026-09-10T00:00:00Z';
  const fixture = await createBoundarySite({
    name: 'tags-and-post-view',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/bundle-cover/index.md',
          source: [
            '---',
            'title: Bundle Cover Post',
            'date: 2026-09-09T16:00:00Z',
            'cover: bryce-canyon.jpg',
            'cover_alt: Bryce Canyon',
            'cover_position: 20% 80%',
            'tags:',
            '  - "  AI  "',
            '  - "AI"',
            '  - ""',
            '  - "   "',
            '  - "中文标签"',
            '---',
            'Bundle cover post content.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/missing-bundle-cover/index.md',
          source: [
            '---',
            'title: Missing Bundle Cover Post',
            'date: 2026-09-08T00:00:00Z',
            'lastmod: 2026-09-09T00:00:00Z',
            'cover: nonexistent-bundle-cover.jpg',
            'tags:',
            '  - "ai"',
            '  - "中文标签"',
            '---',
            'Missing bundle cover post content.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/static-cover/index.md',
          source: [
            '---',
            'title: Static Cover Post',
            'date: 2026-09-07T00:00:00Z',
            'cover: /logo.svg',
            'tags:',
            '  - "AI"',
            '---',
            'Static cover post content.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/missing-static-cover/index.md',
          source: [
            '---',
            'title: Missing Static Cover Post',
            'date: 2026-09-06T00:00:00Z',
            'cover: /missing-logo.png',
            'tags:',
            '  - "ai"',
            '---',
            'Missing static cover post content.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/https-cover/index.md',
          source: [
            '---',
            'title: HTTPS Cover Post',
            'date: 2026-09-05T00:00:00Z',
            'cover: https://images.example.com/photo.jpg',
            'tags:',
            '  - "https"',
            '---',
            'HTTPS cover post content.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/draft-post/index.md',
          source: [
            '---',
            'title: Draft Post',
            'date: 2026-09-04T00:00:00Z',
            'draft: true',
            'tags:',
            '  - "draft-only"',
            '  - "AI"',
            '---',
            'Draft post content.',
            '',
          ].join('\n'),
        },
      ],
    },
  });

  await cp(
    path.join(root, 'exampleSite/content/posts/post-3/bryce-canyon.jpg'),
    path.join(
      fixture.projectRoot,
      'content/posts/bundle-cover/bryce-canyon.jpg',
    ),
  );

  const sectionHtmlPath = path.join(
    fixture.projectRoot,
    'layouts/section.html',
  );
  await mkdir(path.dirname(sectionHtmlPath), { recursive: true });
  await writeFile(
    sectionHtmlPath,
    [
      '{{ define "main" }}',
      '{{ $context := partial "list/context.html" . }}',
      '<div id="views-data">',
      '{{ range $context.pages }}',
      '  {{ $view := partial "data/post-view.html" . }}',
      '  <div class="test-post-view" data-url="{{ $view.url }}">',
      '  {{ dict',
      '    "url" $view.url',
      '    "absoluteURL" $view.absoluteURL',
      '    "stableId" $view.stableId',
      '    "title" $view.title',
      '    "rank" $view.rank',
      '    "publishDate" $view.publishDate',
      '    "lastmod" $view.lastmod',
      '    "displayDate" $view.displayDate',
      '    "displayDateKind" $view.displayDateKind',
      '    "summaryText" $view.summaryText',
      '    "cardExcerpt" $view.cardExcerpt',
      '    "heroExcerpt" $view.heroExcerpt',
      '    "readingMinutes" $view.readingMinutes',
      '    "tags" $view.tags',
      '    "cover" $view.cover',
      '    "textCardExcerpt" $view.text.cardExcerpt',
      '  | jsonify }}',
      '  </div>',
      '{{ end }}',
      '</div>',
      '{{ end }}',
      '',
    ].join('\n'),
  );

  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const indexJson = await readJson(path.join(res.publicDir, 'index.json'));
    assert.equal(indexJson.posts.length, 5);

    const postsHtml = await readFile(
      path.join(res.publicDir, 'posts', 'index.html'),
      'utf8',
    );
    const $ = load(postsHtml);
    const viewsByUrl = new Map();
    $('.test-post-view').each((_, el) => {
      const url = $(el).attr('data-url');
      const data = JSON.parse($(el).text().trim());
      viewsByUrl.set(url, data);
    });

    assert.equal(viewsByUrl.size, 5);

    // 1. Bundle cover post & Shanghai timezone displayDate
    const bundleView = viewsByUrl.get('/posts/bundle-cover/');
    assert.ok(bundleView);
    assert.equal(bundleView.displayDate, '2026 / 09 / 10');
    assert.equal(bundleView.displayDateKind, 'published');
    assert.equal(bundleView.cover.width, 300);
    assert.equal(bundleView.cover.height, 200);
    assert.deepEqual(bundleView.cover.srcset, [
      '/posts/bundle-cover/bryce-canyon.jpg 300w',
    ]);
    assert.equal(bundleView.cover.position, '20% 80%');
    assert.equal(bundleView.cover.alt, 'Bryce Canyon');
    assert.equal(bundleView.stableId, hash('/posts/bundle-cover/'));
    assert.deepEqual(
      bundleView.tags.map((tag) => tag.label),
      ['AI', '中文标签'],
    );
    assert.equal(bundleView.textCardExcerpt, bundleView.cardExcerpt);

    // 2. Missing bundle cover post
    const missingBundleView = viewsByUrl.get('/posts/missing-bundle-cover/');
    assert.ok(missingBundleView);
    assert.equal(missingBundleView.displayDateKind, 'updated');
    assert.equal(missingBundleView.displayDate, '2026 / 09 / 09');
    assert.equal(missingBundleView.cover.url, '');
    assert.equal(missingBundleView.cover.width, 0);

    // 3. Static cover post
    const staticView = viewsByUrl.get('/posts/static-cover/');
    assert.ok(staticView);
    assert.equal(staticView.cover.url, '/logo.svg');
    assert.equal(
      staticView.cover.originalURL,
      'http://localhost:4173/logo.svg',
    );
    assert.deepEqual(staticView.cover.srcset, []);

    // 4. Missing static cover post
    const missingStaticView = viewsByUrl.get('/posts/missing-static-cover/');
    assert.ok(missingStaticView);
    assert.equal(missingStaticView.cover.url, '');

    // 5. HTTPS cover post
    const httpsView = viewsByUrl.get('/posts/https-cover/');
    assert.ok(httpsView);
    assert.equal(httpsView.cover.url, 'https://images.example.com/photo.jpg');

    // 6. Term routes and case-sensitivity assertions
    const keyAI = `t-${hash('AI')}`;
    const keyAi = `t-${hash('ai')}`;
    const keyZh = `t-${hash('中文标签')}`;
    const keyDraft = `t-${hash('draft-only')}`;

    const aiTerm = await readFile(
      path.join(res.publicDir, 'tags', keyAI, 'index.html'),
      'utf8',
    );
    assert.ok(aiTerm.includes('AI'));
    assert.ok(aiTerm.includes('/posts/bundle-cover/'));
    assert.ok(aiTerm.includes('/posts/static-cover/'));

    const aiLowerTerm = await readFile(
      path.join(res.publicDir, 'tags', keyAi, 'index.html'),
      'utf8',
    );
    assert.ok(aiLowerTerm.includes('ai'));
    assert.ok(aiLowerTerm.includes('/posts/missing-bundle-cover/'));
    assert.ok(aiLowerTerm.includes('/posts/missing-static-cover/'));

    const zhTerm = await readFile(
      path.join(res.publicDir, 'tags', keyZh, 'index.html'),
      'utf8',
    );
    assert.ok(zhTerm.includes('中文标签'));
    assert.ok(zhTerm.includes('/posts/bundle-cover/'));
    assert.ok(zhTerm.includes('/posts/missing-bundle-cover/'));

    // Draft-only tags must NOT produce a term output
    const outputFiles = await files(res.publicDir);
    assert.equal(
      outputFiles.some((file) => file.includes(`/tags/${keyDraft}/`)),
      false,
    );

    // No taxonomy overview or categories
    assert.equal(
      outputFiles.some((file) => file.endsWith('/tags/index.html')),
      false,
    );
    assert.equal(
      outputFiles.some((file) => file.includes('/categories/')),
      false,
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('two-pass text extraction handles description, more, code, image, emoji, and internal prepare isolation', async () => {
  const clock = '2026-09-10T00:00:00Z';
  const fixture = await createBoundarySite({
    name: 'two-pass-text',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/desc-post/index.md',
          source: [
            '---',
            'title: Description Post',
            'date: 2026-09-09T00:00:00Z',
            'description: Explicit custom description for post',
            '---',
            'Body text that should not become summary.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/more-post/index.md',
          source: [
            '---',
            'title: More Post',
            'date: 2026-09-08T00:00:00Z',
            '---',
            'Text before more divider.',
            '<!--more-->',
            'Text after more divider.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/code-post/index.md',
          source: [
            '---',
            'title: Code Leading Post',
            'date: 2026-09-07T00:00:00Z',
            '---',
            '```python',
            'def hello():',
            '    print("world")',
            '```',
            '',
            'Text after code block.',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/pure-image-post/index.md',
          source: [
            '---',
            'title: Pure Image Post',
            'date: 2026-09-06T00:00:00Z',
            '---',
            '![alt text](/logo.svg)',
            '',
          ].join('\n'),
        },
        {
          path: 'posts/emoji-long-post/index.md',
          source: [
            '---',
            'title: Emoji Long Post',
            'date: 2026-09-05T00:00:00Z',
            '---',
            `🌟🎉🚀 ${'中文测试内容以及非常长的段落用来验证Unicode截断是否会切坏字符或者超出限制'.repeat(5)}`,
            '',
          ].join('\n'),
        },
        {
          path: 'posts/empty-post/index.md',
          source: [
            '---',
            'title: Empty Post',
            'date: 2026-09-04T00:00:00Z',
            '---',
            '',
          ].join('\n'),
        },
      ],
    },
  });

  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const indexJson = await readJson(path.join(res.publicDir, 'index.json'));
    const postsByUrl = new Map(indexJson.posts.map((p) => [p.url, p]));

    // 1. Description post: description takes priority
    const descPost = postsByUrl.get('/posts/desc-post/');
    assert.equal(descPost.description, 'Explicit custom description for post');

    // 2. More post: only text before <!--more-->
    const morePost = postsByUrl.get('/posts/more-post/');
    assert.ok(morePost.description.includes('Text before more divider'));
    assert.equal(
      morePost.description.includes('Text after more divider'),
      false,
    );

    // 3. Code post: summary excludes code, search content retains code
    const codePost = postsByUrl.get('/posts/code-post/');
    assert.equal(codePost.description.includes('def hello'), false);
    assert.ok(codePost.description.includes('Text after code block'));
    assert.ok(codePost.content.includes('def hello'));

    // 4. Pure image post: empty summary
    const imgPost = postsByUrl.get('/posts/pure-image-post/');
    assert.equal(imgPost.description, '');

    // 5. Emoji long post in the rendered index: Unicode remains intact.
    const emojiPost = postsByUrl.get('/posts/emoji-long-post/');
    assert.ok(emojiPost.description.startsWith('🌟🎉🚀'));
    assert.equal(emojiPost.description.includes('�'), false);

    // 6. Empty post: empty strings
    const emptyPost = postsByUrl.get('/posts/empty-post/');
    assert.equal(emptyPost.description, '');
    assert.equal(emptyPost.description, '');

    // 7. Internal prepare files forbidden from entering public
    const publicFiles = await files(res.publicDir);
    assert.equal(
      publicFiles.some(
        (file) => file.includes('prepare.json') || file.includes('prepare/'),
      ),
      false,
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('pagination across 0, 1, 12, 13, 25 posts isolates independent pages and verifies canonicals', async () => {
  const clock = '2026-09-10T00:00:00Z';

  // 1. Build and verify 0-post site
  const zeroFixture = await createBoundarySite({
    name: 'page-count-0',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'about/index.md',
          source: '---\ntitle: About\ntype: about\n---\nAbout',
        },
        {
          path: 'friends/index.md',
          source: '---\ntitle: Friends\ntype: friends\n---\nFriends',
        },
      ],
    },
  });
  try {
    const res = await buildSite({
      projectRoot: zeroFixture.projectRoot,
      clock: zeroFixture.clock,
    });
    const index = await readJson(path.join(res.publicDir, 'index.json'));
    assert.equal(index.posts.length, 0);
    const homeHtml = await readFile(
      path.join(res.publicDir, 'index.html'),
      'utf8',
    );
    assert.ok(homeHtml.includes('暂无文章'));
  } finally {
    await removeBoundarySite(zeroFixture.projectRoot);
  }

  // 2. Build and verify 13-post site (tests 12 vs 13 boundary and page 2 canonical)
  const thirteenFixture = await createBoundarySite({
    name: 'page-count-13',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'about/index.md',
          source: '---\ntitle: About\ntype: about\n---\nAbout',
        },
        {
          path: 'friends/index.md',
          source: '---\ntitle: Friends\ntype: friends\n---\nFriends',
        },
        ...Array.from({ length: 13 }, (_, i) => ({
          path: `posts/post-${String(i).padStart(2, '0')}/index.md`,
          source: `---\ntitle: Post ${i}\ndate: 2026-09-09T00:00:00Z\n---\nBody ${i}\n`,
        })),
      ],
    },
  });

  try {
    const res = await buildSite({
      projectRoot: thirteenFixture.projectRoot,
      clock: thirteenFixture.clock,
    });
    const index = await readJson(path.join(res.publicDir, 'index.json'));
    assert.equal(index.posts.length, 13);
    assert.equal(
      index.posts.some(
        (p) => p.url.includes('/about/') || p.url.includes('/friends/'),
      ),
      false,
    );

    const parseHead = async (rel) => {
      const html = await readFile(path.join(res.publicDir, rel), 'utf8');
      const $ = load(html);
      return {
        title: $('title').text().replace(/\s+/g, ' ').trim(),
        canonical: $('link[rel="canonical"]').attr('href'),
        robots: $('meta[name="robots"]').attr('content'),
      };
    };

    // Home page 1
    const homeP1 = await parseHead('index.html');
    assert.equal(homeP1.title, 'BuGuLog');
    assert.equal(homeP1.canonical, 'http://localhost:4173/');

    // Home page 2
    const homeP2 = await parseHead('page/2/index.html');
    assert.equal(homeP2.title, '第 2 页 · BuGuLog');
    assert.equal(homeP2.canonical, 'http://localhost:4173/page/2/');

    // Posts page 1
    const postsP1 = await parseHead('posts/index.html');
    assert.equal(postsP1.title, 'Posts · BuGuLog');
    assert.equal(postsP1.canonical, 'http://localhost:4173/posts/');

    // Posts page 2
    const postsP2 = await parseHead('posts/page/2/index.html');
    assert.equal(postsP2.title, 'Posts · 第 2 页 · BuGuLog');
    assert.equal(postsP2.canonical, 'http://localhost:4173/posts/page/2/');

    // Independent pages
    const about = await parseHead('about/index.html');
    assert.equal(about.canonical, 'http://localhost:4173/about/');
    const friends = await parseHead('friends/index.html');
    assert.equal(friends.canonical, 'http://localhost:4173/friends/');

    // 404
    const notFound = await parseHead('404.html');
    assert.equal(notFound.canonical, undefined);
    assert.equal(notFound.robots, 'noindex');
  } finally {
    await removeBoundarySite(thirteenFixture.projectRoot);
  }
});

test('minimal shortcode fixture proves complete evaluation, idempotency across outputs, and clean search text', async () => {
  const clock = '2026-09-10T00:00:00Z';
  const fixture = await createBoundarySite({
    name: 'shortcode-idempotency',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/ref-post/index.md',
          source: [
            '---',
            'title: Reference Post',
            'date: 2026-09-09T00:00:00Z',
            '---',
            'Top citation {{< minref id="c1" text="Citation One" >}}.',
            '',
            'Middle citation {{< minref id="c2" text="Citation Two" >}}.',
            '',
            '{{< minnotes >}}',
            '',
            'Bottom citation {{< minref id="c1" text="Citation One Repeat" >}}.',
            '',
          ].join('\n'),
        },
      ],
      templates: [
        {
          path: 'layouts/_shortcodes/minref.html',
          source: [
            '{{- $id := .Get "id" -}}',
            '{{- $text := .Get "text" | default "" -}}',
            '{{- $key := printf "ref-%s" $id -}}',
            '{{- if not (.Page.Store.Get $key) -}}',
            '  {{- .Page.Store.Set $key (dict "id" $id "text" $text) -}}',
            '  {{- $order := .Page.Store.Get "refOrder" | default slice -}}',
            '  {{- .Page.Store.Set "refOrder" ($order | append $id) -}}',
            '{{- end -}}',
            '<sup class="min-ref" id="ref-anchor-{{ $id }}"><a href="#note-{{ $id }}">[{{ $id }}]</a></sup>',
          ].join('\n'),
        },
        {
          path: 'layouts/_shortcodes/minnotes.html',
          source: [
            '<div class="min-notes">',
            '{{- $order := .Page.Store.Get "refOrder" | default slice -}}',
            '{{- range $order -}}',
            '  {{- $item := $.Page.Store.Get (printf "ref-%s" .) -}}',
            '  <div class="note-row" id="note-{{ $item.id }}">',
            '    <span class="note-body">{{ $item.text }}</span>',
            '    <a href="#ref-anchor-{{ $item.id }}" class="footnote-backref" data-search-exclude>↩</a>',
            '  </div>',
            '{{- end -}}',
            '</div>',
          ].join('\n'),
        },
      ],
    },
  });

  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const html = await readFile(
      path.join(res.publicDir, 'posts/ref-post/index.html'),
      'utf8',
    );
    const indexJson = await readJson(path.join(res.publicDir, 'index.json'));
    const $ = load(html);
    const noteRows = $('.note-row');
    // Repeated shortcode calls across passes / multiple outputs do not duplicate registered note rows
    assert.equal(noteRows.length, 2);

    const postInIndex = indexJson.posts.find(
      (p) => p.url === '/posts/ref-post/',
    );
    assert.ok(postInIndex);
    // Note readable text preserved in search content
    assert.ok(postInIndex.content.includes('Citation One'));
    assert.ok(postInIndex.content.includes('Citation Two'));
    // Control backlink character stripped
    assert.equal(postInIndex.content.includes('↩'), false);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('continuous rebuild removes deleted content and preserves valid public on failure', async () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'failure-recovery',
    definition: {
      clock: clock.toISOString(),
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/post-a/index.md',
          source:
            '---\ntitle: Post A\ndate: 2026-09-09T00:00:00Z\n---\nPost A content\n',
        },
        {
          path: 'posts/post-b/index.md',
          source:
            '---\ntitle: Post B\ndate: 2026-09-09T00:00:00Z\n---\nPost B content\n',
        },
      ],
    },
  });

  try {
    // 1. Initial build: both posts exist in public output
    await buildSite({ projectRoot: fixture.projectRoot, clock });
    const postAHtml = path.join(
      fixture.projectRoot,
      'public/posts/post-a/index.html',
    );
    const postBHtml = path.join(
      fixture.projectRoot,
      'public/posts/post-b/index.html',
    );
    assert.ok(await readFile(postAHtml, 'utf8'));
    assert.ok(await readFile(postBHtml, 'utf8'));

    // 2. Remove post B and rebuild
    await unlink(
      path.join(fixture.projectRoot, 'content/posts/post-b/index.md'),
    );
    await buildSite({ projectRoot: fixture.projectRoot, clock });

    // 3. Post B must be removed from public
    assert.ok(await readFile(postAHtml, 'utf8'));
    const postBExists = await readFile(postBHtml, 'utf8').then(
      () => true,
      () => false,
    );
    assert.equal(
      postBExists,
      false,
      'Old post B must disappear from public output',
    );

    const validPublicSnapshot = await snapshotTree(
      path.join(fixture.projectRoot, 'public'),
    );
    // 4. Introduce build error in post A
    await writeFile(
      path.join(fixture.projectRoot, 'content/posts/post-a/index.md'),
      '---\ntitle: Bad Post\ndate: 2026-02-30T00:00:00Z\n---\nBroken\n',
    );

    // 5. Build fails
    await assert.rejects(
      buildSite({ projectRoot: fixture.projectRoot, clock }),
      /invalid date|datetime|timezone/i,
    );

    // 6. Public output remains preserved as a valid artifact
    const publicAfterFailure = await snapshotTree(
      path.join(fixture.projectRoot, 'public'),
    );
    assert.deepEqual(
      publicAfterFailure,
      validPublicSnapshot,
      'Public directory must be preserved on build failure',
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('buildId changes on every rebuild and is shared by page and search output', async () => {
  const clock1 = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'build-id-determinism',
    definition: {
      clock: clock1.toISOString(),
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/p1/index.md',
          source: '---\ntitle: P1\ndate: 2026-09-09T00:00:00Z\n---\nHello\n',
        },
      ],
    },
  });

  try {
    const res1 = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: clock1,
    });
    const firstIndex = await readJson(path.join(res1.publicDir, 'index.json'));
    const firstHome = await readFile(
      path.join(res1.publicDir, 'index.html'),
      'utf8',
    );
    assert.equal(firstIndex.buildId, res1.metadata.buildId);
    assert.equal(
      load(firstHome)('[data-post-list]').attr('data-build-id'),
      res1.metadata.buildId,
    );
    const res2 = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: clock1,
    });
    assert.notEqual(
      res1.metadata.buildId,
      res2.metadata.buildId,
      'Every rebuild must receive a new buildId',
    );
    const secondIndex = await readJson(path.join(res2.publicDir, 'index.json'));
    assert.equal(secondIndex.buildId, res2.metadata.buildId);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('validateOutput verifies schema, sitemap cross-check, missing targets, and catches leaked privacy markers', async () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'validate-output-suite',
    definition: {
      clock: clock.toISOString(),
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/p1/index.md',
          source: '---\ntitle: P1\ndate: 2026-09-09T00:00:00Z\n---\nValid Post',
        },
      ],
    },
  });

  try {
    const res = await buildSite({ projectRoot: fixture.projectRoot, clock });

    // 1. Normal validation passes
    const summary = await validateOutput(res.publicDir);
    assert.ok(summary.fileCount > 0);
    assert.equal(summary.postCount, 1);

    // 2. Forbidden marker scan passes when marker not present
    await validateOutput(res.publicDir, {
      forbiddenMarkers: ['NON_EXISTENT_SECRET_MARKER'],
    });

    // 3. Forbidden marker scan throws when marker present
    await writeFile(
      path.join(res.publicDir, 'leak.txt'),
      'This contains LEAKED_SECRET_XYZ',
    );
    await assert.rejects(
      validateOutput(res.publicDir, {
        forbiddenMarkers: ['LEAKED_SECRET_XYZ'],
      }),
      /Privacy violation/,
    );

    // 4. Missing required destination throws ENOENT
    await assert.rejects(validateOutput(fixture.projectRoot), /ENOENT/);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

// 6. Deployment base URL injection drives every absolute URL in the output
test('injected baseURL drives canonical, Open Graph, structured data, and sitemap URLs', async () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'injected-base-url',
    definition: {
      clock,
      content: [
        { path: '_index.md', source: '---\ntitle: Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Posts\n---\n' },
        {
          path: 'posts/hello/index.md',
          source: '---\ntitle: Hello\ndate: 2026-09-09T00:00:00Z\n---\nBody\n',
        },
      ],
    },
  });
  try {
    const res = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
      baseURL: 'https://example.com',
    });
    const $ = load(
      await readFile(path.join(res.publicDir, 'index.html'), 'utf8'),
    );
    assert.equal(
      $('link[rel="canonical"]').attr('href'),
      'https://example.com/',
    );
    assert.equal(
      $('meta[property="og:url"]').attr('content'),
      'https://example.com/',
    );
    const structuredData = JSON.parse(
      $('script[type="application/ld+json"]').first().text(),
    );
    assert.equal(structuredData[0].url, 'https://example.com/');

    const post = load(
      await readFile(
        path.join(res.publicDir, 'posts/hello/index.html'),
        'utf8',
      ),
    );
    assert.equal(
      post('link[rel="canonical"]').attr('href'),
      'https://example.com/posts/hello/',
    );

    const sitemap = await readFile(
      path.join(res.publicDir, 'sitemap.xml'),
      'utf8',
    );
    assert.ok(sitemap.includes('<loc>https://example.com/</loc>'));
    assert.equal(sitemap.includes('localhost'), false);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});
