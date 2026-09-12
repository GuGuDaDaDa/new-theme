/** Incremental, validated HTML pagination using the server-rendered cards. */
import { internalPath, listRoute, nextListPath } from '../core/url.js';
import { t } from '../core/i18n.js';
import { initCards } from './card.js';
import { initMasonry } from './masonry.js';

/**
 * Enhance a list while retaining real pagination links as fallback.
 * @param {HTMLElement} list - Server-rendered list.
 * @returns {object} Pagination controller and committed page range.
 */
export function initPagination(list) {
  const base = location.href;
  const cards = list.querySelector('[data-cards]');
  const status = list.querySelector('[data-list-status]');
  const nextLink = list.querySelector('[data-next]');
  const button = list.querySelector('[data-load-more]');
  const end = list.querySelector('[data-list-end]');
  const pages = [location.pathname];
  let next = nextLink ? nextListPath(nextLink.href, pages[0], base) : null;
  let state = next ? 'idle' : 'exhausted';
  let request;
  let disposed = false;
  const cleanups = [initCards(cards), initMasonry(cards)];
  const events = new AbortController();

  /** Update controls without removing the focused button. @returns {void} */
  function render() {
    list.dataset.loadState = state;
    if (button) {
      button.hidden = !nextLink;
      button.disabled = state === 'loading';
      button.setAttribute('aria-disabled', String(state === 'exhausted'));
      button.textContent =
        state === 'loading'
          ? t('pagination.loading')
          : state === 'error'
            ? t('pagination.retry')
            : state === 'exhausted'
              ? t('pagination.allShown')
              : t('pagination.loadMore');
    }
    if (end) end.hidden = Boolean(nextLink);
    if (nextLink) {
      nextLink.hidden = state !== 'error';
      if (next) nextLink.href = next;
      nextLink.textContent = t('pagination.directNext');
    }
  }

  /**
   * Request and append one consecutive page; failed requests commit nothing.
   * @param {boolean} restoring - Whether to suppress entry animation.
   * @returns {Promise<boolean>} Whether the page was committed.
   */
  async function load(restoring = false) {
    if (disposed || state === 'loading' || !next) return false;
    state = 'loading';
    render();
    status.textContent = t('pagination.loading');
    const target = next;
    const controller = new AbortController();
    request = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(target, {
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok || internalPath(response.url, base) !== target)
        throw new Error(t('pagination.error.load'));
      const html = new DOMParser().parseFromString(
        await response.text(),
        'text/html',
      );
      const incoming = html.querySelector('[data-post-list]');
      if (!incoming || incoming.dataset.listId !== list.dataset.listId)
        throw new Error(t('pagination.error.invalid'));
      if (incoming.dataset.buildId !== list.dataset.buildId)
        throw new Error(t('pagination.error.stale'));
      if (Number(incoming.dataset.page) !== listRoute(target, base).page)
        throw new Error(t('pagination.error.page'));
      const container = incoming.querySelector('[data-cards]');
      const nodes = container ? [...container.children] : [];
      if (
        !nodes.length ||
        nodes.some((node) => !node.matches('.post[data-post-url][id]'))
      )
        throw new Error(t('pagination.error.invalid'));
      const following = incoming.querySelector('[data-next]');
      const followingURL = following
        ? nextListPath(following.getAttribute('href'), target, base)
        : null;
      const seen = new Set(
        [...cards.children].map((node) =>
          internalPath(node.dataset.postUrl, base),
        ),
      );
      const added = [];
      for (const node of nodes) {
        const url = internalPath(node.dataset.postUrl, base);
        if (!url || !url.startsWith('/posts/') || listRoute(url, base))
          throw new Error(t('pagination.error.url'));
        if (
          node.querySelector('script, iframe, object, embed, base') ||
          [...node.querySelectorAll('*'), node].some((element) =>
            [...element.attributes].some(
              (attribute) =>
                /^on/i.test(attribute.name) ||
                (['href', 'src', 'xlink:href'].includes(attribute.name) &&
                  !['http:', 'https:'].includes(
                    new URL(attribute.value, base).protocol,
                  )),
            ),
          )
        )
          throw new Error(t('pagination.error.unsafe'));
        if (seen.has(url)) continue;
        seen.add(url);
        const card = document.importNode(node, true);
        if (!restoring) card.classList.add('post-enter');
        added.push(card);
      }
      if (disposed || controller.signal.aborted || request !== controller)
        return false;
      cards.append(...added);
      for (const card of added) cleanups.push(initCards(card));
      initMasonry(cards);
      pages.push(target);
      next = followingURL;
      state = next ? 'idle' : 'exhausted';
      status.textContent = `${t('pagination.added', { Count: added.length })}${next ? '' : '，' + t('pagination.allShown')}。`;
      list.dispatchEvent(new CustomEvent('night:page-loaded'));
      return true;
    } catch (error) {
      if (!disposed && request === controller) {
        state = 'error';
        status.textContent = controller.signal.aborted
          ? t('pagination.error.timeout')
          : error.message;
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (!disposed && request === controller) render();
    }
  }

  button?.addEventListener(
    'click',
    () => {
      void load();
    },
    { signal: events.signal },
  );
  /** Suspend requests when leaving, including entry into bfcache. @returns {void} */
  function suspend() {
    disposed = true;
    request?.abort();
    request = null;
    if (state === 'loading') {
      state = 'idle';
      status.textContent = '';
    }
  }
  window.addEventListener('pagehide', suspend, { signal: events.signal });
  window.addEventListener(
    'pageshow',
    () => {
      disposed = false;
      render();
    },
    { signal: events.signal },
  );
  render();
  return {
    pages,
    load,
    /** Pending validated page path. @returns {string|null} */
    get next() {
      return next;
    },
    /** Release listeners and enhancements. @returns {void} */
    cleanup() {
      suspend();
      events.abort();
      for (const cleanup of cleanups.reverse()) cleanup();
      if (nextLink) {
        nextLink.hidden = !next;
        nextLink.textContent = t('pagination.next');
      }
      if (button) button.hidden = true;
      if (end) end.hidden = Boolean(next);
    },
  };
}
