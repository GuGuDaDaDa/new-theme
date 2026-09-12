/** Normalize author content into an isolated Hugo input snapshot. */
import { createHash } from 'node:crypto';
import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { files, json, root, resolveProjectRoot, write } from './lib.mjs';

/** Check whether metadata explicitly contains a field.
 * @param {object} value - Metadata object.
 * @param {string} key - Field name.
 * @returns {boolean} Whether the own property exists.
 */
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const DATE_FIELDS = ['date', 'created', 'publishDate', 'expiryDate', 'lastmod'];
const BOOLEAN_FIELDS = ['featured', 'draft', 'toc'];
const STRING_FIELDS = ['title', 'description', 'summary', 'cover', 'cover_alt'];

/** Find a native JSON frontmatter boundary without interpreting its values.
 * @param {string} source - Content beginning with a JSON object.
 * @returns {{end: number, data: unknown}|undefined} Parsed object boundary.
 */
function nativeJsonFrontmatter(source) {
  if (!source.startsWith('{')) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;
    let end = index + 1;
    while (source[end] === ' ' || source[end] === '\t') end += 1;
    if (end < source.length && source[end] !== '\r' && source[end] !== '\n')
      return undefined;
    return { end, data: JSON.parse(source.slice(0, end)) };
  }
  return undefined;
}

/** Parse YAML, TOML or explicitly fenced JSON metadata.
 * @param {string} source - Original Markdown.
 * @returns {{data: object, content: string, format: string}} Parsed source.
 */
export function parseContent(source) {
  if (typeof source !== 'string')
    throw new TypeError('Content source must be a string');
  const hasBom = source.startsWith('\ufeff');
  const input = hasBom ? source.slice(1) : source;
  const isToml = input.startsWith('+++');
  const isJson = !isToml && /^---json(?:\r?\n|$)/.test(input);
  const options = {
    delimiters: isToml ? '+++' : '---',
    language: isToml ? 'toml' : 'yaml',
    engines: { toml: parseToml, yaml: YAML.parse, json: JSON.parse },
  };
  const native = nativeJsonFrontmatter(input);
  const parsed = native
    ? matter(`---json\n${input.slice(0, native.end)}\n---\n`, options)
    : matter(input, options);
  if (native) {
    parsed.data = native.data;
    parsed.matter = input.slice(0, native.end);
    parsed.content = input.slice(native.end);
    if (parsed.content.startsWith('\r\n'))
      parsed.content = parsed.content.slice(2);
    else if (parsed.content.startsWith('\n'))
      parsed.content = parsed.content.slice(1);
  }
  if (hasBom && parsed.matter === '')
    parsed.content = `\ufeff${parsed.content}`;
  Object.defineProperties(parsed, {
    format: {
      value: native || isJson ? 'json' : isToml ? 'toml' : 'yaml',
      enumerable: false,
    },
    source: { value: source, enumerable: false },
  });
  return parsed;
}

/** Parse a strict timestamp, rejecting machine-local and impossible dates.
 * @param {unknown} value - Metadata value.
 * @param {string} label - Diagnostic context.
 * @returns {Date} Parsed date.
 */
export function timestamp(value, label) {
  if (
    value instanceof Date &&
    typeof value.isDateTime === 'function' &&
    (!value.isDateTime() || value.isLocal())
  )
    throw new Error(`${label}: expected a datetime with timezone`);
  let input;
  try {
    input = value instanceof Date ? value.toISOString() : value;
  } catch {
    input = null;
  }
  if (typeof input === 'string') input = input.trim();
  const match =
    typeof input === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
          input,
        )
      : null;
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  const day = match ? Number(match[3]) : NaN;
  const hour = match ? Number(match[4]) : NaN;
  const minute = match ? Number(match[5]) : NaN;
  const second = match && match[6] ? Number(match[6]) : 0;
  const zone = match ? match[8] : '';
  const offsetHour =
    zone && zone !== 'Z' && zone !== 'z' ? Number(zone.slice(1, 3)) : 0;
  const offsetMinute =
    zone && zone !== 'Z' && zone !== 'z' ? Number(zone.slice(4, 6)) : 0;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    !match ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(input))
  ) {
    throw new Error(`${label}: expected a datetime with timezone`);
  }
  return new Date(Date.parse(input));
}

/** Mask TOML multiline string bodies while preserving line boundaries.
 * @param {string} source - TOML frontmatter body.
 * @returns {string} Lexical view used to locate top-level assignments.
 */
