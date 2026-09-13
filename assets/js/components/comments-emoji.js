/** OwO-compatible expression packs for the comment editor. */
import { safeURL } from '../core/url.js';

/** Items shown on one page of the expression panel. */
export const EMOJI_PAGE_SIZE = 24;

/** Extract the source attribute from an OwO image entry. */
const IMAGE_SOURCE = /<img[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Read the permitted image address from an OwO image entry.
 * @param {object} item - OwO entry whose `icon` holds an `<img>` string.
 * @param {string} base - Absolute document URL for relative addresses.
 * @returns {string} Absolute image URL, or an empty string.
 */
export function emojiImageURL(item, base) {
  const match = IMAGE_SOURCE.exec(String(item?.icon ?? ''));
  if (!match) return '';
  return safeURL(match[1] ?? match[2] ?? match[3], base);
}

/**
 * Normalize an OwO payload into packs the panel can render.
 * @param {object} payload - Parsed OwO JSON.
 * @returns {Record<string, {type: string, container: object[]}>} Usable packs in file order.
 */
export function parseEmojiPacks(payload) {
  const packs = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return packs;
  for (const [name, pack] of Object.entries(payload)) {
    if (!pack || typeof pack !== 'object' || !Array.isArray(pack.container))
      continue;
    const container = pack.container.filter(
      (item) => item && typeof item.icon === 'string',
    );
    if (!container.length) continue;
    packs[name] = {
      type: pack.type === 'image' ? 'image' : 'emoticon',
      container,
    };
  }
  return packs;
}

/**
 * Collect every configured image address a pack may render.
 * @param {Record<string, {type: string, container: object[]}>} packs - Normalized packs.
 * @param {string} base - Absolute document URL for relative addresses.
 * @returns {string[]} Absolute image URLs.
 */
export function emojiImageURLs(packs, base) {
  const urls = [];
  for (const pack of Object.values(packs)) {
    if (pack.type !== 'image') continue;
    for (const item of pack.container) {
      const url = emojiImageURL(item, base);
      if (url) urls.push(url);
    }
  }
  return urls;
}

/**
 * Build the Markdown image text inserted for one configured image emoticon.
 * @param {object} item - OwO image entry.
 * @param {string} base - Absolute document URL for relative addresses.
 * @param {string} fallback - Label used when the entry has no name.
 * @returns {string} Markdown image text, or an empty string when unusable.
 */
export function emojiInsertText(item, base, fallback) {
  const url = emojiImageURL(item, base);
  if (!url) return '';
  const label = String(item?.text || fallback).replace(/[[\]\\]/g, '\\$&');
  return `![${label}](<${url}>)`;
}
