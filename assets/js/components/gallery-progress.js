/** Pure sliding-window segment computation for gallery progress indicators. */

/**
 * @typedef {object} ProgressSegment
 * @property {number} index - Original 0-based snap/slide index.
 * @property {boolean} active - Whether this segment represents the active snap/slide.
 * @property {'normal'|'edge'} scale - Visual scale tier ('edge' when more segments exist beyond this window edge).
 */

/**
 * Compute visible progress bar segments using a sliding window of at most `maxVisible` segments.
 * When `total > maxVisible`, edge segments towards overflowing ends are marked with `scale: 'edge'`.
 * @param {number} total - Total number of snaps or images.
 * @param {number} activeIndex - Currently active 0-based index.
 * @param {number} [maxVisible] - Maximum visible segments in the window (default 7).
 * @returns {ProgressSegment[]} Visible progress segments in display order.
 */
export function computeProgressWindow(total, activeIndex, maxVisible = 7) {
  if (!Number.isInteger(total) || total <= 0) return [];
  const limit = Math.max(1, Math.trunc(maxVisible));
  const clampedActive = Math.min(
    Math.max(0, Math.trunc(activeIndex)),
    total - 1,
  );
  if (total <= limit) {
    return Array.from({ length: total }, (_, index) => ({
      index,
      active: index === clampedActive,
      scale: 'normal',
    }));
  }
  const half = Math.floor(limit / 2);
  const maxStart = total - limit;
  const start = Math.min(Math.max(0, clampedActive - half), maxStart);
  const end = start + limit - 1;
  const hasLeftOverflow = start > 0;
  const hasRightOverflow = end < total - 1;
  return Array.from({ length: limit }, (_, offset) => {
    const index = start + offset;
    const isEdge =
      (offset === 0 && hasLeftOverflow) ||
      (offset === limit - 1 && hasRightOverflow);
    return {
      index,
      active: index === clampedActive,
      scale: isEdge ? 'edge' : 'normal',
    };
  });
}

/**
 * Render progress segments into a container element.
 * @param {HTMLElement} container - Progress bar container (`[data-gallery-progress]` or `[data-lightbox-progress]`).
 * @param {number} total - Total number of snaps or slides.
 * @param {number} activeIndex - Active 0-based index.
 * @param {number} [maxVisible] - Maximum visible segments (default 7).
 * @returns {void}
 */
export function renderProgressBar(
  container,
  total,
  activeIndex,
  maxVisible = 7,
) {
  if (total <= 1) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const segments = computeProgressWindow(total, activeIndex, maxVisible);
  const doc = container.ownerDocument;
  const nodes = segments.map((segment) => {
    const span = doc.createElement('span');
    span.className = 'gallery-progress-segment';
    span.dataset.index = String(segment.index);
    if (segment.active) {
      span.classList.add('is-active');
      span.dataset.active = '';
    }
    if (segment.scale === 'edge') {
      span.classList.add('is-edge');
      span.dataset.scale = 'edge';
    } else {
      span.dataset.scale = 'normal';
    }
    return span;
  });
  container.replaceChildren(...nodes);
  container.hidden = false;
}