function maskTomlMultilineStrings(source) {
  let quote = '';
  let escaped = false;
  let comment = false;
  let output = '';
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (comment) {
      output += character;
      index += 1;
      if (character === '\n') comment = false;
      continue;
    }
    if (quote === '"""' || quote === "'''") {
      if (source.startsWith(quote, index)) {
        let end = index + 3;
        while (source[end] === quote[0]) end += 1;
        output += ' '.repeat(end - index);
        index = end;
        quote = '';
      } else if (
        quote === '"""' &&
        character === '\\' &&
        index + 1 < source.length
      ) {
        output += '  ';
        index += 2;
      } else {
        output += character === '\n' || character === '\r' ? character : ' ';
        index += 1;
      }
      continue;
    }
    if (quote) {
      output += character;
      index += 1;
      if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '#') {
      comment = true;
      output += character;
      index += 1;
      continue;
    }
    if (source.startsWith('"""', index)) {
      output += '   ';
      index += 3;
      quote = '"""';
    } else if (source.startsWith("'''", index)) {
      output += '   ';
      index += 3;
      quote = "'''";
    } else if (character === '"' || character === "'") {
      output += character;
      index += 1;
      quote = character;
    } else {
      output += character;
      index += 1;
    }
  }
  return output;
}

/** Decode a TOML quoted key for comparison with a parsed field name.
 * @param {string} key - Bare or quoted TOML key.
 * @returns {string} Decoded key text.
 */
function decodeTomlKey(key) {
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1);
  if (!key.startsWith('"') || !key.endsWith('"')) return key;
  return key
    .slice(1, -1)
    .replace(
      /\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|["\\bfnrt])/g,
      (match, value) => {
        if (value[0] === 'u' || value[0] === 'U') {
          const codePoint = Number.parseInt(value.slice(1), 16);
          return Number.isInteger(codePoint) && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : match;
        }
        return {
          '"': '"',
          '\\': '\\',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        }[value];
      },
    );
}

/** Extract a scalar TOML field for strict validation before Date normalization.
 * @param {string} source - Original Markdown.
 * @param {string} field - TOML field name.
 * @returns {string|undefined} Raw scalar, when present.
 */
function rawTomlField(source, field) {
  const input = source.startsWith('\ufeff') ? source.slice(1) : source;
  if (!input.startsWith('+++')) return undefined;
  const end = input.indexOf('\n+++', 3);
  if (end < 0) return undefined;
  const frontmatter = input.slice(3, end);
  const masked = maskTomlMultilineStrings(frontmatter);
  const originalLines = frontmatter.split(/\r?\n/);
  const maskedLines = masked.split(/\r?\n/);
  let tableSeen = false;
  for (let lineIndex = 0; lineIndex < maskedLines.length; lineIndex += 1) {
    const line = maskedLines[lineIndex];
    const originalLine = originalLines[lineIndex];
    let quote = '';
    let escaped = false;
    let comment = line.length;
    let equals = -1;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === '\\') {
        escaped = true;
        continue;
      }
      if (quote && character === quote) {
        quote = '';
        continue;
      }
      if (!quote && (character === '"' || character === "'")) {
        quote = character;
        continue;
      }
      if (!quote && character === '#' && comment === line.length) {
        comment = index;
        continue;
      }
      if (!quote && character === '=' && equals < 0) equals = index;
    }
    const statement = line.slice(0, comment).trim();
    if (!statement) continue;
    if (statement.startsWith('[') && statement.endsWith(']')) {
      tableSeen = true;
      continue;
    }
    if (tableSeen || equals < 0) continue;
    const key = line.slice(0, equals).trim();
    const normalizedKey = decodeTomlKey(key);
    if (normalizedKey !== field) continue;
    const value = originalLine.slice(equals + 1, comment).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      return value.slice(1, -1);
    return value;
  }
  return undefined;
}

/** Validate and default parsed frontmatter without touching author files.
 * @param {object} data - Parsed frontmatter object.
 * @param {string} label - Source-relative diagnostic path.
 * @param {{post?: boolean, source?: string, format?: string}} options - Validation context.
 * @returns {object} The normalized metadata object.
 */
