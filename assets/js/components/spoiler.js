/** Progressive enhancement for covered text written with the spoiler shortcode. */
const instances = new WeakMap();

/**
 * Swap one spoiler between its covered and revealed states.
 * @param {HTMLElement} spoiler - Element rendered by the spoiler shortcode.
 * @returns {void}
 */
function toggleSpoiler(spoiler) {
  const shown = spoiler.dataset.spoilerState === 'shown';
  spoiler.dataset.spoilerState = shown ? 'hidden' : 'shown';
  spoiler.setAttribute('aria-expanded', String(!shown));
}

/**
 * Reveal covered text on click, tap, or keyboard activation.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initSpoilers(root) {
  if (instances.has(root)) return instances.get(root);
  const controller = new AbortController();
  const { signal } = controller;
  const spoilers = [...root.querySelectorAll('[data-spoiler]')];
  for (const spoiler of spoilers) {
    spoiler.setAttribute('role', 'button');
    spoiler.setAttribute('tabindex', '0');
    spoiler.setAttribute('aria-expanded', 'false');
    spoiler.addEventListener('click', () => toggleSpoiler(spoiler), { signal });
    spoiler.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSpoiler(spoiler);
      },
      { signal },
    );
  }
  const cleanup = () => {
    controller.abort();
    for (const spoiler of spoilers) {
      spoiler.removeAttribute('role');
      spoiler.removeAttribute('tabindex');
      spoiler.removeAttribute('aria-expanded');
      delete spoiler.dataset.spoilerState;
    }
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
