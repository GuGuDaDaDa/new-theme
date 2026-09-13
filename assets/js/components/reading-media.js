/** Lightweight image entry points; original-image rendering is loaded on demand. */
import { initDialog } from '../core/dialog.js';
import { t } from '../core/i18n.js';

const instances = new WeakMap();

/**
 * Bind image enhancement and cancellable lazy lightbox loading.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initReadingMedia(root) {
  if (instances.has(root)) return instances.get(root);
  const dialog = root.querySelector('[data-lightbox-dialog]');
  const modal = initDialog(dialog);
  const controller = new AbortController();
  const { signal } = controller;
  const status = dialog.querySelector('[data-lightbox-status]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  const original = dialog.querySelector('[data-lightbox-original]');
  let request = 0;
  let disposeImage = () => {};
  /** Invalidate any import or image still in flight. @returns {void} */
  function cancel() {
    request += 1;
    disposeImage();
    disposeImage = () => {};
  }
  dialog.addEventListener(
    'close',
    () => {
      if (!dialog.open) cancel();
    },
    { signal },
  );
  window.addEventListener(
    'pagehide',
    () => {
      cancel();
      modal.close();
    },
    { signal },
  );
  root.addEventListener(
    'click',
    async (event) => {
      const trigger = event.target.closest('a[data-lightbox]');
      if (
        !trigger ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        trigger.target === '_blank' ||
        trigger.hasAttribute('download')
      )
        return;
      const url = new URL(trigger.href);
      if (
        url.protocol !== 'https:' &&
        !(url.origin === location.origin && url.protocol === 'http:')
      )
        return;
      event.preventDefault();
      cancel();
      const current = request;
      const img = trigger.querySelector('img');
      caption.textContent = trigger.dataset.caption || img?.alt || '';
      caption.hidden = !caption.textContent;
      original.href = url.href;
      status.textContent = t('lightbox.loading');
      modal.open(trigger);
      dialog.setAttribute('data-lightbox-opening', '');
      try {
        const { initLightbox } = await import('./lightbox.js');
        if (request !== current || !dialog.open) return;
        disposeImage = initLightbox(dialog, {
          url: trigger.dataset.lightboxSrc || url.href,
          alt: img?.alt || caption.textContent,
          source: img,
        });
      } catch {
        if (request === current && dialog.open) {
          dialog.removeAttribute('data-lightbox-opening');
          status.textContent = t('lightbox.unavailable');
        }
      }
    },
    { signal },
  );
  root.querySelectorAll('[data-article-image]').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', () => img.classList.add('image-loaded'), {
        once: true,
        signal,
      });
    }
  });
  const cleanup = () => {
    cancel();
    controller.abort();
    modal.cleanup();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
