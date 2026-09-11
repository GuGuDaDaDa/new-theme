/** Idempotent browser component lifecycle. */

import { initHeader } from '../components/header.js';
import { initTheme } from '../components/theme.js';
import { initInputMode } from './input-mode.js';

const instances = new WeakMap();

/**
 * Initialize core page components without allowing one failure to block others.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function init(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const cleanups = [];
  for (const initializer of [initInputMode, initTheme, initHeader]) {
    try {
      cleanups.push(initializer(root));
    } catch (error) {
      console.error('Night Theme component initialization failed.', error);
    }
  }
  if (root.querySelector('[data-post-list]')) {
    let disposed = false;
    const listCleanups = [];
    import('../components/card.js')
      .then(({ initCards }) => {
        if (!disposed) listCleanups.push(initCards(root));
      })
      .catch((error) => {
        console.error('Night Theme card initialization failed.', error);
      });
    import('../components/masonry.js')
      .then(({ initMasonry }) => {
        if (!disposed) listCleanups.push(initMasonry(root));
      })
      .catch((error) => {
        console.error('Night Theme masonry initialization failed.', error);
      });
    cleanups.push(() => {
      disposed = true;
      for (const dispose of listCleanups.reverse()) dispose();
    });
  }
  if (root.querySelector('[data-hero]')) {
    let disposed = false;
    let heroCleanup = () => {};
    import('../components/hero.js')
      .then(({ initHero }) => {
        if (!disposed) heroCleanup = initHero(root);
      })
      .catch((error) => {
        console.error('Night Theme hero initialization failed.', error);
      });
    cleanups.push(() => {
      disposed = true;
      heroCleanup();
    });
  }
  root.documentElement.dataset.js = 'ready';

  const cleanup = () => {
    for (const dispose of cleanups.reverse()) dispose();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
