/** Fullscreen single-image lightbox rendering and load transition. */
import { t } from '../core/i18n.js';

const instances = new WeakMap();

/**
 * Render the requested article image inside the fullscreen lightbox dialog.
 * @param {HTMLDialogElement} root - Already open lightbox dialog.
 * @param {{url: string, alt: string, source: HTMLImageElement|null}} image - Requested image and its in-page trigger.
 * @returns {() => void} Cancel pending image callbacks and remove the image.
 */
export function initLightbox(root, image) {
  instances.get(root)?.();
  const controller = new AbortController();
  const { signal } = controller;
  const content = root.querySelector('[data-lightbox-content]');
  const status = root.querySelector('[data-lightbox-status]');
  const preview = new Image();
  const full = new Image();
  const thumbUrl =
    image.source?.complete && image.source.naturalWidth
      ? image.source.currentSrc || image.source.src
      : '';

  /** Clear in-flight loading state markers. @returns {void} */
  const finishLoading = () => {
    root.removeAttribute('data-lightbox-loading');
    root.removeAttribute('data-lightbox-pending');
  };

  preview.alt = image.alt;
  preview.decoding = 'async';
  preview.draggable = false;

  if (thumbUrl) {
    preview.src = thumbUrl;
    preview.setAttribute('data-lightbox-ready', '');
  } else {
    root.setAttribute('data-lightbox-pending', '');
  }
  content.replaceChildren(preview);

  if (thumbUrl && thumbUrl === image.url) {
    finishLoading();
  } else {
    root.setAttribute('data-lightbox-loading', '');
    full.decoding = 'async';
    full.addEventListener(
      'load',
      () => {
        preview.src = image.url;
        preview.setAttribute('data-lightbox-ready', '');
        status.textContent = '';
        finishLoading();
      },
      { signal },
    );
    full.addEventListener(
      'error',
      () => {
        finishLoading();
        if (!thumbUrl) {
          preview.remove();
          status.textContent = t('lightbox.failed');
        }
      },
      { signal },
    );
    full.src = image.url;
  }

  const cleanup = () => {
    controller.abort();
    full.removeAttribute('src');
    preview.removeAttribute('src');
    preview.remove();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
