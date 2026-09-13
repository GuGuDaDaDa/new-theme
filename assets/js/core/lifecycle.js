/** Idempotent browser component lifecycle. */

import { initHeader } from '../components/header.js';
import { initTheme } from '../components/theme.js';
import { initInputMode } from './input-mode.js';
import { initReadingMedia } from '../components/reading-media.js';
import { initSearch } from '../components/search.js';

const instances = new WeakMap();

/**
 * Initialize core page components without allowing one failure to block others.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initPage(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const cleanups = [];
  const pending = [];
  if (root.querySelector('[data-lightbox]')) {
    try {
      cleanups.push(initReadingMedia(root));
    } catch (error) {
      console.error('Night Theme image initialization failed.', error);
    }
  }
  if (root.querySelector('[data-photo-stack]')) {
    let disposed = false;
    let photosCleanup = () => {};
    pending.push(
      import('../components/photo-stack.js')
        .then(({ initPhotoStacks }) => {
          if (!disposed) photosCleanup = initPhotoStacks(root);
        })
        .catch((error) => {
          console.error('Night Theme photo wall initialization failed.', error);
        }),
    );
    cleanups.push(() => {
      disposed = true;
      photosCleanup();
    });
  }
  if (root.querySelector('[data-toc]')) {
    let disposed = false;
    let tocCleanup = () => {};
    pending.push(
      import('../components/toc.js')
        .then(({ initToc }) => {
          if (!disposed) tocCleanup = initToc(root);
        })
        .catch((error) => {
          console.error(
            'Night Theme table of contents initialization failed.',
            error,
          );
        }),
    );
    cleanups.push(() => {
      disposed = true;
      tocCleanup();
    });
  }
  if (root.querySelector('[data-post-list], [data-article-back]')) {
    let disposed = false;
    let restoreCleanup = () => {};
    pending.push(
      import('../components/restore.js')
        .then(({ initRestore }) => {
          if (!disposed) {
            restoreCleanup = initRestore(root);
            return restoreCleanup.ready;
          }
        })
        .catch((error) => {
          console.error(
            'Night Theme list restoration initialization failed.',
            error,
          );
        }),
    );
    cleanups.push(() => {
      disposed = true;
      restoreCleanup();
    });
  }
  if (root.querySelector('[data-hero]')) {
    let disposed = false;
    let heroCleanup = () => {};
    pending.push(
      import('../components/hero.js')
        .then(({ initHero }) => {
          if (!disposed) heroCleanup = initHero(root);
        })
        .catch((error) => {
          console.error('Night Theme hero initialization failed.', error);
        }),
    );
    cleanups.push(() => {
      disposed = true;
      heroCleanup();
    });
  }
  for (const [selector, loader] of [
    [
      '[data-reference]',
      () =>
        import('../components/references.js').then(
          (module) => module.initReferences,
        ),
    ],
    [
      '[data-ai-warning]',
      () =>
        import('../components/notices.js').then((module) => module.initNotices),
    ],
    [
      '[data-spoiler]',
      () =>
        import('../components/spoiler.js').then(
          (module) => module.initSpoilers,
        ),
    ],
    [
      '[data-comments]',
      () =>
        import('../components/comments.js').then(
          (module) => module.initComments,
        ),
    ],
  ]) {
    if (!root.querySelector(selector)) continue;
    let disposed = false;
    let componentCleanup = () => {};
    pending.push(
      loader()
        .then((initialize) => {
          if (!disposed) componentCleanup = initialize(root);
        })
        .catch((error) => {
          console.error(
            'Night Theme reading extension initialization failed.',
            error,
          );
        }),
    );
    cleanups.push(() => {
      disposed = true;
      componentCleanup();
    });
  }
  root.documentElement.dataset.js = 'ready';

  const cleanup = () => {
    for (const dispose of cleanups.reverse()) dispose();
    instances.delete(root);
  };
  cleanup.ready = Promise.all(pending);
  instances.set(root, cleanup);
  return cleanup;
}

/** Initialize persistent document controls once. @param {Document} root - Site document. @returns {() => void} Cleanup. */
export function initShell(root) {
  const cleanups = [];
  for (const initializer of [
    initInputMode,
    initTheme,
    initHeader,
    initSearch,
  ]) {
    try {
      cleanups.push(initializer(root));
    } catch (error) {
      console.error('Night Theme component initialization failed.', error);
    }
  }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
