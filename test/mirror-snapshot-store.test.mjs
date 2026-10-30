import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_PATHNAME, createMemorySnapshotStore, createBlobSnapshotStore,
} from '../lib/mirror/snapshot-store.mjs';

const snap = { version: 1, generatedAtMs: 123, objects: { 25544: { noradId: 25544, name: 'ISS' } } };

test('pathname is fixed', () => {
  assert.equal(SNAPSHOT_PATHNAME, 'catalog/snapshot.json.gz');
});

test('memory store round-trips and starts empty', async () => {
  const s = createMemorySnapshotStore();
  assert.equal(await s.read(), null);
  await s.write(snap);
  assert.deepEqual(await s.read(), snap);
  assert.deepEqual(await createMemorySnapshotStore(snap).read(), snap);
});

test('blob store writes with exact options and reads back', async () => {
  const puts = [];
  let stored;
  const blob = {
    put: async (path, body, opts) => { puts.push({ path, opts }); stored = body; return { url: 'https://x/blob' }; },
    head: async (path) => { assert.equal(path, SNAPSHOT_PATHNAME); return { url: 'https://x/blob' }; },
  };
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://x/blob');
    return { ok: true, arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) };
  };
  const store = createBlobSnapshotStore({ blob, fetchImpl });
  await store.write(snap);
  assert.equal(puts[0].path, SNAPSHOT_PATHNAME);
  assert.deepEqual(puts[0].opts, {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/gzip', cacheControlMaxAge: 60,
  });
  assert.deepEqual(await store.read(), snap);
});

test('blob store read returns null on BlobNotFoundError', async () => {
  const blob = { head: async () => { const e = new Error('nf'); e.name = 'BlobNotFoundError'; throw e; } };
  const store = createBlobSnapshotStore({ blob, fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.equal(await store.read(), null);
});

test('blob store read rethrows other errors and bad fetches', async () => {
  const boom = createBlobSnapshotStore({ blob: { head: async () => { throw new Error('boom'); } } });
  await assert.rejects(boom.read(), /boom/);
  const bad = createBlobSnapshotStore({
    blob: { head: async () => ({ url: 'u' }) },
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(bad.read(), /500/);
});

test('blob store read returns null on the real SDK BlobNotFoundError class', async () => {
  const { BlobNotFoundError } = await import('@vercel/blob');
  const blob = { BlobNotFoundError, head: async () => { throw new BlobNotFoundError(); } };
  const store = createBlobSnapshotStore({ blob, fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.equal(await store.read(), null);
});
