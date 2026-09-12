/** Two-pass Hugo build coordinator; all commands run through this pipeline. */
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { buildAssets } from './build-assets.mjs';
import { prepareContent } from './prepare-content.mjs';
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
/** Build a complete input and output snapshot. @param {{development?: boolean, projectRoot?: string, clock?: Date, baseURL?: string, forbiddenMarkers?: string[]}} options - Build mode, optional isolated inputs and deployment URL. @returns {Promise<object>} Hugo server configuration and output locations. */
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
  const siteURL = resolveBaseURL({ baseURL, development });
  const generated = path.join(sourceRoot, '.generated');
  const staging = path.join(
    sourceRoot,
    '.build',
    `staging-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.dirname(staging), { recursive: true });
  await removeGenerated(staging, sourceRoot);
  let metadata;
  try {
    metadata = await prepareContent(staging, clock, sourceRoot);
    await buildAssets(staging, development, sourceRoot);
  } catch (error) {
    await removeGenerated(staging, sourceRoot).catch(() => {});
    throw error;
  }
  const mounts = [
    { source: '.generated/content', target: 'content' },
    ...['data', 'assets', 'static'].flatMap((dir) => [
      { source: dir, target: dir },
      { source: `.generated/${dir}`, target: dir },
    ]),
    ...['layouts', 'i18n', 'archetypes'].map((dir) => ({
      source: dir,
      target: dir,
    })),
  ];
  const baseConfig = {
    contentDir: '.generated/content',
    baseURL: siteURL,
    module: { mounts },
    params: { localPreview: true },
  };
  const finalConfig = path.join(generated, 'final.json');
  const prepareConfig = path.join(generated, 'prepare.json');
  await json(path.join(staging, 'final.json'), baseConfig);
  await json(path.join(staging, 'prepare.json'), {
    ...baseConfig,
    outputs: { home: ['Prepare'] },
  });

  const backupGenerated = path.join(
    sourceRoot,
    '.build',
    `backup-gen-${Date.now()}`,
  );
  let hadGenerated = false;
  try {
    await rename(generated, backupGenerated);
    hadGenerated = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(staging, generated);
  } catch (error) {
    if (hadGenerated) await rename(backupGenerated, generated).catch(() => {});
    await removeGenerated(staging, sourceRoot).catch(() => {});
    throw error;
  }
  if (hadGenerated) {
    await removeGenerated(backupGenerated, sourceRoot).catch(() => {});
  }
  const workspace = path.join(sourceRoot, '.build', metadata.buildId);
  await mkdir(path.dirname(workspace), { recursive: true });
  await removeGenerated(workspace, sourceRoot);
  const prepareDestination = path.join(workspace, 'prepare');
  const commonArgs = [
    '--clock',
    metadata.buildTime,
    '--cacheDir',
    path.join(sourceRoot, '.build/cache'),
  ];
  await run(
    'hugo',
    [
      '--config',
      `hugo.toml,${prepareConfig}`,
      '--environment',
      'prepare',
      '--destination',
      prepareDestination,
      ...commonArgs,
    ],
    sourceRoot,
  );
  const source = await readJson(path.join(prepareDestination, 'prepare.json'));
  const text = {};
  for (const post of source.posts) {
    const summaryText =
      post.description?.trim() || cleanText(post.summary, true);
    const normalizedPath = post.path.split('\\').join('/');
    const entry = {
      summaryText,
      cardExcerpt: excerpt(summaryText, 110),
      heroExcerpt: excerpt(summaryText, 60),
      content: cleanText(post.content),
    };
    text[post.path] = entry;
    text[normalizedPath] = entry;
  }
  await json(path.join(generated, 'data/night_text.json'), text);
  const destination = path.join(workspace, 'site');
  await run(
    'hugo',
    [
      '--config',
      `hugo.toml,${finalConfig}`,
      '--environment',
      development ? 'development' : 'local',
      '--destination',
      destination,
      '--minify',
      ...commonArgs,
    ],
    sourceRoot,
  );
  await validateOutput(destination, { forbiddenMarkers });
  if (!development) {
    const publicDir = path.join(sourceRoot, 'public');
    const backup = path.join(sourceRoot, '.build/previous-public');
    await removeGenerated(backup, sourceRoot);
    await mkdir(path.dirname(backup), { recursive: true });
    let hadPrevious = false;
    try {
      await rename(publicDir, backup);
      hadPrevious = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(destination, publicDir);
    } catch (error) {
      if (hadPrevious) await rename(backup, publicDir);
      throw error;
    }
    await removeGenerated(backup, sourceRoot);
  }
  return {
    finalConfig,
    prepareConfig,
    metadata,
    commonArgs,
    projectRoot: sourceRoot,
    prepareDestination,
    destination,
    publicDir: path.join(sourceRoot, 'public'),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildSite();
}
