/** Progressive horizontal gallery and gallery-mode lightbox extension powered by Embla Carousel. */
import EmblaCarousel from 'embla-carousel';
import { t } from '../core/i18n.js';
import { renderProgressBar } from './gallery-progress.js';

const instances = new WeakMap();
const documents = new WeakMap();
const lightboxInstances = new WeakMap();
const WHEEL_THRESHOLD = 28;
const WHEEL_COOLDOWN_MS = 220;

/**
 * Bind horizontal trackpad / mouse-wheel gesture bridging to an Embla instance.
 * Only intervenes when horizontal movement dominates so vertical page scrolling is never blocked.
 * @param {HTMLElement} viewport - Embla viewport element.
 * @param {() => import('embla-carousel').EmblaCarouselType|null} getEmbla - Accessor for current Embla API.
 * @param {() => boolean} isInstant - Whether reduced motion is active.
 * @param {AbortSignal} signal - Cleanup abort signal.
 * @returns {void}
 */
function bindHorizontalWheel(viewport, getEmbla, isInstant, signal) {
  let accumulator = 0;
  let lastTriggerAt = 0;
  let resetTimer = 0;

  viewport.addEventListener(
    'wheel',
    (event) => {
      const embla = getEmbla();
      if (!embla) return;
      const dx = event.deltaX;
      const dy = event.deltaY;
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 2) return;
      if (dx < 0 && !embla.canScrollPrev()) return;
      if (dx > 0 && !embla.canScrollNext()) return;
      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      if (now - lastTriggerAt < WHEEL_COOLDOWN_MS) return;

      accumulator += dx;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        accumulator = 0;
      }, 160);

      if (Math.abs(accumulator) < WHEEL_THRESHOLD) return;
      const forward = accumulator > 0;
      accumulator = 0;
      lastTriggerAt = now;
      if (forward) {
        embla.scrollNext(isInstant());
      } else {
        embla.scrollPrev(isInstant());
      }
    },
    { passive: false, signal },
  );
}

/**
 * Find the snap index that contains or best matches a given slide index.
 * @param {import('embla-carousel').EmblaCarouselType} embla - Embla instance.
 * @param {number} slideIndex - 0-based slide index.
 * @returns {number} Matching 0-based snap index.
 */
function snapIndexForSlide(embla, slideIndex) {
  const engine = embla.internalEngine();
  const registry = engine.slideRegistry;
  if (Array.isArray(registry)) {
    for (let snap = registry.length - 1; snap >= 0; snap -= 1) {
      if (registry[snap]?.includes(slideIndex)) return snap;
    }
  }
  const snaps = embla.scrollSnapList();
  return Math.min(Math.max(0, slideIndex), Math.max(0, snaps.length - 1));
}

/**
 * Enhance one inline gallery container.
 * @param {HTMLElement} root - Gallery `[data-gallery]` element.
 * @returns {() => void} Restore non-enhanced markup and release event listeners.
 */
