/** Base URL resolution and Node runtime floor regression tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MINIMUM_NODE_VERSION,
  checkNodeVersion,
  resolveBaseURL,
} from '../../scripts/build.mjs';
import { root } from '../../scripts/lib.mjs';

/** Run a callback with NIGHT_BASE_URL set to a temporary value. @param {string|undefined} value - Value to install, or undefined to unset. @param {Function} run - Callback to execute. @returns {Promise<unknown>} Callback result. */
async function withBaseURLEnv(value, run) {
  const previous = process.env.NIGHT_BASE_URL;
  if (value === undefined) delete process.env.NIGHT_BASE_URL;
  else process.env.NIGHT_BASE_URL = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NIGHT_BASE_URL;
    else process.env.NIGHT_BASE_URL = previous;
  }
}

test('resolveBaseURL falls back to the local addresses when nothing is injected', async () => {
  await withBaseURLEnv(undefined, () => {
    assert.equal(resolveBaseURL(), 'http://localhost:4173/');
    assert.equal(
      resolveBaseURL({ development: true }),
      'http://localhost:1313/',
    );
  });
});

test('resolveBaseURL prefers the explicit option over NIGHT_BASE_URL', async () => {
  await withBaseURLEnv('https://env.example/', () => {
    assert.equal(resolveBaseURL(), 'https://env.example/');
    assert.equal(
      resolveBaseURL({ baseURL: 'https://option.example' }),
      'https://option.example/',
    );
  });
});

test('resolveBaseURL normalizes trailing slashes and keeps subpaths', () => {
  assert.equal(
    resolveBaseURL({ baseURL: 'https://example.com' }),
    'https://example.com/',
  );
  assert.equal(
    resolveBaseURL({ baseURL: 'https://example.com/blog' }),
    'https://example.com/blog/',
  );
  assert.equal(
    resolveBaseURL({ baseURL: 'https://example.com/blog/' }),
    'https://example.com/blog/',
  );
});

test('resolveBaseURL rejects unusable values instead of falling back', () => {
  for (const value of [
    'example.com',
    'ftp://example.com/',
    'https://user:pass@example.com/',
  ]) {
    assert.throws(() => resolveBaseURL({ baseURL: value }), /baseURL/);
  }
});

test('checkNodeVersion accepts the floor and newer runtimes', () => {
  checkNodeVersion('v22.19.0');
  checkNodeVersion('v22.19.1');
  checkNodeVersion('v23.0.0');
  checkNodeVersion('v26.7.0');
});

test('checkNodeVersion rejects runtimes below the floor', () => {
  assert.throws(() => checkNodeVersion('v22.18.0'), /22\.19\.0 or newer/);
  assert.throws(() => checkNodeVersion('v20.19.0'), /22\.19\.0 or newer/);
});

test('package.json engines stay in sync with the runtime floor', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.engines.node, `>=${MINIMUM_NODE_VERSION}`);
});
