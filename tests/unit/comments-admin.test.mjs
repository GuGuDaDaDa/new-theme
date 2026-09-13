/** Administrator email matching, key storage, and verification tests. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_TOKEN_KEY,
  ADMIN_TOKEN_TTL,
  clearAdminToken,
  readAdminToken,
  sameEmail,
  verifyAdmin,
  writeAdminToken,
} from '../../assets/js/components/comments-admin.js';

/** Create a storage double recording writes. @param {object|null} [initial] - Stored record. @returns {{read: Function, write: Function, writes: object[]}} Storage double. */
function storageDouble(initial = null) {
  const writes = [];
  return {
    writes,
    read: (key) => (key === ADMIN_TOKEN_KEY ? initial : null),
    write: (key, value) => {
      writes.push({ key, value });
      return true;
    },
  };
}

test('sameEmail ignores case and surrounding whitespace', () => {
  assert.equal(sameEmail(' Admin@Example.com ', 'admin@example.com'), true);
  assert.equal(sameEmail('admin@example.com', 'other@example.com'), false);
  assert.equal(sameEmail('', ''), false);
  assert.equal(sameEmail(undefined, 'admin@example.com'), false);
  assert.equal(sameEmail('admin@example.com', null), false);
});

test('writeAdminToken stores the key with a 72 hour expiry', () => {
  const store = storageDouble();
  const now = 1_000_000;
  assert.equal(writeAdminToken('secret', now, store.write), true);
  assert.deepEqual(store.writes, [
    {
      key: ADMIN_TOKEN_KEY,
      value: { token: 'secret', expires: now + ADMIN_TOKEN_TTL },
    },
  ]);
  assert.equal(ADMIN_TOKEN_TTL, 72 * 60 * 60 * 1000);
});

test('readAdminToken returns a fresh key without touching storage', () => {
  const store = storageDouble({ token: 'secret', expires: 2_000 });
  assert.equal(readAdminToken(1_000, store.read, store.write), 'secret');
  assert.deepEqual(store.writes, []);
});

test('readAdminToken clears and rejects expired or malformed records', () => {
  const expired = storageDouble({ token: 'secret', expires: 1_000 });
  assert.equal(readAdminToken(1_000, expired.read, expired.write), '');
  assert.deepEqual(expired.writes, [{ key: ADMIN_TOKEN_KEY, value: null }]);

  const boundary = storageDouble({ token: 'secret', expires: 999 });
  assert.equal(readAdminToken(1_000, boundary.read, boundary.write), '');

  for (const record of [
    null,
    {},
    { token: '' },
    { token: 5 },
    { token: 'x', expires: 'soon' },
  ]) {
    const store = storageDouble(record);
    assert.equal(readAdminToken(1_000, store.read, store.write), '');
  }
});

test('clearAdminToken removes the stored key', () => {
  const store = storageDouble({ token: 'secret', expires: 2_000 });
  clearAdminToken(store.write);
  assert.deepEqual(store.writes, [{ key: ADMIN_TOKEN_KEY, value: null }]);
});

test('verifyAdmin posts the key to the verification endpoint', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return { message: '验证通过' };
  };
  const payload = await verifyAdmin(
    request,
    'https://api.example.test',
    'secret',
  );
  assert.deepEqual(payload, { message: '验证通过' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/api/verify-admin');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { adminToken: 'secret' });
});

test('verifyAdmin propagates request failures', async () => {
  const request = async () => {
    throw new Error('密钥错误');
  };
  await assert.rejects(
    () => verifyAdmin(request, 'https://api.example.test', 'bad'),
    /密钥错误/,
  );
});
