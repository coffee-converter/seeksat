// test/mcp-refresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshCatalog } from '../lib/mcp/refresh.mjs';
import { createMemoryStore } from '../lib/mcp/tle-store.mjs';

const mkFetched = (noradId, epochMs) => ({
  name: `SAT-${noradId}`, line1: `L1-${noradId}`, line2: `L2-${noradId}`, epochMs, source: 'fake',
});

test('refreshCatalog writes a record for every fetched satellite', async () => {
  const store = createMemoryStore();
  const result = await refreshCatalog({
    store,
    catalog: [{ noradId: 1 }, { noradId: 2 }],
    fetchTle: async (id) => mkFetched(id, 100 + id),
    now: () => 5000,
  });
  const map = await store.readMap();
  assert.equal(map['1'].epochMs, 101);
  assert.equal(map['2'].epochMs, 102);
  assert.equal(result.updated.length, 2);
});

test('refreshCatalog keeps the stored record when fetch returns an older epoch', async () => {
  const store = createMemoryStore({ 1: { noradId: 1, epochMs: 999, line1: 'OLDGOOD' } });
  await refreshCatalog({
    store, catalog: [{ noradId: 1 }],
    fetchTle: async (id) => mkFetched(id, 500), // older
    now: () => 5000,
  });
  assert.equal((await store.readMap())['1'].epochMs, 999);
  assert.equal((await store.readMap())['1'].line1, 'OLDGOOD');
});

test('refreshCatalog is a no-op for a satellite whose fetch fails (serve-stale)', async () => {
  const store = createMemoryStore({ 1: { noradId: 1, epochMs: 999 } });
  const result = await refreshCatalog({
    store, catalog: [{ noradId: 1 }],
    fetchTle: async () => null,
    now: () => 5000,
  });
  assert.equal((await store.readMap())['1'].epochMs, 999);
  assert.equal(result.failed.length, 1);
});
