/** Shared native modal ownership, dismissal, and focus restoration. */
const instances = new WeakMap();
const active = new WeakMap();

/**
 * Bind a dialog once; native showModal supplies focus containment and Escape.
 * @param {HTMLDialogElement} dialog - Modal element.
 * @returns {{open: (trigger: HTMLElement, focus?: HTMLElement) => void, close: () => void, cleanup: () => void}} Modal controls.
 */
export function initDialog(dialog) {
  if (instances.has(dialog)) return instances.get(dialog);
  const root = dialog.ownerDocument;
  const controller = new AbortController();
  const { signal } = controller;
  let trigger;
  let outside = false;
  /** Restore a connected entry point after closing. @returns {void} */
  function restore() {
    if (active.get(root) !== api) return;
    active.delete(root);
    const target = trigger?.isConnected ? trigger : root.querySelector('#main');
    target?.focus({ preventScroll: true });
  }
  /** Close synchronously so another modal can take ownership. @returns {void} */
  function close() {
    if (!dialog.open) return;
    dialog.close();
    restore();
  }
  /**
   * Determine whether a pointer is outside the dialog content box.
   * @param {PointerEvent} event - Pointer coordinates.
   * @returns {boolean} Whether the point is outside.
   */
  function isOutside(event) {
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }
  dialog.addEventListener(
    'pointerdown',
    (event) => {
      outside = event.button === 0 && isOutside(event);
    },
    { signal },
  );
  dialog.addEventListener(
    'pointerup',
    (event) => {
      if (outside && isOutside(event)) close();
      outside = false;
    },
    { signal },
  );
  dialog.addEventListener(
    'pointercancel',
    () => {
      outside = false;
    },
    { signal },
  );
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener(
    'close',
    () => {
      if (!dialog.open) restore();
    },
    { signal },
  );
  dialog
    .querySelector('[data-dialog-close]')
    .addEventListener('click', close, { signal });
  const api = {
    /**
     * Open this modal and transfer focus from its entry point.
     * @param {HTMLElement} entry - Trigger to restore on dismissal.
     * @param {HTMLElement} [focus] - Initial focus target.
     * @returns {void}
     */
    open(entry, focus = dialog.querySelector('[data-dialog-close]')) {
      const previous = active.get(root);
      if (previous && previous !== api) previous.close();
      trigger = entry;
      active.set(root, api);
      if (!dialog.open) dialog.showModal();
      focus.focus({ preventScroll: true });
    },
    close,
    /** Dispose all bindings and close the modal. @returns {void} */
    cleanup() {
      close();
      controller.abort();
      instances.delete(dialog);
    },
  };
  instances.set(dialog, api);
  return api;
}
