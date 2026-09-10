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
  root.documentElement.dataset.js = 'ready';

  const cleanup = () => {
    for (const dispose of cleanups.reverse()) dispose();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
