/** Prove isolated roots, fixed clocks, and managed fixture cleanup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { buildSite } from '../../scripts/build.mjs';
import {
  createBoundarySite,
  removeBoundarySite,
  snapshotTree,
} from '../helpers/site.mjs';
import { files, readJson, removeGenerated, root } from '../../scripts/lib.mjs';

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
    assert.ok(
      result.finalConfig.startsWith(`${fixture.projectRoot}/.generated/`),
    );
    assert.ok(
      result.prepareDestination.startsWith(`${fixture.projectRoot}/.build/`),
    );
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
        /FUTURE_MARKER|PUBLISH_LATER_MARKER|EXPIRED_MARKER|DRAFT_MARKER|HIDDEN_RESOURCE_MARKER|HIDDEN_NESTED_MARKER/,
      );
    }
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('prepare output preserves UTF-8 BOM, CRLF, and body whitespace', async () => {
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
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const generated = await readFile(
      path.join(result.projectRoot, '.generated/content/posts/raw/index.md'),
      'utf8',
    );
    assert.ok(generated.endsWith(body));
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
