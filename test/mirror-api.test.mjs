// test/mirror-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satsHandler, searchHandler } from '../lib/mirror/api.mjs';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const OK_CACHE = 'public, s-maxage=900, stale-while-revalidate=3600';

function stub({ records = {}, ready = true, results = [], generatedAtMs = 1000, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    ready: async () => { if (throws) throw new Error('boom'); return ready; },
    getRecord: async (id) => { calls.push(id); if (throws) throw new Error('boom'); return records[id] ?? null; },
    search: async () => { if (throws) throw new Error('boom'); return results; },
    generatedAtMs: () => generatedAtMs,
  };
}
const rec = (noradId, extra = {}) => ({
  noradId, name: `SAT-${noradId}`, omm: {}, epochMs: NOW - 3_600_000 * 5.126,
  source: 'celestrak', fetchedAtMs: 1, groups: [], ...extra,
});
const q = (s) => new URLSearchParams(s);

test('51 ids gives 400', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
  const r = await satsHandler(stub(), q({ ids }), NOW);
  assert.equal(r.status, 400);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(typeof r.body.error, 'string');
});

test('bad ids give 400', async () => {
  for (const ids of ['abc', '', '0', '-5', '1.5', '25544,,1', '1000000000', '1e3']) {
    const r = await satsHandler(stub(), q({ ids }), NOW);
    assert.equal(r.status, 400, ids);
  }
  assert.equal((await satsHandler(stub(), q(''), NOW)).status, 400);
});

test('duplicates collapse and order follows first appearance', async () => {
  const s = stub({ records: { 2: rec(2), 1: rec(1) } });
  const r = await satsHandler(s, q({ ids: '2, 1,2,1' }), NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(s.calls.sort(), [1, 2]);
  assert.deepEqual(r.body.objects.map((o) => o.noradId), [2, 1]);
});

test('known and unknown split into objects and missing', async () => {
  const s = stub({ records: { 25544: rec(25544) } });
  const r = await satsHandler(s, q({ ids: '25544,99999' }), NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.objects.map((o) => o.noradId), [25544]);
  assert.deepEqual(r.body.missing, [99999]);
  assert.equal(r.body.generatedAtMs, 1000);
});

test('an unknown (undefined) record is reported as missing, same as a miss', async () => {
  const s = { ...stub({ records: { 25544: rec(25544) } }), getRecord: async (id) => (id === 25544 ? rec(25544) : undefined) };
  const r = await satsHandler(s, q({ ids: '25544,99999' }), NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.objects.map((o) => o.noradId), [25544]);
  assert.deepEqual(r.body.missing, [99999]);
});

test('6-digit object is returned without line1', async () => {
  const s = stub({ records: { 123456: rec(123456) } });
  const r = await satsHandler(s, q({ ids: '123456' }), NOW);
  assert.equal('line1' in r.body.objects[0], false);
});

test('tleAgeHours is computed and rounded', async () => {
  const s = stub({ records: { 1: rec(1, { line1: 'a', line2: 'b' }) } });
  const r = await satsHandler(s, q({ ids: '1' }), NOW);
  assert.equal(r.body.objects[0].tleAgeHours, 5.13);
  assert.equal(r.body.objects[0].line1, 'a');
});

test('not ready and nothing found gives 503', async () => {
  const r = await satsHandler(stub({ ready: false }), q({ ids: '1' }), NOW);
  assert.equal(r.status, 503);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const s = await searchHandler(stub({ ready: false }), q({ q: 'x' }));
  assert.equal(s.status, 503);
});

test('reader throwing gives 503', async (t) => {
  t.mock.method(console, 'error', () => {});
  const r = await satsHandler(stub({ throws: true }), q({ ids: '1' }), NOW);
  assert.equal(r.status, 503);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal((await searchHandler(stub({ throws: true }), q({ q: 'x' }))).status, 503);
});

test('success sets exact cache header', async () => {
  const r = await satsHandler(stub({ records: { 1: rec(1) } }), q({ ids: '1' }), NOW);
  assert.equal(r.headers['Cache-Control'], OK_CACHE);
  const s = await searchHandler(stub({ results: [{ noradId: 1, name: 'A' }] }), q({ q: 'a' }));
  assert.equal(s.headers['Cache-Control'], OK_CACHE);
  assert.deepEqual(s.body, { results: [{ noradId: 1, name: 'A' }] });
});

test('search validates q', async () => {
  assert.equal((await searchHandler(stub(), q(''))).status, 400);
  assert.equal((await searchHandler(stub(), q({ q: '   ' }))).status, 400);
  assert.equal((await searchHandler(stub(), q({ q: 'x'.repeat(65) }))).status, 400);
  assert.equal((await searchHandler(stub(), q({ q: 'x'.repeat(64) }))).status, 200);
});

test('ready search with no matches is a 200 with empty results', async () => {
  const r = await searchHandler(stub({ results: [] }), q({ q: 'zzz' }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { results: [] });
});

test('response with misses is cached only 60 seconds', async () => {
  const r = await satsHandler(stub({ records: { 1: rec(1) } }), q({ ids: '1,2' }), NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.missing, [2]);
  assert.equal(r.headers['Cache-Control'], 'public, s-maxage=60');
});
