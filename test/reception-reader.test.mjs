// test/reception-reader.test.mjs - the MCP side's cached reception index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceptionReader, RELOAD_MS } from '../lib/reception/reader.mjs';
import { emptyTally, addObservations } from '../lib/reception/tally.mjs';

const tally = () => {
  const t = emptyTally();
  addObservations(t, [{ uuid: 'A', noradId: 1, endMs: 0, lowHz: 1e8, highHz: 1e8 }], 'good');
  return t;
};

test('reads once per hour, shares one read, and indexes the tally', async () => {
  let reads = 0, t = 0;
  const reader = createReceptionReader({ store: { read: async () => { reads++; return tally(); } }, now: () => t });
  const [a, b] = await Promise.all([reader.index(), reader.index()]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.deepEqual(a.byNorad.get(1), ['A']);
  t += RELOAD_MS - 1;
  await reader.index();
  assert.equal(reads, 1);
  t += 2;
  await reader.index();
  assert.equal(reads, 2);
});

test('a failed read keeps the last index, and none at all is null, never a throw', async () => {
  let fail = false, t = 0;
  const reader = createReceptionReader({ store: { read: async () => { if (fail) throw new Error('down'); return tally(); } }, now: () => t });
  const first = await reader.index();
  fail = true;
  t += RELOAD_MS + 1;
  assert.equal(await reader.index(), first);
  const empty = createReceptionReader({ store: { read: async () => null }, now: () => 0 });
  assert.equal(await empty.index(), null);
  const broken = createReceptionReader({ store: { read: async () => { throw new Error('x'); } }, now: () => 0 });
  assert.equal(await broken.index(), null);
});

test('a store that throws at once still reloads later', async () => {
  let reads = 0, t = 0, fail = true;
  const store = { read() { reads++; if (fail) throw new Error('bad config'); return Promise.resolve(tally()); } };
  const reader = createReceptionReader({ store, now: () => t });
  assert.equal(await reader.index(), null);
  fail = false;
  t += RELOAD_MS + 1;
  const ix = await reader.index();
  assert.equal(reads, 2);
  assert.deepEqual(ix.byNorad.get(1), ['A']);
});
