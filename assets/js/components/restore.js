/** Per-history-entry list restoration and same-window article provenance. */
import { internalPath, listRoute, nextListPath } from '../core/url.js';
import { readSession, writeSession, saveList } from '../core/storage.js';
import { initPagination } from './pagination.js';
import { initMasonry } from './masonry.js';

/**
 * Merge theme metadata without overwriting other history namespaces.
 * @param {object} value - Theme state.
 * @returns {boolean} Whether history accepted the update.
 */
function replaceNight(value) {
  try {
    history.replaceState({ ...history.state, night: value }, '');
    return true;
  } catch {
    return false;
  }
}

/**
 * Obtain a browsing-context marker that is not cloned with sessionStorage.
 * @returns {string} Current window identity.
 */
function windowMarker() {
  if (!window.name.startsWith('night-tab:'))
    window.name = `night-tab:${crypto.randomUUID()}`;
  return window.name;
}

/**
 * Validate persisted metadata before using it for navigation or restoration.
 * @param {object|null} value - Untrusted stored snapshot.
 * @returns {boolean} Whether the schema and consecutive list range are valid.
 */
function validSnapshot(value) {
  if (
    !value ||
    value.schema !== 1 ||
    typeof value.entryId !== 'string' ||
    typeof value.buildId !== 'string' ||
    typeof value.listId !== 'string' ||
    typeof value.url !== 'string' ||
    !listRoute(value.url, location.href) ||
    !Array.isArray(value.pages) ||
    value.pages[0] !== value.url ||
    !Number.isFinite(value.scrollY) ||
    value.scrollY < 0 ||
    !Number.isFinite(value.anchorOffset) ||
    (value.anchorUrl !== null &&
      (typeof value.anchorUrl !== 'string' ||
        !internalPath(value.anchorUrl, location.href)))
  )
    return false;
  try {
    for (let index = 1; index < value.pages.length; index += 1) {
      nextListPath(value.pages[index], value.pages[index - 1], location.href);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the masonry read/write frames and pending font metrics.
 * @returns {Promise<void>} Layout opportunity.
 */
async function settleLayout() {
  await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ),
  );
}

/**
 * Enhance a list's pagination, provenance capture, and position restoration.
 * @param {HTMLElement} list - Current list.
 * @param {string} marker - Current browsing-context identity.
 * @returns {() => void} Cleanup.
 */
function initList(list, marker) {
  const pagination = initPagination(list);
  const events = new AbortController();
  const status = list.querySelector('[data-list-status]');
  let disposed = false;
  let restoring = false;
  let restoreGeneration = 0;
  let interrupted = false;
  let timer;
  let anchorUrl = null;
  let anchorOffset = 0;
  const fallback = readSession('night:return');
  writeSession('night:return', null);
  const previous = history.state?.night;
  const candidate =
    fallback?.window === marker && fallback.url === location.pathname
      ? readSession(`night:list:${fallback.entryId}`)
      : previous?.window === marker
        ? readSession(`night:list:${previous.entryId}`) || previous
        : null;
  const saved =
    validSnapshot(candidate) &&
    candidate.url === location.pathname &&
    candidate.listId === list.dataset.listId
      ? candidate
      : null;
  if (saved) list.ownerDocument.documentElement.dataset.entry = 'restore';
  const entryId =
    saved && previous?.window === marker && previous.entryId === saved.entryId
      ? saved.entryId
      : crypto.randomUUID();
  let restoreTarget = saved;
  if (saved) {
    anchorUrl = saved.anchorUrl;
    anchorOffset = saved.anchorOffset;
  }

  /** Find the current anchor without interpolating its URL into a selector. @returns {HTMLElement|undefined} */
  function anchorCard() {
    return [...list.querySelectorAll('.post[data-post-url]')].find(
      (card) => internalPath(card.dataset.postUrl, location.href) === anchorUrl,
    );
  }

  /** Save URL/position metadata only, never card HTML. @returns {object} */
  function snapshot() {
    const card = anchorCard();
    if (card) anchorOffset = card.getBoundingClientRect().top;
    const value = {
      schema: 1,
      entryId,
      window: marker,
      buildId: list.dataset.buildId,
      listId: list.dataset.listId,
      url: location.pathname,
      pages: [...pagination.pages],
      scrollY: Math.max(0, window.scrollY),
      anchorUrl,
      anchorOffset,
    };
    saveList(value);
    replaceNight(value);
    return value;
  }

  /**
   * Restore focus and position unless the reader or page lifecycle cancels it.
   * @param {number} generation - Restoration lifetime at invocation.
   * @returns {Promise<void>} Positioning completion.
   */
  async function position(generation) {
    initMasonry(list.querySelector('[data-cards]'));
    await settleLayout();
    if (disposed || interrupted || generation !== restoreGeneration) return;
    const card = anchorCard();
    card?.focus({ preventScroll: true });
    const top = card
      ? window.scrollY +
        card.getBoundingClientRect().top -
        restoreTarget.anchorOffset
      : restoreTarget.scrollY;
    window.scrollTo({
      top: Math.max(
        0,
        Math.min(top, document.documentElement.scrollHeight - innerHeight),
      ),
      behavior: 'instant',
    });
  }

  /** Replay missing pages before restoring the original entry. @returns {Promise<void>} */
  async function restore() {
    if (!restoreTarget || restoring) return;
    restoring = true;
    const generation = restoreGeneration;
    const originalRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    list.dataset.restoring = '';
    let complete = true;
    try {
      if (restoreTarget.buildId !== list.dataset.buildId) {
        status.textContent = '内容已更新，已保留当前列表，请刷新后继续浏览。';
      } else {
        for (const page of restoreTarget.pages.slice(pagination.pages.length)) {
          if (disposed || generation !== restoreGeneration) break;
          if (pagination.next !== page || !(await pagination.load(true))) {
            complete = false;
            break;
          }
        }
      }
      if (generation === restoreGeneration) await position(generation);
    } finally {
      restoring = false;
      delete list.dataset.restoring;
      history.scrollRestoration = originalRestoration;
      if (generation === restoreGeneration) {
        if (complete) restoreTarget = null;
        if (!disposed) snapshot();
      }
    }
  }

  /**
   * Record only a normal same-tab navigation to an actual rendered article.
   * @param {string} target - Article path.
   * @returns {void}
   */
  function remember(target) {
    anchorUrl = internalPath(target, location.href);
    const value = snapshot();
    writeSession('night:navigation', {
      schema: 1,
      window: marker,
      target: anchorUrl,
      from: value,
      sourceKey: window.navigation?.currentEntry?.key || null,
    });
  }

  list.addEventListener(
    'night:article-open',
    (event) => remember(event.detail.url),
    { signal: events.signal },
  );
  document.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target.closest('a[href]');
      if (
        !link ||
        link.hasAttribute('download') ||
        (link.target && link.target !== '_self')
      )
        return;
      const path = internalPath(link.href, location.href);
      const isArticle =
        [...list.querySelectorAll('[data-post-url]')].some(
          (card) => internalPath(card.dataset.postUrl, location.href) === path,
        ) ||
        link.matches(
          '[data-hero] a, .hero-panel a, [data-hero] [data-hero-link]',
        );
      if (path && isArticle) remember(path);
    },
    { signal: events.signal },
  );

  /** Stop automatic correction as soon as the user takes control. @returns {void} */
  function interrupt() {
    interrupted = true;
  }
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, interrupt, {
      passive: true,
      signal: events.signal,
    });
  }
  window.addEventListener(
    'scroll',
    () => {
      if (restoring || timer) return;
      timer = setTimeout(() => {
        timer = null;
        snapshot();
      }, 150);
    },
    { passive: true, signal: events.signal },
  );
  list.addEventListener(
    'night:page-loaded',
    () => {
      if (restoring) return;
      if (restoreTarget)
        void restore().catch((error) => {
          status.textContent = error.message;
        });
      else snapshot();
    },
    { signal: events.signal },
  );
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      restoreGeneration += 1;
      clearTimeout(timer);
      timer = null;
      if (!restoring) snapshot();
    },
    { signal: events.signal },
  );
  window.addEventListener(
    'pageshow',
    (event) => {
      disposed = false;
      if (event.persisted) {
        interrupted = false;
        anchorCard()?.focus({ preventScroll: true });
      }
    },
    { signal: events.signal },
  );
  if (saved)
    void restore().catch((error) => {
      status.textContent = error.message;
    });
  else snapshot();
  return () => {
    disposed = true;
    restoreGeneration += 1;
    clearTimeout(timer);
    events.abort();
    pagination.cleanup();
  };
}

