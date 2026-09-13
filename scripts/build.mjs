/** Maintainer asset compilation and native Hugo example-site build. */
import { mkdir, mkdtemp, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { buildAssets } from './build-assets.mjs';
import { validateOutput } from './validate-output.mjs';
import {
  json,
  readJson,
  removeGenerated,
  resolveProjectRoot,
  root,
  run,
} from './lib.mjs';

/** Oldest Node.js runtime the build pipeline supports. */
export const MINIMUM_NODE_VERSION = '22.19.0';
/** Split a dotted version string into numeric parts. @param {string} value - Version such as `v22.19.0`. @returns {number[]} Major, minor and patch numbers. */
function versionParts(value) {
  return value.replace(/^v/, '').split('.').map(Number);
}
/** Reject Node.js runtimes older than the supported minimum. @param {string} version - Version to check; defaults to the running runtime. @returns {void} Throws when the runtime is too old. */
export function checkNodeVersion(version = process.version) {
  const actual = versionParts(version);
  const minimum = versionParts(MINIMUM_NODE_VERSION);
  for (let index = 0; index < minimum.length; index += 1) {
    const part = actual[index] ?? 0;
    if (part > minimum[index]) return;
    if (part < minimum[index])
      throw new Error(
        `Node ${MINIMUM_NODE_VERSION} or newer is required, received ${version}`,
      );
  }
}
/** Resolve the site base URL from options, environment, or the local default. @param {{baseURL?: string, development?: boolean}} [options] - Explicit override and build mode. @returns {string} Absolute base URL ending in a slash. */
export function resolveBaseURL({ baseURL, development = false } = {}) {
  const fallback = development
    ? 'http://localhost:1313/'
    : 'http://localhost:4173/';
  const value = baseURL ?? process.env.NIGHT_BASE_URL ?? fallback;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid baseURL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error(`baseURL must use http or https: ${value}`);
  if (parsed.username || parsed.password)
    throw new Error(`baseURL must not contain credentials: ${value}`);
  if (!parsed.pathname.endsWith('/')) parsed.pathname = `${parsed.pathname}/`;
  return parsed.href;
}
/** Extract readable text without UI controls. @param {string} html - Rendered HTML. @param {boolean} summary - Exclude code for summaries. @returns {string} Clean text. */
export function cleanText(html, summary = false) {
  const $ = load(html ?? '');
  $(
    'script, style, button, nav, [data-search-exclude], .footnote-backref',
  ).remove();
  if (summary) $('pre, code').remove();
  $('p, div, h1, h2, h3, h4, h5, h6, li, br, tr, th, td, blockquote, pre').each(
    (_, element) => $(element).append(' '),
  );
  return $.root().text().replace(/\s+/g, ' ').trim();
}
/** Unicode-safe excerpt. @param {string} text - Plain text. @param {number} limit - Maximum characters. @returns {string} Excerpt. */
export function excerpt(text, limit) {
  const chars = Array.from(text);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : text;
}
/** Build the example site or an isolated consumer using the native Hugo theme.
 * @param {{development?: boolean, projectRoot?: string, clock?: Date, baseURL?: string, forbiddenMarkers?: string[]}} options - Build options.
 * @returns {Promise<object>} Published output and Hugo invocation details.
 */
export async function buildSite({
  development = false,
  projectRoot = root,
  clock = new Date(),
  baseURL,
  forbiddenMarkers = [],
} = {}) {
  const sourceRoot = resolveProjectRoot(projectRoot);
  if (!(clock instanceof Date) || !Number.isFinite(clock.getTime()))
    throw new TypeError('clock must be a valid Date');
  checkNodeVersion();
  const example = sourceRoot === resolveProjectRoot(root);
  const siteRoot = example ? path.join(sourceRoot, 'exampleSite') : sourceRoot;
  const themeRoot = example
    ? sourceRoot
    : path.join(sourceRoot, 'themes/night-theme');
  const siteURL = resolveBaseURL({ baseURL, development });
  await buildAssets(themeRoot, development, themeRoot);
  const workspace = path.join(sourceRoot, '.build');
  await mkdir(workspace, { recursive: true });
  const finalConfig = path.join(workspace, 'config.json');
  await json(finalConfig, {
    baseURL: siteURL,
    params: {
      localPreview: true,
      comments: {
        api_base: '/__comments',
        emoji: '/__comments/emoji.json',
      },
    },
  });
  const staging = await mkdtemp(path.join(workspace, 'site-'));
  const commonArgs = [
    '--source',
    siteRoot,
    '--themesDir',
    example ? path.dirname(sourceRoot) : path.join(sourceRoot, 'themes'),
    '--config',
    `hugo.toml,${finalConfig}`,
    '--cacheDir',
    path.join(workspace, 'cache'),
  ];
  try {
    await run(
      'hugo',
      [
        ...commonArgs,
        '--clock',
        clock.toISOString(),
        '--environment',
        development ? 'development' : 'local',
        '--destination',
        staging,
        '--minify',
      ],
      sourceRoot,
    );
    await validateOutput(staging, { forbiddenMarkers });
    const index = await readJson(path.join(staging, 'index.json'));
    const publicDir = path.join(sourceRoot, 'public');
    if (!development) {
      const backup = path.join(workspace, 'previous-public');
      await removeGenerated(backup, sourceRoot);
      let hadPrevious = false;
      try {
        await rename(publicDir, backup);
        hadPrevious = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        await rename(staging, publicDir);
      } catch (error) {
        if (hadPrevious) await rename(backup, publicDir);
        throw error;
      }
      await removeGenerated(backup, sourceRoot);
    }
    return {
      finalConfig,
      commonArgs,
      projectRoot: sourceRoot,
      metadata: {
        buildId: index.buildId,
        buildTime: clock.toISOString(),
        schemaVersion: 1,
      },
      destination: development ? staging : publicDir,
      publicDir,
    };
  } catch (error) {
    await removeGenerated(staging, sourceRoot);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildSite();
}
