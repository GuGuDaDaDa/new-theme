/** Progressive same-document navigation over Hugo's complete HTML pages. */
import { initDialog } from './dialog.js';
import { t } from './i18n.js';
import { readSession, writeSession } from './storage.js';

let visit;

/** Navigate a whole-card entry, retaining native navigation before enhancement. @param {string} url - Destination. @returns {void} */
export function navigate(url) {
  if (visit) void visit(new URL(url, location.href));
  else location.assign(url);
}

/** Initialize the persistent navigation controller. @param {Document} root - Site document. @param {Function} initPage - Page initializer returning cleanup with ready. @param {Function} initialPage - Initial page cleanup. @returns {void} */
export function initNavigation(root, initPage, initialPage) {
  const build = root.querySelector('meta[name="night-build"]').content;
  const base = root.querySelector('meta[name="night-base"]').content;
  const bar = root.querySelector('[data-navigation-progress]');
  const status = root.querySelector('[data-navigation-status]');
  let page = initialPage;
  let currentURL = new URL(location.href);
  let request;
  let progressTimer;
  let hideTimer;
  let interrupted = false;
  let hashSource;
  let currentEntry = history.state?.nightNavigation || entry(currentURL);
  history.replaceState({ ...history.state, nightNavigation: currentEntry }, '');
  history.scrollRestoration = 'manual';

  /** Create a history entry without inheriting page-specific state. @param {URL} url - Destination. @returns {object} Entry metadata. */
  function entry(url) {
    return {
      schema: 1,
      entryId: crypto.randomUUID(),
      url: url.href,
      scrollX: 0,
      scrollY: 0,
      fromEntryId: null,
    };
  }

  /** Save the displayed page only while its history entry is current. @returns {void} */
  function save() {
    currentEntry = { ...currentEntry, scrollX: scrollX, scrollY: scrollY };
    if (history.state?.nightNavigation?.entryId === currentEntry.entryId) {
      history.replaceState(
        { ...history.state, nightNavigation: currentEntry },
        '',
      );
    }
  }

  /** Set the visual estimate; no numeric progress is announced. @param {number} value - Fraction. @returns {void} */
  function progress(value) {
    bar.style.setProperty('--navigation-progress', value);
  }

  /** Complete the latest loading indicator. @returns {void} */
  function finish() {
    clearInterval(progressTimer);
    root.querySelector('#main').removeAttribute('aria-busy');
    progress(1);
    status.textContent = t('navigation.complete');
    hideTimer = setTimeout(() => {
      bar.hidden = true;
    }, 150);
  }

  /** Only enhance local HTML routes within this Hugo site. @param {URL} url - Candidate. @returns {boolean} Eligibility. */
  function eligible(url) {
    return (
      url.origin === location.origin &&
      url.pathname.startsWith(base) &&
      (url.pathname.endsWith('/') ||
        /\.html$/.test(url.pathname) ||
        !url.pathname.split('/').pop().includes('.'))
    );
  }

  /** Fetch and commit the latest destination while keeping the old page visible. @param {URL} url - Destination. @param {object|null} targetEntry - Existing history entry on traversal. @returns {Promise<void>} Completion. */
  async function load(url, targetEntry = null) {
    if (!eligible(url)) {
      location.assign(url.href);
      return;
    }
    request?.abort();
    const controller = new AbortController();
    request = controller;
    clearInterval(progressTimer);
    clearTimeout(hideTimer);
    bar.hidden = false;
    let amount = 0.12;
    progress(amount);
    status.textContent = t('navigation.loading');
    root.querySelector('#main').setAttribute('aria-busy', 'true');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced)
      progressTimer = setInterval(() => {
        amount += (0.9 - amount) * 0.12;
        progress(amount);
      }, 300);
    const timeout = setTimeout(
      () => controller.abort(new Error('Navigation timed out.')),
      15000,
    );
    interrupted = false;
    try {
      const response = await fetch(url.href, { signal: controller.signal });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('text/html')
      )
        throw new Error('Invalid navigation response.');
      const finalURL = new URL(response.url);
      if (!eligible(finalURL)) throw new Error('Navigation left site.');
      finalURL.hash = url.hash;
      const incoming = new DOMParser().parseFromString(
        await response.text(),
        'text/html',
      );
      const main = incoming.querySelector('main#main');
      if (
        !main ||
        incoming.querySelector('meta[name="night-build"]')?.content !== build
      )
        throw new Error('Navigation build changed.');
      if (request !== controller || controller.signal.aborted) return;
      clearTimeout(timeout);
      const token = readSession('night:navigation');
      if (token && token.target !== finalURL.pathname)
        writeSession('night:navigation', null);
      root.dispatchEvent(new Event('night:before-navigation'));
      if (!targetEntry) save();
      for (const dialog of root.querySelectorAll('dialog[open]'))
        initDialog(dialog).close();
      page();
      const previousEntry = currentEntry;
      if (targetEntry) {
        currentEntry = targetEntry;
        history.replaceState(
          { ...history.state, nightNavigation: currentEntry },
          '',
          finalURL.href,
        );
      } else {
        currentEntry = {
          ...entry(finalURL),
          fromEntryId: previousEntry.entryId,
        };
        history.pushState({ nightNavigation: currentEntry }, '', finalURL.href);
      }
      currentURL = finalURL;
      root.documentElement.dataset.entry = 'navigation';
      root.body.className = incoming.body.className;
      for (const script of main.querySelectorAll(
        'script:not([type="application/json"]):not([type="application/ld+json"])',
      ))
        script.remove();
      root.querySelector('#main').replaceWith(root.importNode(main, true));
      for (const node of root.head.querySelectorAll('[data-page-meta]'))
        node.remove();
      for (const node of incoming.head.querySelectorAll('[data-page-meta]'))
        root.head.append(root.importNode(node, true));
      root.querySelector('#main').setAttribute('aria-busy', 'true');
      if (!targetEntry)
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      root.dispatchEvent(new Event('night:page-ready'));
      page = initPage(root);
      await page.ready;
      if (request !== controller || controller.signal.aborted) return;
      if (!interrupted && root.documentElement.dataset.entry !== 'restore') {
        const anchor = finalURL.hash
          ? root.getElementById(decodeURIComponent(finalURL.hash.slice(1)))
          : null;
        const focus = anchor || root.querySelector('#main');
        if (!focus.hasAttribute('tabindex'))
          focus.setAttribute('tabindex', '-1');
        focus.focus({ preventScroll: true });
        if (anchor) anchor.scrollIntoView({ behavior: 'instant' });
        else
          window.scrollTo({
            left: targetEntry?.scrollX || 0,
            top: targetEntry?.scrollY || 0,
            behavior: 'instant',
          });
      }
      root.dispatchEvent(new Event('night:page-ready'));
      save();
      finish();
    } catch {
      if (request === controller) {
        clearInterval(progressTimer);
        bar.hidden = true;
        root.querySelector('#main').removeAttribute('aria-busy');
        location.assign(url.href);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  visit = load;
  root.documentElement.dataset.navigation = 'ready';

  window.addEventListener('click', (event) => {
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
    const url = new URL(link.href);
    if (!eligible(url)) return;
    if (
      url.pathname === currentURL.pathname &&
      url.search === currentURL.search
    ) {
      if (url.hash !== currentURL.hash) {
        save();
        hashSource = history.state;
      }
      return;
    }
    event.preventDefault();
    void load(url);
  });
  window.addEventListener('popstate', (event) => {
    const url = new URL(location.href);
    if (
      url.pathname === currentURL.pathname &&
      url.search === currentURL.search
    ) {
      request?.abort();
      request = null;
      clearInterval(progressTimer);
      clearTimeout(hideTimer);
      bar.hidden = true;
      root.querySelector('#main').removeAttribute('aria-busy');
      currentURL = url;
      currentEntry = event.state?.nightNavigation || entry(url);
      if (!event.state?.nightNavigation && hashSource) {
        history.replaceState(
          { ...hashSource, nightNavigation: currentEntry },
          '',
        );
      }
      hashSource = null;
      const anchor = url.hash
        ? root.getElementById(decodeURIComponent(url.hash.slice(1)))
        : null;
      if (anchor) anchor.scrollIntoView({ behavior: 'instant' });
      else
        window.scrollTo({
          top: currentEntry.scrollY,
          left: currentEntry.scrollX,
          behavior: 'instant',
        });
      return;
    }
    void load(url, event.state?.nightNavigation || entry(url));
  });
  window.addEventListener(
    'scroll',
    () => {
      if (!request || !root.querySelector('#main').hasAttribute('aria-busy'))
        save();
    },
    { passive: true },
  );
  window.addEventListener('pagehide', () => {
    save();
    const pending = request;
    request = null;
    pending?.abort();
    clearInterval(progressTimer);
    clearTimeout(hideTimer);
    bar.hidden = true;
    root.querySelector('#main').removeAttribute('aria-busy');
  });
  window.addEventListener('pageshow', () => {
    history.scrollRestoration = 'manual';
  });
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.defaultPrevented) interrupted = true;
      },
      { passive: true },
    );
  }
}
