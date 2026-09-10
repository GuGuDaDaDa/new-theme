/** Sticky navigation visibility and visual-state behavior. */

const instances = new WeakMap();
const TOP_LIMIT = 24;
const DIRECTION_THRESHOLD = 5;

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

  header.classList.toggle(
    'header-overlay',
    root.body.classList.contains('home-page') &&
      Boolean(root.querySelector('.hero')),
  );

  /** Return whether interaction state requires the header to stay visible. */
  const isLocked = () =>
    header.contains(root.activeElement) ||
    Boolean(header.querySelector('[aria-expanded="true"]'));

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

  window.addEventListener('scroll', schedule, { passive: true, signal });
  header.addEventListener(
    'focusin',
    () => {
      header.classList.remove('header-hidden');
      accumulated = 0;
    },
    { signal },
  );
  update();

  const cleanup = () => {
    controller.abort();
    if (frame) cancelAnimationFrame(frame);
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
