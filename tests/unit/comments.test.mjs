/** Restricted comment Markdown and OwO emoji parsing regression tests. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarkdownRenderer,
  escapeHTML,
  setAllowedImages,
} from '../../assets/js/components/comments-markdown.js';
import {
  EMOJI_PAGE_SIZE,
  emojiImageURL,
  emojiImageURLs,
  emojiInsertText,
  parseEmojiPacks,
} from '../../assets/js/components/comments-emoji.js';

const base = 'https://blog.example.test/posts/example/';

/** Build a renderer with one permitted image emoticon. @returns {(text: string) => string} Renderer. */
function rendererWithAllowedImage() {
  setAllowedImages(['https://cdn.example.test/emoji/one.png']);
  return createMarkdownRenderer(base);
}

test('escapeHTML neutralizes markup characters', () => {
  assert.equal(escapeHTML(`<a & "b' >`), '&lt;a &amp; &quot;b&#39; &gt;');
});

test('markdown keeps raw HTML inert and drops unsafe link destinations', () => {
  const render = rendererWithAllowedImage();

  const raw = render('<img src=x onerror=alert(1)>');
  assert.equal(raw.includes('<img'), false);
  assert.match(raw, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const script = render('<script>alert(1)</script>');
  assert.equal(script.includes('<script'), false);
  assert.match(script, /&lt;script&gt;/);

  const unsafe = render('[label](javascript:alert(1))');
  assert.equal(unsafe.includes('<a'), false);
  assert.match(unsafe, /label/);
});

test('markdown resolves safe links and renders the approved formatting scope', () => {
  const render = rendererWithAllowedImage();

  const link = render('[ok](https://example.com)');
  assert.match(
    link,
    /<a href="https:\/\/example\.com\/" target="_blank" rel="ugc nofollow noopener noreferrer">ok<\/a>/,
  );

  const relative = render('[rel](/posts/other/)');
  assert.match(
    relative,
    /href="https:\/\/blog\.example\.test\/posts\/other\/"/,
  );

  assert.match(render('**bold**'), /<strong>bold<\/strong>/);
  assert.match(render('> quote'), /<blockquote>/);
  assert.match(render('`code`'), /<code>code<\/code>/);
});

test('markdown collapses out-of-scope blocks into plain text', () => {
  const render = rendererWithAllowedImage();

  assert.equal(render('# Heading').trim(), '<p>Heading</p>');
  assert.equal(render('~~gone~~').trim(), '<p>~~gone~~</p>');
  assert.equal(render('---').trim(), '<p>---</p>');
  assert.equal(
    render('| a | b |\n| - | - |\n| 1 | 2 |').trim(),
    '<p>| a | b |\n| - | - |\n| 1 | 2 |</p>',
  );
  assert.match(render('- [x] done'), /\[x\] done/);
  assert.equal(render('- [x] done').includes('checkbox'), false);
});

test('markdown renders only configured image emoticons', () => {
  const render = rendererWithAllowedImage();

  const allowed = render('![one](https://cdn.example.test/emoji/one.png)');
  assert.match(
    allowed,
    /<img class="comment-emoji" src="https:\/\/cdn\.example\.test\/emoji\/one\.png" alt="one" width="28" height="28">/,
  );

  const foreign = render('![two](https://cdn.example.test/emoji/two.png)');
  assert.equal(foreign.includes('<img'), false);
  assert.match(
    foreign,
    /!\[two\]\(https:\/\/cdn\.example\.test\/emoji\/two\.png\)/,
  );
});

test('setAllowedImages replaces the permit list between documents', () => {
  setAllowedImages(['https://cdn.example.test/emoji/one.png']);
  const first = createMarkdownRenderer(base);
  assert.equal(
    first('![one](https://cdn.example.test/emoji/one.png)').includes('<img'),
    true,
  );

  setAllowedImages(['https://cdn.other.test/emoji/two.png']);
  const second = createMarkdownRenderer(base);
  assert.equal(
    second('![one](https://cdn.example.test/emoji/one.png)').includes('<img'),
    false,
  );
  assert.equal(
    second('![two](https://cdn.other.test/emoji/two.png)').includes('<img'),
    true,
  );
});

const owoPayload = {
  Paimon: {
    type: 'image',
    container: [
      { text: 'one', icon: '<img src="https://cdn.example.test/e/one.png">' },
      { text: 'two', icon: "<img src='https://cdn.example.test/e/two.png'>" },
      {
        text: 'three',
        icon: '<img src=https://cdn.example.test/e/three.png />',
      },
      { text: 'unsafe', icon: '<img src="javascript:alert(1)">' },
      { text: 'relative', icon: '<img src="/e/four.png">' },
      { hint: 'no icon' },
    ],
  },
  颜文字: { type: 'emoticon', container: [{ text: '笑', icon: '(>_<)' }] },
  broken: 'not a pack',
  empty: { type: 'image', container: [] },
};

test('parseEmojiPacks keeps usable packs in file order and filters invalid entries', () => {
  const packs = parseEmojiPacks(owoPayload);
  assert.deepEqual(Object.keys(packs), ['Paimon', '颜文字']);
  assert.equal(packs.Paimon.type, 'image');
  assert.equal(packs.颜文字.type, 'emoticon');
  assert.equal(packs.Paimon.container.length, 5);

  assert.deepEqual(parseEmojiPacks(null), {});
  assert.deepEqual(parseEmojiPacks([]), {});
  assert.deepEqual(parseEmojiPacks('text'), {});
});

test('parseEmojiPacks defaults unknown pack types to emoticon', () => {
  const packs = parseEmojiPacks({
    defaulted: { container: [{ text: 'a', icon: 'x' }] },
  });
  assert.equal(packs.defaulted.type, 'emoticon');
});

test('emojiImageURL extracts every src quoting style and rejects unusable sources', () => {
  const [one, two, three, unsafe, relative, missing] =
    parseEmojiPacks(owoPayload).Paimon.container;
  assert.equal(emojiImageURL(one, base), 'https://cdn.example.test/e/one.png');
  assert.equal(emojiImageURL(two, base), 'https://cdn.example.test/e/two.png');
  assert.equal(
    emojiImageURL(three, base),
    'https://cdn.example.test/e/three.png',
  );
  assert.equal(emojiImageURL(unsafe, base), '');
  assert.equal(
    emojiImageURL(relative, base),
    'https://blog.example.test/e/four.png',
  );
  assert.equal(emojiImageURL(missing, base), '');
  assert.equal(emojiImageURL(undefined, base), '');
});

test('emojiImageURLs collects image packs only', () => {
  const urls = emojiImageURLs(parseEmojiPacks(owoPayload), base);
  assert.deepEqual(urls, [
    'https://cdn.example.test/e/one.png',
    'https://cdn.example.test/e/two.png',
    'https://cdn.example.test/e/three.png',
    'https://blog.example.test/e/four.png',
  ]);
});

test('emojiInsertText writes escaped Markdown image text and rejects unusable entries', () => {
  const item = {
    text: 'a[b]\\c',
    icon: '<img src="https://cdn.example.test/e/one.png">',
  };
  assert.equal(
    emojiInsertText(item, base, '图片表情'),
    '![a\\[b\\]\\\\c](<https://cdn.example.test/e/one.png>)',
  );
  assert.equal(
    emojiInsertText(
      { text: '', icon: '<img src="https://cdn.example.test/e/one.png">' },
      base,
      '图片表情',
    ),
    '![图片表情](<https://cdn.example.test/e/one.png>)',
  );
  assert.equal(emojiInsertText({ icon: 'plain' }, base, 'x'), '');
  assert.equal(emojiInsertText(undefined, base, 'x'), '');
});

test('emoji panel paginates packs by the exported page size', () => {
  assert.equal(EMOJI_PAGE_SIZE, 24);
  const container = Array.from({ length: 30 }, (_, index) => ({
    text: `item-${index}`,
    icon: `<img src="https://cdn.example.test/e/${index}.png">`,
  }));
  const packs = parseEmojiPacks({ big: { type: 'image', container } });
  const items = packs.big.container;
  assert.equal(items.slice(0, EMOJI_PAGE_SIZE).length, 24);
  assert.equal(items.slice(EMOJI_PAGE_SIZE).length, 6);
  assert.equal(Math.max(1, Math.ceil(items.length / EMOJI_PAGE_SIZE)), 2);
});
