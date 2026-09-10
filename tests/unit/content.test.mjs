/** Public-content, parsing, sorting, and text extraction regression tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContent,
  isPublic,
  normalizeTags,
  comparePosts,
  selectPublicPages,
  timestamp,
  validateFrontmatter,
} from '../../scripts/prepare-content.mjs';
import { cleanText, excerpt } from '../../scripts/build.mjs';

test('public predicate excludes drafts, either future date, and expiry boundary', () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const published = { date: '2026-09-09T00:00:00Z' };
  assert.equal(isPublic(published, clock), true);
  assert.equal(isPublic({ ...published, draft: true }, clock), false);
  assert.equal(
    isPublic({ ...published, publishDate: '2026-09-11T00:00:00Z' }, clock),
    false,
  );
  assert.equal(
    isPublic(
      { date: '2026-09-11T00:00:00Z', publishDate: published.date },
      clock,
    ),
    false,
  );
  assert.equal(
    isPublic({ ...published, expiryDate: clock.toISOString() }, clock),
    false,
  );
  assert.equal(isPublic({ date: clock.toISOString() }, clock), true);
  assert.equal(
    isPublic(
      {
        date: '2026-09-09T00:00:00Z',
        publishDate: '2026-09-09T00:00:01Z',
        expiryDate: '2026-09-10T00:00:01Z',
      },
      clock,
    ),
    true,
  );
  assert.equal(
    isPublic(
      {
        date: '2026-09-09T00:00:00Z',
        publishDate: '2026-09-09T00:00:01Z',
        expiryDate: '2026-09-10T00:00:00Z',
      },
      clock,
    ),
    false,
  );
});

test('public selection handles empty and populated collections without ranking independent pages', () => {
  const makePage = (relative, options = {}) => ({
    relative,
    public: options.public ?? true,
    post: options.post ?? relative.startsWith('posts/'),
    day: options.day ?? '2026-09-10',
    created: options.created ?? new Date('2026-09-10T00:00:00Z'),
  });
  for (const count of [0, 1, 12, 13, 25]) {
    const pages = Array.from({ length: count }, (_, index) =>
      makePage(`posts/post-${String(index).padStart(2, '0')}/index.md`),
    );
    pages.push(makePage('about/index.md', { post: false }));
    pages.push(
      makePage('posts/private/index.md', { post: true, public: false }),
    );
    const selected = selectPublicPages(pages);
    assert.equal(selected.posts.length, count);
    assert.ok(
      selected.visible.some((page) => page.relative === 'about/index.md'),
    );
    assert.equal(
      selected.posts.some((page) => page.relative === 'about/index.md'),
      false,
    );
    assert.deepEqual(selected.excludedBundles, ['posts/private/']);
  }
});

test('public post ordering uses Shanghai day, created instant, then POSIX path', () => {
  const pages = [
    {
      relative: 'posts/z/index.md',
      public: true,
      post: true,
      day: '2026-09-10',
      created: new Date('2026-09-10T00:00:01Z'),
    },
    {
      relative: 'posts/a/index.md',
      public: true,
      post: true,
      day: '2026-09-10',
      created: new Date('2026-09-10T00:00:02Z'),
    },
    {
      relative: 'posts/b/index.md',
      public: true,
      post: true,
      day: '2026-09-10',
      created: new Date('2026-09-10T00:00:02Z'),
    },
    {
      relative: 'posts/newer-day/index.md',
      public: true,
      post: true,
      day: '2026-09-11',
      created: new Date('2026-09-09T00:00:00Z'),
    },
  ];
  assert.deepEqual(
    selectPublicPages(pages).posts.map((page) => page.relative),
    [
      'posts/newer-day/index.md',
      'posts/a/index.md',
      'posts/b/index.md',
      'posts/z/index.md',
    ],
  );
});
test('TOML and YAML frontmatter preserve Markdown and reject local dates', () => {
  for (const source of [
    '+++\ntitle="Hello"\ndate=2026-09-09T00:00:00Z\n+++\n\nBody',
    '---\ntitle: Hello\ndate: 2026-09-09T00:00:00Z\n---\n\nBody',
  ]) {
    const page = parseContent(source);
    assert.equal(page.data.title, 'Hello');
    assert.equal(page.content, '\nBody');
    assert.ok(isPublic(page.data, new Date('2026-09-10T00:00:00Z')));
  }
  assert.throws(() => isPublic({ date: '2026-09-09' }, new Date()), /timezone/);
});
test('frontmatter validation supports YAML, TOML, and JSON with raw body bytes', () => {
  const body = '\ufeff正文\r\n  trailing spaces  \r\n';
  const sources = [
    [
      'yaml',
      `---\r\ntitle: YAML\r\ndate: 2026-09-09T00:00:00+08:00\r\n---\r\n${body}`,
    ],
    [
      'toml',
      `+++\r\ntitle = "TOML"\r\ndate = 2026-09-09T00:00:00+08:00\r\n+++\r\n${body}`,
    ],
    [
      'json',
      `---json\r\n{"title":"JSON","date":"2026-09-09T00:00:00+08:00"}\r\n---\r\n${body}`,
    ],
    [
      'json',
      `{\r\n  "title": "Native JSON",\r\n  "date": "2026-09-09T00:00:00+08:00"\r\n}\r\n${body}`,
    ],
  ];
  for (const [format, source] of sources) {
    const page = parseContent(source);
    assert.equal(page.format, format);
    validateFrontmatter(page.data, 'posts/example/index.md', {
      post: true,
      source,
      format: page.format,
    });
    assert.equal(page.content, body);
    assert.equal(page.data.cover_position, '50% 50%');
    assert.deepEqual(page.data.tags, []);
    assert.equal(page.data.featured, false);
    assert.equal(page.data.draft, false);
    assert.equal(page.data.toc, true);
    assert.equal(page.data.created, page.data.date);
    assert.equal(page.data.publishDate, page.data.date);
  }
});
test('frontmatter validation reports field paths and rejects invalid values', () => {
  const invalid = [
    ['title', { title: 1 }],
    ['date', { title: 'x', date: '2026-02-30T00:00:00Z' }],
    ['featured', { title: 'x', featured: 'false' }],
    ['draft', { title: 'x', draft: null }],
    ['toc', { title: 'x', toc: 1 }],
    ['description', { title: 'x', description: false }],
    ['tags', { title: 'x', tags: ['ok', 1] }],
    ['cover_position', { title: 'x', cover_position: '101% 0%' }],
    ['_night', { title: 'x', _night: false }],
  ];
  for (const [field, data] of invalid)
    assert.throws(
      () =>
        validateFrontmatter(
          { title: 'x', date: '2026-09-09T00:00:00Z', ...data },
          'posts/bad/index.md',
          { post: true },
        ),
      new RegExp(`posts/bad/index\\.md: ${field}`),
    );
  assert.throws(
    () =>
      validateFrontmatter({ date: '2026-09-09' }, 'posts/missing.md', {
        post: true,
      }),
    /posts\/missing\.md: title/,
  );
  assert.throws(
    () =>
      validateFrontmatter({ title: 'x' }, 'posts/missing-date.md', {
        post: true,
      }),
    /posts\/missing-date\.md: date/,
  );
});
test('timestamps reject impossible calendar values and machine-local dates', () => {
  for (const value of [
    '2026-02-30T00:00:00Z',
    '2026-09-09T25:00:00Z',
    '2026-09-09T00:00:00',
    '2026-09-09',
  ])
    assert.throws(() => timestamp(value, 'posts/date.md: date'), /timezone/);
  const toml = parseContent(
    '+++\ntitle="x"\ndate=2026-02-30T00:00:00Z\n+++\nBody',
  );
  assert.throws(
    () =>
      validateFrontmatter(toml.data, 'posts/toml-invalid/index.md', {
        post: true,
        source: toml.source,
        format: toml.format,
      }),
    /posts\/toml-invalid\/index\.md: date/,
  );
  const quotedKey = parseContent(
    '+++\ntitle="x"\n"date"=2026-02-30T00:00:00Z\n+++\nBody',
  );
  assert.throws(
    () =>
      validateFrontmatter(quotedKey.data, 'posts/toml-quoted/index.md', {
        post: true,
        source: quotedKey.source,
        format: quotedKey.format,
      }),
    /posts\/toml-quoted\/index\.md: date/,
  );
  const escapedKey = parseContent(
    '+++\ntitle="x"\n"\\u0064ate"=2026-02-30T00:00:00Z\n+++\nBody',
  );
  assert.throws(
    () =>
      validateFrontmatter(escapedKey.data, 'posts/toml-escaped/index.md', {
        post: true,
        source: escapedKey.source,
        format: escapedKey.format,
      }),
    /posts\/toml-escaped\/index\.md: date/,
  );
  const multiline = parseContent(
    '+++\ntitle="x"\ndescription="""\n[metadata]\ndate = 2026-02-30T00:00:00Z\n"""\ndate=2026-09-09T00:00:00Z\n+++\nBody',
  );
  assert.doesNotThrow(() =>
    validateFrontmatter(multiline.data, 'posts/toml-multiline/index.md', {
      post: true,
      source: multiline.source,
      format: multiline.format,
    }),
  );
  const escapedTriple = [
    '+++',
    'title="x"',
    'description="""',
    '\\"""',
    'date=2026-09-09T00:00:00Z',
    '"""',
    'date=2026-02-30T00:00:00Z',
    '+++',
    'Body',
  ].join('\n');
  const escapedTriplePage = parseContent(escapedTriple);
  assert.throws(
    () =>
      validateFrontmatter(
        escapedTriplePage.data,
        'posts/toml-escaped-triple/index.md',
        {
          post: true,
          source: escapedTriplePage.source,
          format: escapedTriplePage.format,
        },
      ),
    /posts\/toml-escaped-triple\/index\.md: date/,
  );
});
test('tags are case sensitive and same-day order follows created', () => {
  assert.deepEqual(
    normalizeTags(['  AI  ', 'AI', 'ai', '', '   ', '\t', '中文']),
    ['AI', 'ai', '中文'],
  );
  assert.throws(() => normalizeTags('not-an-array'), /array of strings/);
  assert.throws(() => normalizeTags(['valid', 123]), /array of strings/);
  const posts = [
    { day: '2026-09-10', created: 1, relative: 'b' },
    { day: '2026-09-10', created: 2, relative: 'c' },
    { day: '2026-09-10', created: 1, relative: 'a' },
  ];
  assert.deepEqual(
    posts.sort(comparePosts).map((post) => post.relative),
    ['c', 'a', 'b'],
  );
});

test('frontmatter validates cover_position format and coordinates', () => {
  for (const position of ['0% 0%', '100% 100%', '50% 50%', '20.5% 80.2%']) {
    assert.doesNotThrow(() =>
      validateFrontmatter(
        { title: 'x', date: '2026-09-09T00:00:00Z', cover_position: position },
        'posts/valid-cover/index.md',
        { post: true },
      ),
    );
  }
  for (const position of [
    '101% 0%',
    '0% -1%',
    '50%',
    '50% 50% 50%',
    'top left',
    123,
  ]) {
    assert.throws(
      () =>
        validateFrontmatter(
          {
            title: 'x',
            date: '2026-09-09T00:00:00Z',
            cover_position: position,
          },
          'posts/invalid-cover/index.md',
          { post: true },
        ),
      /posts\/invalid-cover\/index\.md: cover_position/,
    );
  }
});
test('text cleaning removes control text and excerpts preserve Unicode', () => {
  // UI control stripping
  assert.equal(
    cleanText(
      '<script>alert(1)</script><style>body{color:red}</style><p>正文</p><button>下一张</button><nav>导航</nav><span class="footnote-backref">↩</span><div data-search-exclude>忽略</div><pre>code</pre>',
      true,
    ),
    '正文',
  );
  // Summary excludes code, full text keeps code
  assert.equal(
    cleanText('<pre><code>def foo(): pass</code></pre><p>正文</p>', true),
    '正文',
  );
  assert.equal(
    cleanText('<pre><code>def foo(): pass</code></pre><p>正文</p>'),
    'def foo(): pass 正文',
  );
  // Pure image returns empty string
  assert.equal(cleanText('<p><img src="/img.jpg" alt="test"></p>', true), '');
  assert.equal(cleanText(''), '');
  // Unicode excerpts with emojis
  assert.equal(excerpt('😀测试文本', 3), '😀测…');
  assert.equal(excerpt('😀测试文本', 5), '😀测试文本');
  assert.equal(excerpt('', 110), '');
  const longText = '🌟' + '字'.repeat(120);
  const card = excerpt(longText, 110);
  assert.equal(Array.from(card).length, 110);
  assert.ok(card.endsWith('…'));
  assert.ok(card.startsWith('🌟'));
  const hero = excerpt(longText, 60);
  assert.equal(Array.from(hero).length, 60);
  assert.ok(hero.endsWith('…'));
});
