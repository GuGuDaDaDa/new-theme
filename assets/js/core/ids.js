/** Opaque identifier generation shared by the shell, navigation, and list restore. */

/**
 * Create a random identifier usable outside secure contexts.
 * `crypto.randomUUID` only exists on HTTPS and localhost, so calling it during
 * startup would abort the page entry point on plain-HTTP origins.
 * @returns {string} Random identifier.
 */
export function createId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
