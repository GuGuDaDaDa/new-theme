/** Progressively enhance server-rendered photo walls with isolated navigation. */
import { t } from '../core/i18n.js';

const instances = new WeakMap();
const documents = new WeakMap();
const positions = [
  'pos-top',
  'pos-second',
  'pos-third',
  'pos-fourth',
  'pos-below',
  'pos-hidden',
];

/**
 * Enhance one wall while retaining its original images and lightbox links.
 * @param {HTMLElement} root - Photo wall.
 * @returns {() => void} Restore sequential content and release event handlers.
 */
export function initPhotoStack(root) {
  if (instances.has(root)) return instances.get(root).cleanup;
  const cards = [...root.querySelector('.stack-track').children];
  if (!cards.length) return () => {};
  const links = cards.map((card) => card.querySelector('[data-lightbox]'));
  const controls = root.querySelectorAll(
    '[data-photo-prev], [data-photo-next], [data-photo-hint], [data-photo-counter]',
  );
  const counter = root.querySelector('[data-photo-counter]');
  const controller = new AbortController();
  const { signal } = controller;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    index: 0,
    gesture: null,
    isAnimating: false,
    animation: null,
    animatedCard: null,
    pendingCommit: null,
    suppressClickUntil: 0,
    cleanup,
  };

  /** Assign layers without reordering the author's DOM. @returns {void} */
  function render() {
    cards.forEach((card, index) => {
      const offset = (index - state.index + cards.length) % cards.length;
      card.classList.remove(...positions);
      card.classList.add(positions[Math.min(offset, positions.length - 1)]);
      card.inert = offset !== 0;
      card.setAttribute('aria-hidden', String(offset !== 0));
      links[index].tabIndex = offset === 0 ? 0 : -1;
    });
    counter.textContent = `${state.index + 1} / ${cards.length}`;
    counter.setAttribute(
      'aria-label',
      t('shortcode.photoCounter', {
        Current: state.index + 1,
        Total: cards.length,
      }),
    );
  }

  /** Apply the withheld index, layout and focus changes of one flip. @returns {void} */
  function commit() {
    const pending = state.pendingCommit;
    if (!pending) return;
    state.pendingCommit = null;
    state.index = pending.next;
    if (pending.moveFocus) root.focus({ preventScroll: true });
    render();
    if (pending.moveFocus) links[pending.next].focus({ preventScroll: true });
  }

  /**
   * Finish an animation, committing a withheld flip first so the outgoing photo
   * leaves before the next one reaches the top layer.
   * @returns {void}
   */
  function finishAnimation() {
    commit();
    state.animation?.cancel();
    state.animatedCard?.classList.remove('animating-out', 'animating-in');
    state.animation = null;
    state.animatedCard = null;
    state.isAnimating = false;
  }

  /**
   * Navigate through the same circular index for every input method.
   * @param {number} requested - Desired index before normalization.
   * @returns {void}
   */
  function goTo(requested) {
    if (cards.length <= 1 || state.isAnimating) return;
    const previous = state.index;
    const next = ((requested % cards.length) + cards.length) % cards.length;
    if (next === previous) return;
    const moveFocus = cards[previous].contains(
      root.ownerDocument.activeElement,
    );
    state.pendingCommit = { next, moveFocus };
    if (reducedMotion.matches) {
      commit();
      return;
    }

    const forward = requested > previous;
    const card = cards[forward ? previous : next];
    state.isAnimating = true;
    state.animatedCard = card;
    card.classList.add(forward ? 'animating-out' : 'animating-in');
    const resting = {
      transform: 'translate(0, 0) rotate(0deg) scale(1)',
      opacity: 1,
    };
    const away = forward
      ? {
          transform: 'translate(140px, 180px) rotate(18deg) scale(0.75)',
          opacity: 0,
        }
      : {
          transform: 'translate(-120px, -160px) rotate(-14deg) scale(0.7)',
          opacity: 0,
        };
    const animation = card.animate(
      forward ? [resting, away] : [away, resting],
      {
        duration: 700,
        easing: 'cubic-bezier(0.5, 0, 0.3, 1)',
        fill: 'both',
      },
    );
    state.animation = animation;
    animation.finished.then(
      () => {
        if (state.animation === animation) finishAnimation();
      },
      () => {},
    );
  }

  /** Release captured pointers and discard incomplete gestures. @returns {void} */
  function cancelGesture() {
    if (state.gesture && root.hasPointerCapture(state.gesture.id)) {
      root.releasePointerCapture(state.gesture.id);
    }
    state.gesture = null;
  }

  root.addEventListener(
    'click',
    (event) => {
      if (event.detail !== 0 && performance.now() < state.suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const button = event.target.closest(
        '[data-photo-prev], [data-photo-next]',
      );
      if (button) {
        goTo(state.index + (button.hasAttribute('data-photo-prev') ? -1 : 1));
        return;
      }
      if (event.target.closest('.stack-card, a, button')) return;
      goTo(state.index + 1);
    },
    { signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (
        cards.length <= 1 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return;
      event.preventDefault();
      goTo(
        state.index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1),
      );
    },
    { signal },
  );
  root.addEventListener(
    'pointerdown',
    (event) => {
      state.suppressClickUntil = 0;
      if (!event.isPrimary) {
        cancelGesture();
        return;
      }
      if (event.button !== 0 || event.target.closest('button')) return;
      state.gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: null,
        moved: false,
      };
      root.classList.add('touch-active');
    },
    { signal },
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      const gesture = state.gesture;
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = Math.abs(event.clientX - gesture.x);
      const dy = Math.abs(event.clientY - gesture.y);
      if (Math.max(dx, dy) < 10) return;
      gesture.moved = true;
      if (!gesture.direction) {
        if (dy > dx * 1.25) gesture.direction = 'vertical';
        else if (dx > dy * 1.5) {
          gesture.direction = 'horizontal';
          root.setPointerCapture(gesture.id);
        }
      }
      if (gesture.direction === 'horizontal' && event.cancelable)
        event.preventDefault();
    },
    { signal, passive: false },
  );
  window.addEventListener(
    'pointerup',
    (event) => {
      const gesture = state.gesture;
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const moved = gesture.moved || Math.max(Math.abs(dx), Math.abs(dy)) >= 10;
      if (moved) state.suppressClickUntil = performance.now() + 600;
      if (
        gesture.direction !== 'vertical' &&
        Math.abs(dx) > 40 &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        goTo(state.index + (dx < 0 ? 1 : -1));
      }
      cancelGesture();
    },
    { signal },
  );
  window.addEventListener(
    'pointercancel',
    (event) => {
      if (state.gesture?.id !== event.pointerId) return;
      state.suppressClickUntil = performance.now() + 600;
      cancelGesture();
    },
    { signal },
  );
  root.addEventListener('dragstart', (event) => event.preventDefault(), {
    signal,
  });
  root.addEventListener(
    'pointerenter',
    () => root.classList.add('touch-active'),
    { signal },
  );
  root.addEventListener(
    'pointerleave',
    () => root.classList.remove('touch-active'),
    { signal },
  );
  reducedMotion.addEventListener(
    'change',
    () => {
      if (reducedMotion.matches) finishAnimation();
    },
    { signal },
  );

  /** Restore the HTML baseline for navigation or disposal. @returns {void} */
  function cleanup() {
    cancelGesture();
    state.pendingCommit = null;
    finishAnimation();
    controller.abort();
    root.classList.remove('is-enhanced', 'touch-active');
    root.removeAttribute('tabindex');
    controls.forEach((control) => {
      control.hidden = true;
    });
    cards.forEach((card, index) => {
      card.classList.remove(...positions);
      card.inert = false;
      card.removeAttribute('aria-hidden');
      links[index].removeAttribute('tabindex');
    });
    instances.delete(root);
  }

  render();
  root.tabIndex = 0;
  controls.forEach((control) => {
    control.hidden = false;
  });
  root.classList.add('is-enhanced');
  instances.set(root, state);
  return cleanup;
}

/**
 * Initialize independent walls and restore bindings after bfcache navigation.
 * @param {Document} root - Current document.
 * @returns {() => void} Remove all walls' enhancements and lifecycle listeners.
 */
export function initPhotoStacks(root) {
  if (documents.has(root)) return documents.get(root);
  const controller = new AbortController();
  const { signal } = controller;
  let cleanups = [];
  /** Enhance walls independently so one failure preserves other walls. @returns {void} */
  function mount() {
    root.querySelectorAll('[data-photo-stack]').forEach((wall) => {
      try {
        cleanups.push(initPhotoStack(wall));
      } catch (error) {
        console.error('Night Theme photo wall initialization failed.', error);
      }
    });
  }
  /** Dispose wall interactions when leaving the page. @returns {void} */
  function unmount() {
    cleanups.forEach((cleanup) => cleanup());
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
