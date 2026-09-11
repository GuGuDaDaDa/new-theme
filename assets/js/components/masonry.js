/** DOM-order-preserving shortest-column layout for article card lists. */

const GAP = 36;
const instances = new WeakMap();

/**
 * Collect card containers related to an initialization root.
 * @param {Document|Element|DocumentFragment} root - Initialization root.
 * @returns {HTMLElement[]} Unique card containers.
 */
function findContainers(root) {
  const containers = new Set();
  if (root instanceof Element) {
    if (root.matches('[data-cards]')) containers.add(root);
    const parent = root.closest('[data-cards]');
    if (parent) containers.add(parent);
  }
  for (const container of root.querySelectorAll('[data-cards]')) {
    containers.add(container);
  }
  return [...containers];
}

/**
 * Return direct cards in DOM order.
 * @param {HTMLElement} container - Masonry container.
 * @returns {HTMLElement[]} Direct card children.
 */
function getCards(container) {
  return [...container.children].filter(
    (child) => child instanceof HTMLElement && child.matches('.post'),
  );
}

/**
 * Remove all enhanced positioning and restore the CSS grid.
 * @param {HTMLElement} container - Masonry container.
 * @param {HTMLElement[]} cards - Cards to restore.
 * @returns {void}
 */
function restoreGrid(container, cards) {
  container.classList.remove('masonry-enhanced');
  container.style.removeProperty('height');
  for (const card of cards) {
    card.style.removeProperty('width');
    card.style.removeProperty('transform');
  }
}

/**
 * Find the left-most shortest column.
 * @param {number[]} heights - Current column heights.
 * @returns {number} Selected column index.
 */
function shortestColumn(heights) {
  let selected = 0;
  for (let index = 1; index < heights.length; index += 1) {
    if (heights[index] < heights[selected]) selected = index;
  }
  return selected;
}

/**
 * Create one responsive masonry controller.
 * @param {HTMLElement} container - Card container.
 * @returns {{cleanup: () => void, refresh: () => void}} Controller.
 */
function createMasonry(container) {
  const documentRoot = container.ownerDocument;
  const windowRoot = documentRoot.defaultView;
  const controller = new AbortController();
  const observedCards = new WeakSet();
  let observer;
  let frame = 0;
  let measureFrame = 0;
  let disposed = false;
  let targetWidth = 0;
  let lastSignature = '';

  /** Observe newly appended cards and their images. @returns {void} */
  function observeCards() {
    for (const card of getCards(container)) {
      if (observedCards.has(card)) continue;
      observedCards.add(card);
      observer?.observe(card);
      for (const image of card.querySelectorAll('img')) {
        image.addEventListener('load', schedule, {
          signal: controller.signal,
        });
        image.addEventListener('error', schedule, {
          signal: controller.signal,
        });
      }
    }
  }

  /**
   * Measure card heights and commit all positions in one write batch.
   * @param {number} columns - Responsive column count.
   * @param {number} cardWidth - Target card width.
   * @returns {void}
   */
  function measureAndPlace(columns, cardWidth) {
    measureFrame = 0;
    if (disposed || windowRoot.innerWidth <= 768) {
      restoreGrid(container, getCards(container));
      return;
    }
    const cards = getCards(container);
    if (!cards.length) {
      restoreGrid(container, cards);
      return;
    }
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    const signature = `${container.clientWidth}:${columns}:${heights.join(',')}`;
    if (signature === lastSignature) return;

    const columnHeights = Array(columns).fill(0);
    const positions = heights.map((height) => {
      const column = shortestColumn(columnHeights);
      const position = {
        x: column * (cardWidth + GAP),
        y: columnHeights[column],
      };
      columnHeights[column] += height + GAP;
      return position;
    });
    const containerHeight = cards.length ? Math.max(...columnHeights) - GAP : 0;

    container.classList.add('masonry-enhanced');
    container.style.height = `${Math.max(0, containerHeight)}px`;
    cards.forEach((card, index) => {
      card.style.width = `${cardWidth}px`;
      card.style.transform = `translate3d(${positions[index].x}px, ${positions[index].y}px, 0)`;
    });
    lastSignature = signature;
  }

  /** Read the responsive geometry and schedule a clean grid measurement. @returns {void} */
  function layout() {
    frame = 0;
    if (disposed) return;
    observeCards();
    const cards = getCards(container);
    if (!cards.length) {
      targetWidth = 0;
      lastSignature = '';
      restoreGrid(container, cards);
      return;
    }
    if (windowRoot.innerWidth <= 768) {
      targetWidth = 0;
      lastSignature = 'mobile';
      restoreGrid(container, cards);
      return;
    }
    const columns = windowRoot.innerWidth <= 1100 ? 2 : 3;
    const nextWidth = (container.clientWidth - GAP * (columns - 1)) / columns;
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
      throw new Error('Masonry received an invalid container width.');
    }
    if (Math.abs(nextWidth - targetWidth) > 0.5) {
      restoreGrid(container, cards);
      targetWidth = nextWidth;
      lastSignature = '';
      measureFrame = windowRoot.requestAnimationFrame(() => {
        try {
          measureAndPlace(columns, nextWidth);
        } catch (error) {
          measureFrame = 0;
          targetWidth = 0;
          lastSignature = '';
          restoreGrid(container, getCards(container));
          console.error('Night Theme masonry layout failed.', error);
        }
      });
      return;
    }
    measureAndPlace(columns, nextWidth);
  }

  /** Queue at most one layout pass for the next animation frame. @returns {void} */
  function schedule() {
    if (disposed || frame || measureFrame) return;
    frame = windowRoot.requestAnimationFrame(() => {
      try {
        layout();
      } catch (error) {
        targetWidth = 0;
        lastSignature = '';
        restoreGrid(container, getCards(container));
        console.error('Night Theme masonry layout failed.', error);
      }
    });
  }

  if ('ResizeObserver' in windowRoot) {
    observer = new windowRoot.ResizeObserver(schedule);
    observer.observe(container);
  }
  windowRoot.addEventListener('resize', schedule, {
    signal: controller.signal,
  });
  schedule();

  /** Release observers and restore the readable grid. @returns {void} */
  function cleanup() {
    disposed = true;
    controller.abort();
    observer?.disconnect();
    if (frame) windowRoot.cancelAnimationFrame(frame);
    if (measureFrame) windowRoot.cancelAnimationFrame(measureFrame);
    restoreGrid(container, getCards(container));
    instances.delete(container);
  }

  return { cleanup, refresh: schedule };
}

/**
 * Initialize shortest-column positioning under a document or appended subtree.
 * @param {Document|Element|DocumentFragment} root - Initialization root.
 * @returns {() => void} Cleanup callback for newly initialized containers.
 */
export function initMasonry(root) {
  const cleanups = [];
  for (const container of findContainers(root)) {
    const existing = instances.get(container);
    if (existing) {
      existing.refresh();
      continue;
    }
    const instance = createMasonry(container);
    instances.set(container, instance);
    cleanups.push(instance.cleanup);
  }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
