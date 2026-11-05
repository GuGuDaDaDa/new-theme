/** Lightweight image entry points and synchronous lightbox open transition. */
import { initDialog } from '../core/dialog.js';
import { initLightbox } from './lightbox.js';

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
  const content = dialog.querySelector('[data-lightbox-content]');
  const status = dialog.querySelector('[data-lightbox-status]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  let disposeImage = () => {};
  /** Invalidate any image still in flight. @returns {void} */
  function cancel() {
    disposeImage();
    disposeImage = () => {};
    dialog.removeAttribute('data-lightbox-loading');
    dialog.removeAttribute('data-lightbox-opening');
    dialog.removeAttribute('data-lightbox-flying');
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
    (event) => {
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
      const img = trigger.querySelector('img');
      const width =
        Number(img?.getAttribute('width')) || img?.naturalWidth || 960;
      const height =
        Number(img?.getAttribute('height')) || img?.naturalHeight || 600;
      content.replaceChildren();
      dialog.style.setProperty('--lightbox-w', String(width));
      dialog.style.setProperty('--lightbox-h', String(height));
      caption.textContent = trigger.dataset.caption || img?.alt || '';
      caption.hidden = !caption.textContent;
      status.textContent = '';
      dialog.setAttribute('data-lightbox-loading', '');
      modal.open(trigger);
      disposeImage = initLightbox(dialog, {
        url: trigger.dataset.lightboxSrc || url.href,
        alt: img?.alt || caption.textContent,
        source: img,
      });
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
