/** Sticky navigation visibility and visual-state behavior. */

const instances = new WeakMap();
const TOP_LIMIT = 24;
const DIRECTION_THRESHOLD = 5;
const REVEAL_DURATION = 380;

/**
 * Initialize the sticky header once for a document.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initHeader(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const header = root.querySelector('[data-header]');
  if (!header) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  let previousY = Math.max(0, window.scrollY);
  let accumulated = 0;
  let direction = 0;
  let frame = 0;
  let revealTimer = 0;

  /** Refresh the persistent header for the committed page. @returns {void} */
  function refresh() {
    header.classList.toggle(
      'header-overlay',
      root.body.classList.contains('home-page') &&
        Boolean(root.querySelector('.hero')),
    );
    previousY = Math.max(0, window.scrollY);
    accumulated = 0;
    direction = 0;
    if (header.classList.contains('header-hidden')) {
      header.classList.add('header-reveal');
      clearTimeout(revealTimer);
      revealTimer = setTimeout(
        () => header.classList.remove('header-reveal'),
        REVEAL_DURATION,
      );
    }
    header.classList.remove('header-hidden');
    update();
  }

  /** Keep keyboard-focused navigation visible without locking pointer focus. */
  const isLocked = () => Boolean(header.querySelector(':focus-visible'));

  /** Apply one frame of scroll-derived header state. */
  const update = () => {
    const y = Math.max(0, window.scrollY);
    const delta = y - previousY;
    const nextDirection = Math.sign(delta);
    header.classList.toggle('header-scrolled', y > TOP_LIMIT);

    if (nextDirection && nextDirection !== direction) {
      accumulated = delta;
      direction = nextDirection;
    } else {
      accumulated += delta;
    }

    if (y <= TOP_LIMIT || isLocked()) {
      header.classList.remove('header-hidden');
      accumulated = 0;
    } else if (Math.abs(accumulated) > DIRECTION_THRESHOLD) {
      header.classList.toggle(
        'header-hidden',
        accumulated > 0 && y > header.offsetHeight,
      );
      accumulated = 0;
    }

    previousY = y;
    frame = 0;
  };

  /** Schedule scroll work for the next animation frame. */
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  root.addEventListener('night:page-ready', refresh, { signal });
  window.addEventListener('scroll', schedule, { passive: true, signal });
  header.addEventListener('keydown', schedule, { signal });
  header.addEventListener(
    'focusin',
    () => {
      header.classList.remove('header-hidden');
      accumulated = 0;
    },
    { signal },
  );
  refresh();

  const cleanup = () => {
    controller.abort();
    clearTimeout(revealTimer);
    if (frame) cancelAnimationFrame(frame);
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
