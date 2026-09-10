/** Minimal bootstrap shared by future component initializers. */
/**
 * Mark the document as ready for progressive enhancement.
 * @param {Document} root - Current document.
 * @returns {void}
 */
export function init(root) {
  root.documentElement.dataset.js = 'ready';
}
