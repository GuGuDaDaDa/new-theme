/** Lightweight image entry points and fullscreen lightbox orchestration. */
import { initDialog } from '../core/dialog.js';
import { t } from '../core/i18n.js';
import { initLightbox } from './lightbox.js';

const instances = new WeakMap();
const copyTimers = new WeakMap();
const NON_BLANK_SELECTOR =
  'img, [data-lightbox-caption], [data-lightbox-status], [data-lightbox-progress], button, a';
const TAP_SLOP = 8;

/**
 * Determine whether an event target sits on dismissible blank lightbox space.
 * @param {EventTarget|null} target - Event target node.
 * @returns {boolean} True when the target is not an image, non-empty caption, or control.
 */
function isBlankTarget(target) {
  if (!(target instanceof Element)) return true;
  const hit = target.closest(NON_BLANK_SELECTOR);
  if (!hit) return true;
  if (hit.hasAttribute('data-lightbox-caption') && !hit.textContent.trim()) {
    return true;
  }
  return false;
}

/**
 * Bind image enhancement and cancellable fullscreen lightbox loading.
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
  const progress = dialog.querySelector('[data-lightbox-progress]');
  let disposeImage = () => {};
  let requestToken = 0;
  let blankDown = null;

  /** Invalidate any image still in flight and reset lightbox attributes. @returns {void} */
  function cancel() {
    requestToken += 1;
    blankDown = null;
    disposeImage();
    disposeImage = () => {};
    dialog.removeAttribute('data-lightbox-loading');
    dialog.removeAttribute('data-lightbox-pending');
    dialog.removeAttribute('data-lightbox-mode');
    dialog.removeAttribute('data-lightbox-has-captions');
    caption.textContent = '';
    caption.hidden = true;
    caption.removeAttribute('aria-hidden');
    status.textContent = '';
    if (progress) {
      progress.hidden = true;
      progress.replaceChildren();
    }
  }

  dialog.addEventListener(
    'pointerdown',
    (event) => {
      if (!dialog.open || !event.isPrimary || event.button !== 0) {
        blankDown = null;
        return;
      }
      blankDown = isBlankTarget(event.target)
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    },
    { signal },
  );
  dialog.addEventListener(
    'pointerup',
    (event) => {
      const down = blankDown;
      blankDown = null;
      if (!dialog.open || !down || event.pointerId !== down.id) return;
      if (
        Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_SLOP &&
        isBlankTarget(event.target)
      ) {
        modal.close();
      }
    },
    { signal },
  );
  dialog.addEventListener(
    'pointercancel',
    () => {
      blankDown = null;
    },
    { signal },
  );
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
      const target = event.target instanceof Element ? event.target : null;
      const copyButton = target?.closest('[data-code-copy]');
      if (copyButton) {
        const block = copyButton.closest('[data-code-block]');
        const code = block?.querySelector('pre code')?.textContent ?? '';
        navigator.clipboard?.writeText(code)?.catch(() => {});
        const label = copyButton.querySelector('[data-copy-label]');
        if (label) label.textContent = t('code.copied');
        copyButton.setAttribute('data-copied', '');
        clearTimeout(copyTimers.get(copyButton));
        copyTimers.set(
          copyButton,
          window.setTimeout(() => {
            copyButton.removeAttribute('data-copied');
            if (label) label.textContent = t('code.copy');
          }, 1600),
        );
        return;
      }
      const trigger = target?.closest('a[data-lightbox]');
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
      const currentToken = requestToken;
      const groupRoot = trigger.closest('[data-gallery], [data-photo-stack]');
      const groupLinks = groupRoot
        ? [...groupRoot.querySelectorAll('a[data-lightbox]')]
        : [];
      if (groupRoot && groupLinks.length > 1) {
        const startIndex = Math.max(0, groupLinks.indexOf(trigger));
        const hasCaptions = groupLinks.some((link) =>
          Boolean(link.dataset.caption),
        );
        content.replaceChildren();
        if (hasCaptions) {
          dialog.setAttribute('data-lightbox-has-captions', '');
          caption.textContent = trigger.dataset.caption || '';
          caption.hidden = false;
          if (caption.textContent) caption.removeAttribute('aria-hidden');
          else caption.setAttribute('aria-hidden', 'true');
        }
        dialog.setAttribute('data-lightbox-mode', 'gallery');
        modal.open(trigger);
        import('./gallery.js')
          .then(({ initGalleryLightbox }) => {
            if (currentToken !== requestToken || !dialog.open) return;
            disposeImage = initGalleryLightbox(dialog, {
              galleryRoot: groupRoot,
              startIndex,
              onSelectLink: (link) => modal.setTrigger(link),
            });
          })
          .catch((error) => {
            console.error('Night Theme gallery lightbox failed.', error);
            if (currentToken !== requestToken || !dialog.open) return;
            status.textContent = t('lightbox.unavailable');
          });
        return;
      }
      const img = trigger.querySelector('img');
      const captionText = trigger.dataset.caption || '';
      content.replaceChildren();
      caption.textContent = captionText;
      caption.hidden = !captionText;
      modal.open(trigger);
      disposeImage = initLightbox(dialog, {
        url: trigger.dataset.lightboxSrc || url.href,
        alt: img?.alt || captionText,
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
