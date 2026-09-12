/** Exercise the real Hugo build and emitted asset contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import { buildSite } from '../../scripts/build.mjs';
import { root, files, readJson } from '../../scripts/lib.mjs';
import {
  createBoundarySite,
  removeBoundarySite,
  snapshotTree,
} from '../helpers/site.mjs';

const execFileAsync = promisify(execFile);

/**
 * Fetch an HTTP response body for the Hugo server test.
 * @param {string} url - URL to request.
 * @returns {Promise<{status: number, body: string}>} Response status and body.
 */
function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.once('end', () =>
        resolve({ status: response.statusCode ?? 0, body }),
      );
    });
    request.once('error', reject);
  });
}

/**
 * Poll an HTTP endpoint until a response satisfies a condition.
 * @param {string} url - URL to request.
 * @param {(response: {status: number, body: string}) => boolean} matches - Acceptance predicate.
 * @returns {Promise<{status: number, body: string}>} Matching response.
 */
async function waitForResponse(url, matches) {
  let lastError = new Error(`Timed out waiting for ${url}`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await requestText(url);
      if (matches(response)) return response;
      lastError = new Error(`Unexpected response from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError;
}

/**
 * Reserve an available local TCP port for a test server.
 * @returns {Promise<number>} Available port.
 */
async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('real Hugo build publishes public HTML, assets and a clean search index', async () => {
  const authorContent = await snapshotTree(path.join(root, 'content'));
  const authorPublic = await snapshotTree(path.join(root, 'public'));
  const fixture = await createBoundarySite({ name: 'build' });
  try {
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const output = await files(result.publicDir);
    const index = await readJson(path.join(result.publicDir, 'index.json'));
    assert.ok(index.posts.length > 0);
    assert.ok(index.posts.every((post, rank) => post.rank === rank));
    assert.ok(index.posts.every((post) => !/<[^>]+>/.test(post.content)));
    assert.ok(output.some((file) => file.endsWith('.css')));
    assert.ok(output.some((file) => file.endsWith('.js')));
    assert.ok(output.some((file) => file.includes('/tags/t-')));

    // T07 asset bundling contracts
    const manifest = await readJson(
      path.join(
        result.projectRoot,
        'themes/night-theme/data/night_assets.json',
      ),
    );
    assert.ok(
      manifest.main && manifest.main.startsWith('night-theme/js/main-'),
    );
    assert.ok(output.some((file) => file.endsWith(manifest.main)));

    const chunkFile = output.find((file) =>
      file.includes('/night-theme/js/chunks/dynamic-sample-'),
    );
    assert.ok(
      chunkFile,
      'Dynamic chunk must be emitted in public/night-theme/js/chunks/',
    );
    const mainJsContent = await readFile(
      path.join(result.publicDir, manifest.main),
      'utf8',
    );
    assert.ok(
      mainJsContent.includes('./chunks/dynamic-sample-'),
      'Main entry must use relative path for dynamic chunks without renaming',
    );

    const finalConfig = await readJson(result.finalConfig);
    assert.equal(
      result.finalConfig,
      path.join(result.projectRoot, '.build/config.json'),
    );
    assert.equal(finalConfig.baseURL, 'http://localhost:4173/');

    const html = await readFile(
      path.join(result.publicDir, 'index.html'),
      'utf8',
    );
    assert.match(
      html,
      new RegExp(`<script type="?module"? src="?/${manifest.main}"?>`),
    );
    assert.match(
      html,
      /<link rel="?stylesheet"? href="?\/css\/compiled\.[a-f0-9]+\.css"? integrity="?sha256-[^" >]+"? crossorigin="?anonymous"?>/,
    );
    assert.match(html, /最新文章/);
    assert.doesNotMatch(html, /googletagmanager|gtag\(/);
    assert.equal(index.buildId, result.metadata.buildId);
    assert.equal(result.metadata.buildTime, fixture.clock.toISOString());
    assert.equal(result.metadata.schemaVersion, 1);
    assert.equal(result.projectRoot, fixture.projectRoot);
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
  assert.deepEqual(
    await snapshotTree(path.join(root, 'content')),
    authorContent,
  );
  assert.deepEqual(await snapshotTree(path.join(root, 'public')), authorPublic);
});

test('compiled theme renders directly with Hugo when PATH has no Node executable', async () => {
  const fixture = await createBoundarySite({ name: 'hugo-no-node' });
  try {
    const result = await buildSite({
      projectRoot: fixture.projectRoot,
      clock: fixture.clock,
    });
    const binDir = path.join(fixture.projectRoot, '.build', 'bin');
    await mkdir(binDir, { recursive: true });
    const { stdout } = await execFileAsync('which', ['hugo']);
    const hugoBinary = stdout.trim();
    const linkedHugo = path.join(binDir, 'hugo');
    await symlink(hugoBinary, linkedHugo);
    const destination = path.join(fixture.projectRoot, '.build', 'direct-hugo');
    await new Promise((resolve, reject) => {
      const child = spawn(
        linkedHugo,
        [
          ...result.commonArgs,
          '--clock',
          fixture.clock.toISOString(),
          '--environment',
          'local',
          '--destination',
          destination,
          '--minify',
        ],
        {
          cwd: fixture.projectRoot,
          env: { ...process.env, PATH: binDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`hugo exited: ${code ?? signal}\n${stderr}`));
      });
    });

    const output = await files(destination);
    const index = await readJson(path.join(destination, 'index.json'));
    const html = await readFile(path.join(destination, 'index.html'), 'utf8');
    const manifest = await readJson(
      path.join(
        fixture.projectRoot,
        'themes/night-theme/data/night_assets.json',
      ),
    );
    assert.ok(index.posts.length > 0);
    assert.match(html, /最新文章/);
    assert.ok(output.some((file) => file.endsWith(manifest.main)));
    assert.ok(output.some((file) => file.endsWith('.css')));
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('fresh builds reflect added and removed adapter content', async () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'content-changes',
    definition: {
      clock: clock.toISOString(),
      content: [
        { path: '_index.md', source: '---\ntitle: Changes Home\n---\n' },
        {
          path: 'posts/_index.md',
          source: '---\ntitle: Changes Posts\n---\n',
        },
        {
          path: 'posts/initial/index.md',
          source:
            '---\ntitle: Initial Post\ndate: 2026-09-09T00:00:00Z\n---\nINITIAL_MARKER\n',
        },
      ],
    },
  });
  try {
    const baseline = await buildSite({
      projectRoot: fixture.projectRoot,
      clock,
    });
    const baselineIndex = await readJson(
      path.join(baseline.publicDir, 'index.json'),
    );
    assert.deepEqual(
      baselineIndex.posts.map((post) => post.url),
      ['/posts/initial/'],
    );

    const addedPath = path.join(
      fixture.projectRoot,
      'content/posts/added/index.md',
    );
    await mkdir(path.dirname(addedPath), { recursive: true });
    await writeFile(
      addedPath,
      '---\ntitle: Added Post\ndate: 2026-09-09T01:00:00Z\n---\nADDED_MARKER\n',
    );
    const afterAdd = await buildSite({
      projectRoot: fixture.projectRoot,
      clock,
    });
    const addedIndex = await readJson(
      path.join(afterAdd.publicDir, 'index.json'),
    );
    assert.deepEqual(
      addedIndex.posts.map((post) => post.url),
      ['/posts/added/', '/posts/initial/'],
    );
    assert.ok(
      (await files(afterAdd.publicDir)).some((file) =>
        file.endsWith('/posts/added/index.html'),
      ),
      'Added page must be published',
    );

    await unlink(addedPath);
    const afterRemove = await buildSite({
      projectRoot: fixture.projectRoot,
      clock,
    });
    const removedIndex = await readJson(
      path.join(afterRemove.publicDir, 'index.json'),
    );
    assert.deepEqual(
      removedIndex.posts.map((post) => post.url),
      ['/posts/initial/'],
    );
    assert.ok(
      !(await files(afterRemove.publicDir)).some((file) =>
        file.includes('/posts/added/'),
      ),
      'Removed page must not be published',
    );
  } finally {
    await removeBoundarySite(fixture.projectRoot);
  }
});

test('Hugo server serves adapter content and keeps page and index build IDs aligned', async () => {
  const clock = new Date('2026-09-10T00:00:00Z');
  const fixture = await createBoundarySite({
    name: 'hugo-server-watch',
    definition: {
      clock: clock.toISOString(),
      content: [
        { path: '_index.md', source: '---\ntitle: Watch Home\n---\n' },
        { path: 'posts/_index.md', source: '---\ntitle: Watch Posts\n---\n' },
        {
          path: 'posts/initial/index.md',
          source:
            '---\ntitle: Initial Post\ndate: 2026-09-09T00:00:00Z\n---\nINITIAL_MARKER\n',
        },
      ],
    },
  });
  let serverProcess;
  let serverError = '';
  try {
    const build = await buildSite({
      projectRoot: fixture.projectRoot,
      clock,
    });
    const { stdout } = await execFileAsync('which', ['hugo']);
    const hugoBinary = stdout.trim();
    const port = await availablePort();
    const baseURL = `http://127.0.0.1:${port}`;
    serverProcess = spawn(
      hugoBinary,
      [
        'server',
        ...build.commonArgs,
        '--clock',
        clock.toISOString(),
        '--environment',
        'development',
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--disableFastRender',
        '--baseURL',
        `${baseURL}/`,
      ],
      {
        cwd: fixture.projectRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    serverProcess.stderr.on('data', (chunk) => {
      serverError += chunk;
    });

    const indexURL = `${baseURL}/index.json`;
    const homeURL = `${baseURL}/`;
    const assertSharedBuildId = async (index) => {
      assert.equal(typeof index.buildId, 'string');
      assert.ok(index.buildId.length > 0);
      const home = await waitForResponse(
        homeURL,
        (response) => response.status === 200,
      );
      assert.equal(
        load(home.body)('[data-post-list]').attr('data-build-id'),
        index.buildId,
      );
    };

    const initialIndexResponse = await waitForResponse(indexURL, (response) => {
      if (response.status !== 200) return false;
      const index = JSON.parse(response.body);
      return index.posts.some((post) => post.url === '/posts/initial/');
    });
    let index = JSON.parse(initialIndexResponse.body);
    await assertSharedBuildId(index);

    const initialPath = path.join(
      fixture.projectRoot,
      'content/posts/initial/index.md',
    );
    await writeFile(
      initialPath,
      '---\ntitle: Updated Post\ndate: 2026-09-09T00:00:00Z\n---\nUPDATED_MARKER\n',
    );
    const updatedIndexResponse = await waitForResponse(indexURL, (response) => {
      if (response.status !== 200) return false;
      const candidate = JSON.parse(response.body);
      return candidate.posts.some(
        (post) =>
          post.url === '/posts/initial/' &&
          post.title === 'Updated Post' &&
          post.content.includes('UPDATED_MARKER'),
      );
    });
    index = JSON.parse(updatedIndexResponse.body);
    await assertSharedBuildId(index);
    await waitForResponse(
      `${baseURL}/posts/initial/`,
      (response) =>
        response.status === 200 && response.body.includes('UPDATED_MARKER'),
    );

    assert.equal(serverError, '');
  } catch (error) {
    if (serverProcess && serverError) error.message += `\n${serverError}`;
    throw error;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => serverProcess.once('exit', resolve));
    }
    await removeBoundarySite(fixture.projectRoot);
  }
});
