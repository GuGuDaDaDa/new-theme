/** Same-origin URLs and collection boundaries for HTML pagination. */

import { t } from './i18n.js';

/**
 * Normalize an internal URL without query strings or fragments.
 * @param {string} value - URL to inspect.
 * @param {string} base - Absolute document URL.
 * @returns {string|null} Canonical path or null.
 */
export function internalPath(value, base) {
  try {
    const url = new URL(value, base);
    if (
      url.origin !== new URL(base).origin ||
      url.username ||
      url.password ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.search ||
      url.hash
    )
      return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * Identify one of the theme's public list paths, including direct page N visits.
 * @param {string} value - Candidate URL.
 * @param {string} base - Absolute document URL.
 * @returns {{root: string, page: number}|null} Collection and page number.
 */
export function listRoute(value, base) {
  const path = internalPath(value, base);
  if (!path) return null;
  const match = path.match(
    /^(\/(?:posts\/|tags\/[^/]+\/)?)?(?:page\/([1-9]\d*)\/)?$/,
  );
  if (!match || !match[1]) return null;
  const page = Number(match[2] || 1);
  if (!Number.isSafeInteger(page) || (match[2] && page < 2)) return null;
  return { root: match[1], page };
}

/**
 * Require the next consecutive URL in the same collection.
 * @param {string} value - Next URL.
 * @param {string} current - Current list URL.
 * @param {string} base - Absolute document URL.
 * @returns {string} Validated next path.
 */
export function nextListPath(value, current, base) {
  const from = listRoute(current, base);
  const next = listRoute(value, base);
  if (
    !from ||
    !next ||
    from.root !== next.root ||
    next.page !== from.page + 1
  ) {
    throw new Error(t('pagination.error.route'));
  }
  return internalPath(value, base);
}

/**
 * Resolve a user-supplied URL that may only use HTTP(S).
 * @param {string} value - Candidate URL.
 * @param {string} base - Absolute document URL used for relative values.
 * @returns {string} Absolute HTTP(S) URL, or an empty string.
 */
export function safeURL(value, base) {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
