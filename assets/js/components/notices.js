/** Per-instance, nonpersistent enhancement for author-written AI notices. */
const instances = new WeakMap();

/**
 * Reveal dismiss controls only after their handlers have been installed.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initNotices(root) {
  if (instances.has(root)) return instances.get(root);
  const controller = new AbortController();
  const notices = [...root.querySelectorAll('[data-ai-warning]')];
  for (const notice of notices) {
    const button = notice.querySelector('[data-notice-close]');
    button.addEventListener(
      'click',
      () => {
        const article = notice.closest('[data-article-body]');
        if (article) {
          article.setAttribute('tabindex', '-1');
          article.focus({ preventScroll: true });
        }
        notice.hidden = true;
      },
      { signal: controller.signal },
    );
    button.hidden = false;
  }
  const cleanup = () => {
    controller.abort();
    for (const notice of notices) {
      notice.hidden = false;
      notice.querySelector('[data-notice-close]').hidden = true;
    }
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
