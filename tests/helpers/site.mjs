/** Helpers for building isolated boundary fixtures through the production pipeline. */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSite } from '../../scripts/build.mjs';
import { files, readJson, removeGenerated, root } from '../../scripts/lib.mjs';

const fixtureDefinition = path.join(
  root,
  'tests/fixtures/boundaries/site.json',
);
const themeDirectories = [
  'archetypes',
  'assets',
  'data',
  'i18n',
  'layouts',
  'static',
];
const themeFiles = ['hugo.toml', 'theme.toml'];

/** Validate and resolve a fixture content path. @param {string} fixtureRoot - Isolated project root. @param {string} relative - Relative content path from the fixture declaration. @returns {string} Absolute content path. */
function contentPath(fixtureRoot, relative) {
  if (typeof relative !== 'string' || !relative.trim())
    throw new TypeError('Fixture content path must be a non-empty string');
  const contentRoot = path.resolve(fixtureRoot, 'content');
  const target = path.resolve(contentRoot, relative);
  const outside = path.relative(contentRoot, target);
  if (outside.startsWith('..') || path.isAbsolute(outside))
    throw new Error(`Fixture content path escapes content root: ${relative}`);
  return target;
}

/** Build a content snapshot for change detection. @param {string} directory - Directory to snapshot. @returns {Promise<{digest: string, files: string[]}>} Stable file list and digest. */
export async function snapshotTree(directory) {
  const digest = createHash('sha256');
  const entries = await files(directory);
  const relativeFiles = [];
  for (const file of entries) {
    const relative = path.relative(directory, file).split(path.sep).join('/');
    relativeFiles.push(relative);
    digest
      .update(relative)
      .update('\0')
      .update(await readFile(file));
  }
  return { digest: digest.digest('hex'), files: relativeFiles };
}

/** Create a disposable project root containing copied theme inputs and declared fixture content. @param {{name?: string, clock?: Date, definition?: object}} options - Fixture options. @returns {Promise<{projectRoot: string, clock: Date, definition: object}>} Isolated project details. */
export async function createBoundarySite({
  name = 'default',
  clock,
  definition,
} = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error(`Invalid fixture name: ${name}`);
  const fixtureParent = path.join(root, '.build', 'fixtures');
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, `${name}-`));
  const themeRoot = path.join(fixtureRoot, 'themes', 'night-theme');
  await mkdir(themeRoot, { recursive: true });
  for (const directory of themeDirectories)
    await cp(path.join(root, directory), path.join(themeRoot, directory), {
      recursive: true,
    });
  for (const file of themeFiles)
    await cp(path.join(root, file), path.join(themeRoot, file));
  await cp(
    path.join(root, 'content/_content.gotmpl'),
    path.join(themeRoot, 'content/_content.gotmpl'),
  );

  const siteConfig = await readFile(
    path.join(root, 'exampleSite/hugo.toml'),
    'utf8',
  );
  await writeFile(
    path.join(fixtureRoot, 'hugo.toml'),
    siteConfig.replace(/^\s*themesDir\s*=.*(?:\r?\n|$)/m, ''),
  );
  await cp(
    path.join(root, 'exampleSite/data'),
    path.join(fixtureRoot, 'data'),
    {
      recursive: true,
    },
  );

  const source = definition ?? (await readJson(fixtureDefinition));
  if (!Array.isArray(source.content))
    throw new TypeError('Fixture definition content must be an array');
  const buildClock = clock ?? new Date(source.clock);
  if (!(buildClock instanceof Date) || !Number.isFinite(buildClock.getTime()))
    throw new TypeError('Fixture clock must be a valid Date');
  for (const entry of source.content) {
    if (!entry || typeof entry.source !== 'string')
      throw new TypeError('Fixture content entries require source text');
    const target = contentPath(fixtureRoot, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.source);
  }
  for (const groupName of ['templates', 'assets']) {
    const group = source[groupName];
    if (Array.isArray(group)) {
      for (const entry of group) {
        if (
          !entry ||
          typeof entry.source !== 'string' ||
          typeof entry.path !== 'string'
        )
          throw new TypeError(
            `Fixture ${groupName} entries require path and source text`,
          );
        const base =
          groupName === 'assets' && entry.path.startsWith('assets/')
            ? themeRoot
            : fixtureRoot;
        const target = path.resolve(base, entry.path);
        const outside = path.relative(fixtureRoot, target);
        if (outside.startsWith('..') || path.isAbsolute(outside))
          throw new Error(
            `Fixture ${groupName} path escapes fixture root: ${entry.path}`,
          );
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, entry.source);
      }
    }
  }
  return { projectRoot: fixtureRoot, clock: buildClock, definition: source };
}

/** Build an isolated fixture with the production buildSite implementation. @param {{name?: string, clock?: Date, definition?: object, development?: boolean}} options - Fixture and build options. @returns {Promise<{projectRoot: string, clock: Date, definition: object, build: object}>} Fixture and build result. */
export async function buildBoundarySite(options = {}) {
  const fixture = await createBoundarySite(options);
  try {
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
      development: options.development ?? false,
    });
    return { ...fixture, build };
  } catch (error) {
    await removeBoundarySite(fixture.projectRoot);
    throw error;
  }
}

/** Remove an isolated fixture after verifying that its path is managed by the theme workspace. @param {string} projectRoot - Fixture project root. @returns {Promise<void>} Completion. */
export async function removeBoundarySite(projectRoot) {
  await removeGenerated(projectRoot, root);
}
