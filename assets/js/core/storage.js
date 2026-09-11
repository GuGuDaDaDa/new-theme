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

/**
 * Read optional session JSON, including browsers that deny the storage getter.
 * @param {string} key - Storage key.
 * @returns {object|null} Parsed value.
 */
export function readSession(key) {
  try {
    return JSON.parse(window.sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Write or remove optional session JSON.
 * @param {string} key - Storage key.
 * @param {object|null} value - Data, or null to remove.
 * @returns {boolean} Whether storage succeeded.
 */
export function writeSession(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a list snapshot and retain at most twenty entries.
 * @param {object} snapshot - URL and position metadata only.
 * @returns {void}
 */
export function saveList(snapshot) {
  const key = `night:list:${snapshot.entryId}`;
  if (!writeSession(key, snapshot)) return;
  const stored = readSession('night:list-lru');
  const keys = Array.isArray(stored)
    ? stored.filter(
        (item) =>
          typeof item === 'string' &&
          item.startsWith('night:list:') &&
          item !== key,
      )
    : [];
  keys.push(key);
  while (keys.length > 20) writeSession(keys.shift(), null);
  writeSession('night:list-lru', keys);
}
