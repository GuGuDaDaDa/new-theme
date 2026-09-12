import { initDialog } from '../core/dialog.js';
let indexPromise;
/** Initialize the search dialog. @param {Document} root @returns {() => void} */
export function initSearch(root) {
  const triggers = root.querySelectorAll('[data-search-trigger]');
  const dialog = root.querySelector('[data-search-dialog]');
  if (!triggers.length || !dialog) return () => {};
  const modal = initDialog(dialog);
  const input = dialog.querySelector('[data-search-input]');
  const form = dialog.querySelector('[data-search-form]');
  const status = dialog.querySelector('[data-search-status]');
  const results = dialog.querySelector('[data-search-results]');
  const more = dialog.querySelector('[data-search-more]');
  const controller = new AbortController();
  const { signal } = controller;
  let matches = [];
  let shown = 0;
  let sequence = 0;

  /**
   * Load Fuse and the search index once, retrying after a failed attempt.
   * @returns {Promise<{Fuse: any, data: any}>} Search dependency.
   */
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = Promise.all([
        import('fuse.js'),
        fetch('/index.json', { signal }).then((r) => {
          if (!r.ok) throw new Error('index');
          return r.json();
        }),
      ]).then(([m, data]) => ({ Fuse: m.default, data }));
      indexPromise.catch(() => {
        indexPromise = undefined;
      });
    }
    return indexPromise;
  }

  /**
   * Render the currently visible portion of the result window.
   * @param {string} value - Query that produced the matches.
   * @returns {void}
   */
  function paint(value) {
    results.replaceChildren();
    matches.slice(0, shown).forEach((item) => {
      const li = root.createElement('li');
      const link = root.createElement('a');
      link.href = item.url;
      const title = root.createElement('strong');
      title.textContent = item.title;
      const date = root.createElement('time');
      date.textContent = item.displayDate || '';
      const excerpt = root.createElement('p');
      excerpt.textContent = item.description || item.content.slice(0, 120);
      link.append(title, date, excerpt);
      li.append(link);
      results.append(li);
    });
    status.textContent = !value
      ? '请输入搜索关键词'
      : matches.length
        ? `找到 ${matches.length} 条结果`
        : '未找到相关内容';
    more.hidden = shown >= matches.length;
  }

  /**
   * Rank posts for a query and paint the first result window.
   * @param {string} value - Trimmed query.
   * @param {number} token - Query sequence used to discard stale responses.
   * @returns {Promise<void>} Completion.
   */
  async function search(value, token) {
    if (!value) {
      matches = [];
      shown = 0;
      paint('');
      return;
    }
    status.textContent = '正在搜索…';
    try {
      const { Fuse, data } = await loadIndex();
      if (token !== sequence) return;
      const q = value.toLocaleLowerCase();
      const exact = data.posts.filter((p) => p.title.toLocaleLowerCase() === q);
      const contains = data.posts.filter(
        (p) => p.title.toLocaleLowerCase().includes(q) && !exact.includes(p),
      );
      const fuse = new Fuse(data.posts, {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.35,
        keys: [
          { name: 'title', weight: 0.4 },
          { name: 'tags', weight: 0.3 },
          { name: 'description', weight: 0.2 },
          { name: 'content', weight: 0.1 },
        ],
      });
      const ranked = fuse
        .search(value)
        .map((e) => e.item)
        .filter((p) => !exact.includes(p) && !contains.includes(p));
      matches = [...exact, ...contains, ...ranked];
      shown = Math.min(20, matches.length);
      paint(value);
    } catch {
      if (token === sequence) {
        status.textContent = '搜索失败，请重试';
        more.hidden = true;
      }
    }
  }
  triggers.forEach((trigger) => {
    trigger.addEventListener(
      'click',
      () => {
        modal.open(trigger, input);
        input.select();
      },
      { signal },
    );
  });
  form.addEventListener('submit', (e) => e.preventDefault(), { signal });
  input.addEventListener(
    'input',
    () => {
      const token = ++sequence;
      clearTimeout(input._searchTimer);
      input._searchTimer = setTimeout(
        () => search(input.value.trim(), token),
        150,
      );
    },
    { signal },
  );
  more.addEventListener(
    'click',
    () => {
      shown = Math.min(shown + 20, matches.length);
      paint(input.value.trim());
    },
    { signal },
  );
  return () => {
    clearTimeout(input._searchTimer);
    controller.abort();
    modal.cleanup();
  };
}
