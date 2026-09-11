/** Progressive whole-card navigation without replacing real article links. */

const instances = new WeakMap();

/**
 * Collect article cards contained by a root.
 * @param {Document|Element|DocumentFragment} root - Initialization root.
 * @returns {HTMLElement[]} Matching cards.
 */
function findCards(root) {
  const cards = [];
  if (root instanceof Element && root.matches('.post[data-post-url]')) {
    cards.push(root);
  }
  cards.push(...root.querySelectorAll('.post[data-post-url]'));
  return cards;
}

/**
 * Return whether a pointer target owns its own interaction.
 * @param {EventTarget|null} target - Event target.
 * @param {HTMLElement} card - Owning card.
 * @returns {boolean} True when card navigation must not intercept.
 */
function isInteractiveTarget(target, card) {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a, button, input, select, textarea, summary, [contenteditable="true"], [role="button"]',
  );
  return Boolean(interactive && card.contains(interactive));
}

/**
 * Return whether the reader currently has selected text.
 * @param {Document} documentRoot - Card document.
 * @returns {boolean} True when a non-collapsed selection exists.
 */
function hasTextSelection(documentRoot) {
  const selection = documentRoot.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

/**
 * Navigate to a card's canonical article URL.
 * @param {HTMLElement} card - Enhanced card.
 * @returns {void}
 */
function openCard(card) {
  const url = card.dataset.postUrl;
  if (!url) return;
  card.dispatchEvent(
    new CustomEvent('night:article-open', { bubbles: true, detail: { url } }),
  );
  card.ownerDocument.defaultView.location.assign(url);
}

/**
 * Enhance one article card and retain its real child links.
 * @param {HTMLElement} card - Card to enhance.
 * @returns {() => void} Cleanup callback.
 */
function enhanceCard(card) {
  const existing = instances.get(card);
  if (existing) return existing;

  const controller = new AbortController();
  const titleLink = card.querySelector('[data-post-title]');
  const previousCardTabIndex = card.getAttribute('tabindex');
  const previousCardRole = card.getAttribute('role');
  const previousCardLabel = card.getAttribute('aria-label');
  const previousTitleTabIndex = titleLink?.getAttribute('tabindex') ?? null;

  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  if (titleLink) card.setAttribute('aria-label', titleLink.textContent.trim());
  card.dataset.cardEnhanced = '';
  if (titleLink) titleLink.tabIndex = -1;

  card.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        isInteractiveTarget(event.target, card) ||
        hasTextSelection(card.ownerDocument)
      ) {
        return;
      }
      openCard(card);
    },
    { signal: controller.signal },
  );

  card.addEventListener(
    'keydown',
    (event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.target !== card ||
        (event.key !== 'Enter' && event.key !== ' ')
      ) {
        return;
      }
      event.preventDefault();
      openCard(card);
    },
    { signal: controller.signal },
  );

  const cover = card.querySelector('[data-post-cover]');
  if (cover) {
    /** Convert a failed cover into the designed text-card fallback. @returns {void} */
    function handleCoverError() {
      cover.closest('.post-cover-link')?.setAttribute('hidden', '');
      card.classList.add('text-post', 'post-cover-failed');
    }
    cover.addEventListener('error', handleCoverError, {
      once: true,
      signal: controller.signal,
    });
    if (cover.complete && cover.naturalWidth === 0) handleCoverError();
  }

  const cleanup = () => {
    controller.abort();
    delete card.dataset.cardEnhanced;
    if (previousCardTabIndex === null) card.removeAttribute('tabindex');
    else card.setAttribute('tabindex', previousCardTabIndex);
    if (previousCardRole === null) card.removeAttribute('role');
    else card.setAttribute('role', previousCardRole);
    if (previousCardLabel === null) card.removeAttribute('aria-label');
    else card.setAttribute('aria-label', previousCardLabel);
    if (titleLink) {
      if (previousTitleTabIndex === null) titleLink.removeAttribute('tabindex');
      else titleLink.setAttribute('tabindex', previousTitleTabIndex);
    }
    instances.delete(card);
  };
  instances.set(card, cleanup);
  return cleanup;
}

/**
 * Initialize whole-card navigation under a document or appended subtree.
 * @param {Document|Element|DocumentFragment} root - Initialization root.
 * @returns {() => void} Cleanup callback for newly initialized cards.
 */
export function initCards(root) {
  const cleanups = [];
  for (const card of findCards(root)) {
    if (!instances.has(card)) cleanups.push(enhanceCard(card));
  }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
