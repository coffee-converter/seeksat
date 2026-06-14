// test/mcp-tle-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/mcp/tle-store.mjs';

test('memory store round-trips a map', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await store.readMap(), {});
  await store.writeMap({ 25544: { noradId: 25544, epochMs: 1 } });
  assert.equal((await store.readMap())['25544'].epochMs, 1);
});

test('memory store can be seeded', async () => {
  const store = createMemoryStore({ 20580: { noradId: 20580, epochMs: 9 } });
  assert.equal((await store.readMap())['20580'].epochMs, 9);
});
