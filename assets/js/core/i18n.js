/** Shell translations for the browser bundle, backed by the inlined payload. */

let payload;

/**
 * Read and cache the translation payload emitted by layouts/baseof.html.
 * @returns {Record<string, string>} Translations keyed by i18n key.
 */
function strings() {
  if (!payload) {
    const node = document.querySelector('script[data-i18n]');
    payload = node ? JSON.parse(node.textContent) : {};
  }
  return payload;
}

/**
 * Translate one key from the inlined i18n payload.
 * @param {string} key - Translation key.
 * @param {Record<string, string|number>} [vars] - Values for `{Name}` placeholders.
 * @returns {string} Rendered text, or the key when the payload has no entry.
 */
export function t(key, vars = {}) {
  const value = strings()[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}
