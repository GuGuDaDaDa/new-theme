/** Original image rendering, imported only after a lightbox request. */
import { t } from '../core/i18n.js';

const instances = new WeakMap();

/**
 * Render the requested original image without taking modal ownership.
 * @param {HTMLDialogElement} root - Already open dialog.
 * @param {{url: string, alt: string}} image - Requested image.
 * @returns {() => void} Cancel pending image callbacks and remove the image.
 */
export function initLightbox(root, image) {
  instances.get(root)?.();
  const controller = new AbortController();
  const { signal } = controller;
  const content = root.querySelector('[data-lightbox-content]');
  const status = root.querySelector('[data-lightbox-status]');
  const img = new Image();
  img.alt = image.alt;
  img.addEventListener(
    'load',
    () => {
      status.textContent = '';
    },
    { signal },
  );
  img.addEventListener(
    'error',
    () => {
      status.textContent = t('lightbox.failed');
    },
    { signal },
  );
  content.replaceChildren(img);
  img.src = image.url;
  const cleanup = () => {
    controller.abort();
    img.removeAttribute('src');
    img.remove();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
