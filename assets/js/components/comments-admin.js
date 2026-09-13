/** Administrator email matching, key storage, and verification for comments. */
import { readLocal, writeLocal } from '../core/storage.js';

/** Storage key holding the verified administrator key. */
export const ADMIN_TOKEN_KEY = 'night:comments:admin';
/** How long a verified administrator key stays usable. */
export const ADMIN_TOKEN_TTL = 72 * 60 * 60 * 1000;

/**
 * Compare two email addresses ignoring case and surrounding whitespace.
 * @param {string} [first] - One address.
 * @param {string} [second] - Other address.
 * @returns {boolean} Whether both are non-empty and equal.
 */
export function sameEmail(first, second) {
  const left = String(first ?? '')
    .trim()
    .toLowerCase();
  const right = String(second ?? '')
    .trim()
    .toLowerCase();
  return Boolean(left) && left === right;
}

/**
 * Read the stored administrator key while it is still valid.
 * @param {number} [now] - Current timestamp.
 * @param {(key: string) => object|null} [read] - Storage reader.
 * @param {(key: string, value: object|null) => boolean} [write] - Storage writer.
 * @returns {string} Usable key, or an empty string.
 */
export function readAdminToken(
  now = Date.now(),
  read = readLocal,
  write = writeLocal,
) {
  const record = read(ADMIN_TOKEN_KEY);
  if (!record || typeof record.token !== 'string' || !record.token) return '';
  if (!Number.isFinite(record.expires) || record.expires <= now) {
    write(ADMIN_TOKEN_KEY, null);
    return '';
  }
  return record.token;
}

/**
 * Persist a verified administrator key with its expiry.
 * @param {string} token - Verified key.
 * @param {number} [now] - Current timestamp.
 * @param {(key: string, value: object|null) => boolean} [write] - Storage writer.
 * @returns {boolean} Whether the key was stored.
 */
export function writeAdminToken(token, now = Date.now(), write = writeLocal) {
  return write(ADMIN_TOKEN_KEY, { token, expires: now + ADMIN_TOKEN_TTL });
}

/**
 * Forget the stored administrator key.
 * @param {(key: string, value: object|null) => boolean} [write] - Storage writer.
 * @returns {void}
 */
export function clearAdminToken(write = writeLocal) {
  write(ADMIN_TOKEN_KEY, null);
}

/**
 * Verify an administrator key through the comments Worker.
 * @param {(url: string, options?: RequestInit) => Promise<object>} request - JSON requester.
 * @param {string} base - Comments API base without a trailing slash.
 * @param {string} token - Candidate administrator key.
 * @returns {Promise<object>} Verification payload.
 */
export function verifyAdmin(request, base, token) {
  return request(`${base}/api/verify-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken: token }),
  });
}