/**
 * Consume a one-shot source token, preserving trusted provenance on refresh.
 * @param {HTMLAnchorElement} back - Real article return link.
 * @param {string} marker - Current browsing-context identity.
 * @returns {() => void} Cleanup.
 */
function initArticle(back, marker) {
  const token = readSession('night:navigation');
  writeSession('night:navigation', null);
  let source = history.state?.night;
  if (
    token?.schema === 1 &&
    token.window === marker &&
    token.target === location.pathname &&
    validSnapshot(token.from)
  ) {
    source = {
      schema: 1,
      window: marker,
      article: location.pathname,
      from: token.from,
      sourceKey: token.sourceKey,
    };
    replaceNight(source);
  }
  if (
    source?.schema !== 1 ||
    source.window !== marker ||
    source.article !== location.pathname ||
    !validSnapshot(source.from)
  )
    return () => {};
  back.href = source.from.url;
  const controller = new AbortController();
  back.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const entries = window.navigation?.entries();
      const current = window.navigation?.currentEntry;
      const prior =
        current && entries?.find((entry) => entry.index === current.index - 1);
      if (
        source.sourceKey &&
        prior?.key === source.sourceKey &&
        internalPath(prior.url, location.href) === source.from.url
      ) {
        event.preventDefault();
        history.back();
      } else {
        saveList(source.from);
        writeSession('night:return', {
          window: marker,
          url: source.from.url,
          entryId: source.from.entryId,
        });
      }
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

/**
 * Initialize only the current list or article's restoration behavior.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup.
 */
export function initRestore(root) {
  const marker = windowMarker();
  const list = root.querySelector('[data-post-list]');
  if (list) return initList(list, marker);
  const back = root.querySelector('[data-article-back]');
  return back ? initArticle(back, marker) : () => {};
}