export function initGallery(root) {
  if (instances.has(root)) return instances.get(root).cleanup;
  const viewport = root.querySelector('[data-gallery-viewport]');
  const track = root.querySelector('[data-gallery-track]');
  const cards = track ? [...track.querySelectorAll('[data-gallery-card]')] : [];
  if (!viewport || cards.length < 2) return () => {};

  const progress = root.querySelector('[data-gallery-progress]');
  const prevBtn = root.querySelector('[data-gallery-prev]');
  const nextBtn = root.querySelector('[data-gallery-next]');
  const status = root.querySelector('[data-gallery-status]');
  const controller = new AbortController();
  const { signal } = controller;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  root.classList.add('is-enhanced');

  const embla = EmblaCarousel(viewport, {
    align: 'start',
    containScroll: 'trimSnaps',
    loop: false,
    dragThreshold: 10,
    duration: reducedMotion.matches ? 0 : 22,
  });

  /** Update progress bar, boundary arrows, and live status announcement. @returns {void} */
  function syncUI() {
    const snaps = embla.scrollSnapList();
    const totalSnaps = snaps.length;
    const selectedSnap = Math.min(
      Math.max(0, embla.selectedScrollSnap()),
      Math.max(0, totalSnaps - 1),
    );
    const noOverflow = totalSnaps <= 1;
    root.toggleAttribute('data-gallery-static', noOverflow);

    if (progress) {
      renderProgressBar(progress, totalSnaps, selectedSnap);
    }
    if (prevBtn) {
      prevBtn.hidden = noOverflow || !embla.canScrollPrev();
    }
    if (nextBtn) {
      nextBtn.hidden = noOverflow || !embla.canScrollNext();
    }
    if (status) {
      status.hidden = noOverflow;
      const label = t('shortcode.galleryCounter', {
        Current: selectedSnap + 1,
        Total: totalSnaps,
      });
      status.textContent = label;
      status.setAttribute('aria-label', label);
    }
  }

  /**
   * Synchronize inline gallery scroll position to a slide index after closing lightbox.
   * @param {number} slideIndex - 0-based slide index last viewed in lightbox.
   * @returns {HTMLElement|null} Trigger link inside the target card for focus restoration.
   */
  function syncToSlide(slideIndex) {
    const clampedSlide = Math.min(
      Math.max(0, slideIndex),
      Math.max(0, cards.length - 1),
    );
    const targetSnap = snapIndexForSlide(embla, clampedSlide);
    embla.scrollTo(targetSnap, true);
    syncUI();
    return cards[clampedSlide]?.querySelector('a[data-lightbox]') ?? null;
  }

  embla.on('init', syncUI);
  embla.on('select', syncUI);
  embla.on('reInit', syncUI);

  cards.forEach((card) => {
    const img = card.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load', () => embla.reInit(), {
        once: true,
        signal,
      });
    }
  });

  prevBtn?.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0) return;
      embla.scrollPrev(reducedMotion.matches);
    },
    { signal },
  );

  nextBtn?.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0) return;
      embla.scrollNext(reducedMotion.matches);
    },
    { signal },
  );

  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (embla.scrollSnapList().length <= 1) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') {
        embla.scrollPrev(reducedMotion.matches);
      } else {
        embla.scrollNext(reducedMotion.matches);
      }
    },
    { signal },
  );

  root.addEventListener(
    'dragstart',
    (event) => {
      event.preventDefault();
    },
    { signal },
  );

  bindHorizontalWheel(
    viewport,
    () => embla,
    () => reducedMotion.matches,
    signal,
  );

  reducedMotion.addEventListener(
    'change',
    () => {
      embla.reInit({ duration: reducedMotion.matches ? 0 : 22 });
    },
    { signal },
  );

  syncUI();

  /** Restore non-enhanced baseline and dispose Embla + listeners. @returns {void} */
  function cleanup() {
    controller.abort();
    embla.destroy();
    root.classList.remove('is-enhanced');
    root.removeAttribute('data-gallery-static');
    if (progress) {
      progress.hidden = true;
      progress.replaceChildren();
    }
    if (prevBtn) prevBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (status) {
      status.hidden = true;
      status.textContent = '';
      status.removeAttribute('aria-label');
    }
    instances.delete(root);
  }

  const record = { cleanup, syncToSlide, embla };
  instances.set(root, record);
  return cleanup;
}

/**
 * Initialize all galleries in the document and handle bfcache page lifecycle.
 * @param {Document} root - Current document.
 * @returns {() => void} Dispose all gallery instances.
 */
export function initGalleries(root) {
  if (documents.has(root)) return documents.get(root);
  const controller = new AbortController();
  const { signal } = controller;
  let cleanups = [];

  /** Mount every `[data-gallery]` container independently. @returns {void} */
  function mount() {
    root.querySelectorAll('[data-gallery]').forEach((gallery) => {
      try {
        cleanups.push(initGallery(gallery));
      } catch (error) {
        console.error('Night Theme gallery initialization failed.', error);
      }
    });
  }

  /** Unmount all enhanced galleries. @returns {void} */
  function unmount() {
    cleanups.forEach((dispose) => dispose());
    cleanups = [];
  }

  window.addEventListener('pagehide', unmount, { signal });
  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) mount();
    },
    { signal },
  );

  mount();

  const cleanup = () => {
    unmount();
    controller.abort();
    documents.delete(root);
  };
  documents.set(root, cleanup);
  return cleanup;
}

