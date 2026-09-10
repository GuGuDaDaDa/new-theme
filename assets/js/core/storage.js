/** Safe access to optional browser storage. */

/**
 * Read a value without allowing storage policy errors to escape.
 * @param {Storage|null} storage - Browser storage implementation.
 * @param {string} key - Storage key.
 * @returns {string|null} Stored value, or null when unavailable.
 */
export function readStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Persist a value without interrupting the current interaction.
 * @param {Storage|null} storage - Browser storage implementation.
 * @param {string} key - Storage key.
 * @param {string} value - Value to store.
 * @returns {boolean} Whether the value was stored.
 */
export function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