export function validateFrontmatter(
  data,
  label,
  { post = false, source = '', format = 'yaml' } = {},
) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`${label}: frontmatter: expected an object`);
  if (hasOwn(data, '_night'))
    throw new Error(`${label}: _night: reserved field`);

  for (const field of STRING_FIELDS) {
    if (hasOwn(data, field) && typeof data[field] !== 'string')
      throw new Error(`${label}: ${field}: expected a string`);
  }
  if (hasOwn(data, 'title') && !data.title.trim())
    throw new Error(`${label}: title: must be a non-empty string`);
  if (post && (!hasOwn(data, 'title') || !data.title.trim()))
    throw new Error(`${label}: title: required for posts`);
  if (post && !hasOwn(data, 'date'))
    throw new Error(`${label}: date: required for posts`);

  for (const field of BOOLEAN_FIELDS) {
    if (hasOwn(data, field) && typeof data[field] !== 'boolean')
      throw new Error(`${label}: ${field}: expected a boolean`);
  }
  if (!hasOwn(data, 'featured')) data.featured = false;
  if (!hasOwn(data, 'draft')) data.draft = false;
  if (!hasOwn(data, 'toc')) data.toc = true;

  if (hasOwn(data, 'tags')) {
    if (
      !Array.isArray(data.tags) ||
      data.tags.some((tag) => typeof tag !== 'string')
    )
      throw new Error(`${label}: tags: expected an array of strings`);
  } else {
    data.tags = [];
  }

  if (hasOwn(data, 'cover_position')) {
    if (typeof data.cover_position !== 'string')
      throw new Error(`${label}: cover_position: expected a string`);
    const coordinates = data.cover_position.trim().split(/\s+/);
    if (
      coordinates.length !== 2 ||
      coordinates.some((coordinate) => {
        const match = /^(\d+(?:\.\d+)?)%$/.exec(coordinate);
        return !match || Number(match[1]) > 100;
      })
    )
      throw new Error(
        `${label}: cover_position: expected two 0-100% coordinates`,
      );
  } else {
    data.cover_position = '50% 50%';
  }

  for (const field of DATE_FIELDS) {
    if (!hasOwn(data, field)) continue;
    const sourceValue = data[field];
    const raw =
      format === 'toml' && sourceValue instanceof Date
        ? rawTomlField(source, field)
        : undefined;
    if (format === 'toml' && sourceValue instanceof Date && raw === undefined)
      throw new Error(`${label}: ${field}: unable to verify TOML datetime`);
    const parsed = timestamp(raw ?? data[field], `${label}: ${field}`);
    if (
      raw !== undefined &&
      sourceValue instanceof Date &&
      parsed.getTime() !== sourceValue.getTime()
    )
      throw new Error(`${label}: ${field}: TOML datetime source mismatch`);
    data[field] = parsed.toISOString();
  }
  if (post) {
    if (!hasOwn(data, 'created')) data.created = data.date;
    if (!hasOwn(data, 'publishDate')) data.publishDate = data.date;
  }
  return data;
}

/** Evaluate the public snapshot predicate.
 * @param {object} data - Frontmatter.
 * @param {Date} clock - Snapshot time.
 * @param {string} label - File context.
 * @returns {boolean} Public status.
 */
export function isPublic(data, clock, label = 'content') {
  if (data.draft !== undefined && typeof data.draft !== 'boolean')
    throw new Error(`${label}: draft must be boolean`);
  const date = hasOwn(data, 'date')
    ? timestamp(data.date, `${label}: date`)
    : null;
  const publish = hasOwn(data, 'publishDate')
    ? timestamp(data.publishDate, `${label}: publishDate`)
    : date;
  const expiry = hasOwn(data, 'expiryDate')
    ? timestamp(data.expiryDate, `${label}: expiryDate`)
    : null;
  return (
    !data.draft &&
    (!date || date <= clock) &&
    (!publish || publish <= clock) &&
    (!expiry || expiry > clock)
  );
}
/** Normalize case-sensitive labels. @param {unknown} tags - Author labels. @returns {string[]} Unique labels. */
export function normalizeTags(tags = []) {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))
    throw new Error('tags must be an array of strings');
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
/** Hash a stable input. @param {string} value - Input. @returns {string} SHA-256. */
export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
/** Compare normalized posts by day, creation instant, and path. @param {object} a - First post. @param {object} b - Second post. @returns {number} Ordering. */
export function comparePosts(a, b) {
  return (
    b.day.localeCompare(a.day) ||
    b.created - a.created ||
    (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)
  );
}

/** Select public pages once and split regular posts from independent content.
 * @param {Array<object>} pages - Parsed page snapshots.
 * @returns {{visible: Array<object>, posts: Array<object>, excludedBundles: string[]}} Public pages and ranked candidates.
 */
export function selectPublicPages(pages) {
  const excludedBundles = pages
    .filter(
      (page) => !page.public && path.basename(page.relative) === 'index.md',
    )
    .map((page) => `${path.posix.dirname(page.relative)}/`);
  const visible = pages.filter(
    (page) =>
      page.public &&
      !excludedBundles.some((prefix) => page.relative.startsWith(prefix)),
  );
  const posts = visible.filter((page) => page.post).sort(comparePosts);
  return { visible, posts, excludedBundles };
}

