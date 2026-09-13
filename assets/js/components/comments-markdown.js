/** Restricted Markdown shared by the comment preview and the published list. */
import { Marked } from 'marked';
import { safeURL } from '../core/url.js';

/**
 * Escape text before it is placed in renderer-generated markup.
 * @param {string} text - Plain text.
 * @returns {string} Escaped HTML text.
 */
export function escapeHTML(text) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

/** Image URLs the renderer may turn into images. */
const allowedImages = new Set();

/**
 * Replace the configured image emoticons the renderer may render.
 * @param {string[]} urls - Absolute image URLs from the OwO file.
 * @returns {void}
 */
export function setAllowedImages(urls) {
  allowedImages.clear();
  for (const url of urls) allowedImages.add(url);
}

/**
 * Create the constrained renderer bound to one document URL.
 * @param {string} base - Absolute document URL used to resolve relative links.
 * @returns {(text: string) => string} Markdown renderer.
 */
export function createMarkdownRenderer(base) {
  const markdown = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      /**
       * Render raw HTML as inert text.
       * @param {{ text: string }} token - Raw HTML token.
       * @returns {string} Escaped text.
       */
      html({ text }) {
        return escapeHTML(text);
      },
      /**
       * Keep headings at comment paragraph scale.
       * @param {{ tokens: object[] }} token - Heading token.
       * @returns {string} Paragraph markup.
       */
      heading({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>`;
      },
      /**
       * Tables are outside the approved comment formatting scope.
       * @param {{ raw: string }} token - Table token.
       * @returns {string} Escaped paragraph.
       */
      table({ raw }) {
        return `<p>${escapeHTML(raw)}</p>`;
      },
      /**
       * Strikethrough is not part of the comment formatting scope.
       * @param {{ raw: string }} token - Deletion token.
       * @returns {string} Escaped text.
       */
      del({ raw }) {
        return escapeHTML(raw);
      },
      /**
       * Separators are not part of the comment formatting scope.
       * @param {{ raw: string }} token - Horizontal rule token.
       * @returns {string} Escaped paragraph.
       */
      hr({ raw }) {
        return `<p>${escapeHTML(raw)}</p>`;
      },
      /**
       * Task-list controls are not interactive comment content.
       * @param {{ checked: boolean }} token - Checkbox token.
       * @returns {string} Literal checkbox text.
       */
      checkbox({ checked }) {
        return checked ? '[x] ' : '[ ] ';
      },
      /**
       * Render links with safe destinations; unsafe URLs stay inert text.
       * @param {{ href: string, tokens: object[] }} token - Link token.
       * @returns {string} Anchor markup or plain text.
       */
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = safeURL(href, base);
        return url
          ? `<a href="${escapeHTML(url)}" target="_blank" rel="ugc nofollow noopener noreferrer">${text}</a>`
          : text;
      },
      /**
       * Only configured image emoticons may render as images.
       * @param {{ href: string, text: string }} token - Image token.
       * @returns {string} Image markup or the literal Markdown text.
       */
      image({ href, text }) {
        const url = safeURL(href, base);
        return allowedImages.has(url)
          ? `<img class="comment-emoji" src="${escapeHTML(url)}" alt="${escapeHTML(text)}" width="28" height="28">`
          : escapeHTML(`![${text}](${href})`);
      },
    },
  });
  return (text) => markdown.parse(text ?? '');
}
