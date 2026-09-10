/** Track whether the latest page interaction came from pointer or keyboard. */

const instances = new WeakMap();

/**
 * Initialize input-mode tracking once for a document.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initInputMode(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const controller = new AbortController();
  const { signal } = controller;
  root.addEventListener(
    'pointerdown',
    () => {
      root.documentElement.dataset.inputMode = 'pointer';
    },
    { capture: true, signal },
  );
  root.addEventListener(
    'keydown',
    () => {
      root.documentElement.dataset.inputMode = 'keyboard';
    },
    { capture: true, signal },
  );

  const cleanup = () => {
    controller.abort();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