/** Prepare generated content without touching source files. @param {string} generated - Output directory. @param {Date} clock - Build time. @param {string} projectRoot - Project root containing author content. @returns {Promise<object>} Build metadata. */
export async function prepareContent(generated, clock, projectRoot = root) {
  const sourceRoot = resolveProjectRoot(projectRoot);
  const friendsFile = path.join(sourceRoot, 'data', 'friends.yaml');
  const dataFiles = await files(path.join(sourceRoot, 'data'));
  if (dataFiles.includes(friendsFile)) {
    const friends = YAML.parse(await readFile(friendsFile, 'utf8'));
    if (!Array.isArray(friends))
      throw new Error('data/friends.yaml: expected an array');
    for (const [index, friend] of friends.entries()) {
      const label = `data/friends.yaml entry ${index + 1}`;
      if (!friend || typeof friend !== 'object' || Array.isArray(friend))
        throw new Error(`${label}: expected an object`);
      for (const field of ['name', 'url', 'avatar', 'description']) {
        const required = field === 'name' || field === 'url';
        if (!required && !hasOwn(friend, field)) continue;
        const value = friend[field];
        if (typeof value !== 'string' || (required && !value.trim()))
          throw new Error(
            `${label}: ${field} must be ${required ? 'a non-empty' : 'a'} string`,
          );
        if (field !== 'url' && field !== 'avatar') continue;
        if (field === 'avatar' && (!value || /^\/(?!\/)/.test(value))) continue;
        if (
          !URL.canParse(value) ||
          !['http:', 'https:'].includes(new URL(value).protocol)
        )
          throw new Error(
            `${label}: ${field} must use http or https${field === 'avatar' ? ' or a site-root path' : ''}`,
          );
      }
    }
  }
  const source = path.join(sourceRoot, 'content');
  const allFiles = await files(source);
  const pages = [];
  for (const file of allFiles.filter((file) => file.endsWith('.md'))) {
    const relative = path.relative(source, file).split(path.sep).join('/');
    const original = await readFile(file, 'utf8');
    let parsed;
    try {
      parsed = parseContent(original);
    } catch (error) {
      throw new Error(`${relative}: frontmatter: ${error.message}`, {
        cause: error,
      });
    }
    const { data, content } = parsed;
    const post =
      relative.startsWith('posts/') && path.basename(relative) !== '_index.md';
    validateFrontmatter(data, relative, {
      post,
      source: original,
      format: parsed.format,
    });
    const date = hasOwn(data, 'date')
      ? timestamp(data.date, `${relative}: date`)
      : clock;
    const created = hasOwn(data, 'created')
      ? timestamp(data.created, `${relative}: created`)
      : date;
    const lastmod = hasOwn(data, 'lastmod')
      ? timestamp(data.lastmod, `${relative}: lastmod`)
      : date;
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    pages.push({
      relative,
      data,
      content,
      post,
      public: isPublic(data, clock, relative),
      day,
      created,
      date,
      lastmod,
    });
  }
  // A hidden leaf bundle owns its resources; none are copied into the public input.
  const { visible, posts, excludedBundles } = selectPublicPages(pages);
  const labels = new Map();
  for (const [rank, post] of posts.entries()) {
    const tagLabels = normalizeTags(post.data.tags);
    post.data.tags = tagLabels.map((label) => {
      const key = `t-${hash(label)}`;
      if (labels.has(key) && labels.get(key) !== label)
        throw new Error('Tag hash collision');
      labels.set(key, label);
      return key;
    });
    const updated = +post.lastmod !== +post.date;
    post.data._night = {
      rank,
      tagLabels,
      updated,
      displayDateKind: updated ? 'updated' : 'published',
      displayDate: (updated ? post.lastmod : post.date).toISOString(),
    };
  }
  for (const page of visible) {
    if (!page.post) delete page.data.tags;
    delete page.data.categories;
    await write(
      path.join(generated, 'content', page.relative),
      `---\n${YAML.stringify(page.data)}---\n${page.content}`,
    );
  }
  for (const file of allFiles.filter((file) => !file.endsWith('.md'))) {
    const relative = path.relative(source, file).split(path.sep).join('/');
    if (!excludedBundles.some((prefix) => relative.startsWith(prefix))) {
      await write(path.join(generated, 'content', relative), '');
      await cp(file, path.join(generated, 'content', relative));
    }
  }
  for (const [key, label] of labels)
    await write(
      path.join(generated, 'content', 'tags', key, '_index.md'),
      `---\n${YAML.stringify({ title: label, slug: key })}---\n`,
    );
  const digest = createHash('sha256');
  for (const dir of [
    'content',
    'layouts',
    'assets',
    'static',
    'data',
    'i18n',
    'scripts',
  ]) {
    for (const file of await files(path.join(sourceRoot, dir)))
      digest
        .update(path.relative(sourceRoot, file))
        .update(await readFile(file));
  }
  for (const file of ['hugo.toml', 'package-lock.json'])
    digest.update(await readFile(path.join(sourceRoot, file)));
  digest.update(JSON.stringify(visible.map((page) => page.relative)));
  const metadata = {
    schemaVersion: 1,
    buildId: digest.digest('hex'),
    buildTime: clock.toISOString(),
  };
  await json(path.join(generated, 'data', 'night_build.json'), metadata);
  return metadata;
}