/**
 * Open and manage the shared `#image-dialog` in multi-image gallery mode.
 * @param {HTMLDialogElement} dialog - Shared lightbox dialog element.
 * @param {{galleryRoot: HTMLElement, startIndex: number, onSelectLink?: (link: HTMLElement) => void}} context - Source gallery and starting slide index.
 * @returns {() => void} Dispose gallery lightbox mode and synchronize source gallery.
 */
export function initGalleryLightbox(dialog, context) {
  lightboxInstances.get(dialog)?.();
  const { galleryRoot, startIndex, onSelectLink } = context;
  const links = [...galleryRoot.querySelectorAll('a[data-lightbox]')];
  if (!links.length) return () => {};

  if (!instances.has(galleryRoot)) {
    try {
      initGallery(galleryRoot);
    } catch (error) {
      console.error('Night Theme gallery lazy init failed.', error);
    }
  }

  const controller = new AbortController();
  const { signal } = controller;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const content = dialog.querySelector('[data-lightbox-content]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  const status = dialog.querySelector('[data-lightbox-status]');
  const progress = dialog.querySelector('[data-lightbox-progress]');
  const doc = dialog.ownerDocument;

  const items = links.map((link) => {
    const img = link.querySelector('img');
    return {
      link,
      url: link.dataset.lightboxSrc || link.href,
      alt: img?.alt || link.dataset.caption || '',
      caption: link.dataset.caption || '',
      thumbUrl:
        img?.complete && img.naturalWidth ? img.currentSrc || img.src : '',
    };
  });

  let activeIndex = Math.min(
    Math.max(0, startIndex),
    Math.max(0, items.length - 1),
  );

  dialog.setAttribute('data-lightbox-mode', 'gallery');
  dialog.removeAttribute('data-lightbox-loading');
  dialog.removeAttribute('data-lightbox-opening');
  dialog.removeAttribute('data-lightbox-flying');

  const stage = doc.createElement('div');
  stage.className = 'lightbox-gallery-stage';
  stage.dataset.lightboxGalleryStage = '';

  const viewport = doc.createElement('div');
  viewport.className = 'lightbox-gallery-viewport';
  viewport.dataset.lightboxGalleryViewport = '';

  const track = doc.createElement('div');
  track.className = 'lightbox-gallery-track';
  track.dataset.lightboxGalleryTrack = '';

  const slideStates = items.map((item, index) => {
    const slide = doc.createElement('div');
    slide.className = 'lightbox-gallery-slide';
    slide.dataset.lightboxSlide = String(index);

    const img = doc.createElement('img');
    img.className = 'lightbox-gallery-image';
    img.alt = item.alt;
    img.decoding = 'async';
    img.draggable = false;
    if (item.thumbUrl) {
      img.src = item.thumbUrl;
    }
    slide.append(img);
    track.append(slide);
    return {
      item,
      slide,
      img,
      loaded: false,
      loading: false,
      failed: false,
      loader: null,
    };
  });

  const prevBtn = doc.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'gallery-nav lightbox-gallery-nav prev';
  prevBtn.dataset.lightboxPrev = '';
  prevBtn.setAttribute('aria-label', t('shortcode.prevGallery'));
  prevBtn.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><polyline points="15 4 7 12 15 20"></polyline></svg>';

  const nextBtn = doc.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'gallery-nav lightbox-gallery-nav next';
  nextBtn.dataset.lightboxNext = '';
  nextBtn.setAttribute('aria-label', t('shortcode.nextGallery'));
  nextBtn.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><polyline points="9 4 17 12 9 20"></polyline></svg>';

  viewport.append(track);
  stage.append(viewport, prevBtn, nextBtn);
  content.replaceChildren(stage);

  let openAnimation = null;
  if (!reducedMotion.matches) {
    openAnimation = dialog.animate(
      [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      {
        duration: 200,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    );
  }

  const embla = EmblaCarousel(viewport, {
    align: 'center',
    containScroll: false,
    loop: false,
    startIndex: activeIndex,
    dragThreshold: 10,
    duration: reducedMotion.matches ? 0 : 22,
  });

  /** Update status message for the currently active slide. @returns {void} */
  function updateStatus() {
    if (!status) return;
    const current = slideStates[activeIndex];
    if (current?.failed) {
      status.textContent = t('lightbox.failed');
    } else {
      status.textContent = '';
    }
  }

  /**
   * Ensure full image at `index` is loaded.
   * @param {number} index - Slide index to preload.
   * @returns {void}
   */
  function ensureSlideLoaded(index) {
    if (index < 0 || index >= slideStates.length) return;
    const state = slideStates[index];
    if (state.loaded || state.loading) return;
    if (state.item.thumbUrl && state.item.thumbUrl === state.item.url) {
      state.loaded = true;
      return;
    }
    state.loading = true;
    const loader = new Image();
    state.loader = loader;
    loader.decoding = 'async';
    loader.addEventListener(
      'load',
      () => {
        state.loading = false;
        state.loaded = true;
        state.failed = false;
        state.img.src = state.item.url;
        state.slide.removeAttribute('data-slide-failed');
        if (index === activeIndex) updateStatus();
      },
      { signal },
    );
    loader.addEventListener(
      'error',
      () => {
        state.loading = false;
        state.failed = true;
        state.slide.setAttribute('data-slide-failed', '');
        if (!state.item.thumbUrl) {
          state.img.removeAttribute('src');
        }
        if (index === activeIndex) updateStatus();
      },
      { signal },
    );
    loader.src = state.item.url;
  }

  /** Preload active slide and its immediate neighbors (±1). @returns {void} */
  function preloadWindow() {
    ensureSlideLoaded(activeIndex);
    ensureSlideLoaded(activeIndex - 1);
    ensureSlideLoaded(activeIndex + 1);
  }

  /** Sync progress bar, arrows, caption, status, and inline gallery position. @returns {void} */
  function syncLightboxUI() {
    activeIndex = Math.min(
      Math.max(0, embla.selectedScrollSnap()),
      Math.max(0, items.length - 1),
    );
    const current = items[activeIndex];
    if (progress) {
      renderProgressBar(progress, items.length, activeIndex);
    }
    prevBtn.hidden = activeIndex <= 0;
    nextBtn.hidden = activeIndex >= items.length - 1;

    if (caption) {
      caption.textContent = current.caption;
      caption.hidden = !current.caption;
    }
    updateStatus();
    preloadWindow();

    const galleryRecord = instances.get(galleryRoot);
    const targetLink = galleryRecord?.syncToSlide(activeIndex) ?? current.link;
    if (targetLink) {
      onSelectLink?.(targetLink);
    }
  }

  embla.on('init', syncLightboxUI);
  embla.on('select', syncLightboxUI);
  embla.on('reInit', syncLightboxUI);

  prevBtn.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0) return;
      embla.scrollPrev(reducedMotion.matches);
    },
    { signal },
  );

  nextBtn.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0) return;
      embla.scrollNext(reducedMotion.matches);
    },
    { signal },
  );

  dialog.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') {
        embla.scrollPrev(reducedMotion.matches);
      } else {
        embla.scrollNext(reducedMotion.matches);
      }
    },
    { signal },
  );

  stage.addEventListener(
    'dragstart',
    (event) => {
      event.preventDefault();
    },
    { signal },
  );

  bindHorizontalWheel(
    viewport,
    () => embla,
    () => reducedMotion.matches,
    signal,
  );

  reducedMotion.addEventListener(
    'change',
    () => {
      embla.reInit({ duration: reducedMotion.matches ? 0 : 22 });
    },
    { signal },
  );

  syncLightboxUI();

  /** Clean up gallery lightbox mode and restore single-image dialog shell. @returns {void} */
  function cleanup() {
    controller.abort();
    openAnimation?.cancel();
    openAnimation = null;
    slideStates.forEach((state) => {
      state.loader?.removeAttribute('src');
      state.img.removeAttribute('src');
    });
    embla.destroy();
    content.replaceChildren();
    if (progress) {
      progress.hidden = true;
      progress.replaceChildren();
    }
    dialog.removeAttribute('data-lightbox-mode');
    lightboxInstances.delete(dialog);
  }

  lightboxInstances.set(dialog, cleanup);
  return cleanup;
}
