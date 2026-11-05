/** Article image rendering and open transition, loaded only after a request. */
import { t } from '../core/i18n.js';

const instances = new WeakMap();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const OPEN_DURATION = 320;
const OPEN_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/**
 * Measure the painted image area inside its layout box.
 * @param {HTMLImageElement} image - In-page image element.
 * @returns {{left: number, top: number, width: number, height: number}|null} Painted rectangle, or null without a decoded size.
 */
function paintedRect(image) {
  const box = image.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight || !box.width || !box.height)
    return null;
  if (getComputedStyle(image).objectFit !== 'contain') return box;
  const scale = Math.min(
    box.width / image.naturalWidth,
    box.height / image.naturalHeight,
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * Grow the dialog card, preview included, out of the in-page trigger. Scaling is
 * pinned to the preview's centre so the photo lands on the trigger's painted rect.
 * @param {HTMLDialogElement} root - Already open dialog.
 * @param {HTMLImageElement} img - Preview image inside the open dialog.
 * @param {HTMLImageElement|null} source - Trigger image on the page.
 * @returns {Animation|null} Started animation, or null when it is skipped.
 */
function zoomFromSource(root, img, source) {
  if (!source || reducedMotion.matches) return null;
  const from = paintedRect(source);
  if (!from) return null;
  const to = img.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  const card = root.getBoundingClientRect();
  const centreX = to.left + to.width / 2;
  const centreY = to.top + to.height / 2;
  const scale = from.width / to.width;
  const x = from.left + from.width / 2 - centreX;
  const y = from.top + from.height / 2 - centreY;
  root.style.transformOrigin = `${centreX - card.left}px ${centreY - card.top}px`;
  return root.animate(
    [{ transform: `translate(${x}px, ${y}px) scale(${scale})` }, {}],
    { duration: OPEN_DURATION, easing: OPEN_EASING },
  );
}

/**
 * Render the requested article image without taking modal ownership.
 * @param {HTMLDialogElement} root - Already open dialog.
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
  let animation = null;
  const thumbUrl =
    image.source?.complete && image.source.naturalWidth
      ? image.source.currentSrc || image.source.src
      : '';
  /** Mark the full-resolution image as settled. @returns {void} */
  const finishLoading = () => {
    root.removeAttribute('data-lightbox-loading');
    root.removeAttribute('data-lightbox-opening');
  };
  /** Hand the frame's controls back once the card has landed. @returns {void} */
  const landCard = () => root.removeAttribute('data-lightbox-flying');
  preview.alt = image.alt;
  if (thumbUrl) {
    preview.src = thumbUrl;
  }
  content.replaceChildren(preview);
  animation = zoomFromSource(root, preview, image.source);
  if (animation) {
    root.setAttribute('data-lightbox-flying', '');
    animation.finished.then(landCard, landCard);
  }
  if (thumbUrl && thumbUrl === image.url) {
    finishLoading();
  } else {
    full.decoding = 'async';
    full.addEventListener(
      'load',
      () => {
        if (full.naturalWidth && full.naturalHeight) {
          root.style.setProperty('--lightbox-w', String(full.naturalWidth));
          root.style.setProperty('--lightbox-h', String(full.naturalHeight));
        }
        preview.src = image.url;
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
    animation?.cancel();
    animation = null;
    full.removeAttribute('src');
    preview.removeAttribute('src');
    preview.remove();
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
