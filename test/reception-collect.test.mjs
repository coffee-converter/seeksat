// test/reception-collect.test.mjs - the reception collector: which days it
// sweeps, in what order, and that a failed sweep is never half counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReception, pendingUnits, BACKFILL_DAYS, RUN_BUDGET_MS, SETTLE_MS } from '../lib/reception/collect.mjs';
import { createMemoryReceptionStore, encodeReception, decodeReception, RECEPTION_PATHNAME } from '../lib/reception/store.mjs';
import { emptyTally } from '../lib/reception/tally.mjs';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const obs = (day, uuid = 'A') => ({ uuid, noradId: 25544, endMs: Date.parse(`${day}T06:00:00Z`), lowHz: 437_550_000, highHz: 437_550_000 });

/** A sweep that answers per (day, status) from a table; missing: complete, empty. */
function fakeSweep(table = {}) {
  const calls = [];
  const sweep = async ({ status, startIso, endIso, deadlineMs }) => {
    const key = `${startIso.slice(0, 10)}:${status}`;
    calls.push({ key, startIso, endIso, deadlineMs });
    const r = table[key];
    if (typeof r === 'function') return r();
    return r ?? { observations: [], pages: 1, complete: true, truncated: false };
  };
  return { calls, sweep };
}

test('constants', () => {
  assert.equal(BACKFILL_DAYS, 7);
  assert.equal(RUN_BUDGET_MS, 200_000);
  assert.equal(SETTLE_MS, 12 * 3_600_000);
  assert.equal(RECEPTION_PATHNAME, 'catalog/reception.json.gz');
});

test('first run works newest settled day first', () => {
  const units = pendingUnits(emptyTally(), NOW);
  assert.equal(units.length, 14);
  assert.deepEqual(units[0], { day: '2026-11-13', status: 'good' });
  assert.deepEqual(units[1], { day: '2026-11-13', status: 'bad' });
  assert.deepEqual(units.at(-1), { day: '2026-11-07', status: 'bad' });
});

test('a day is swept only once it has settled for 12 hours', () => {
  // 2026-11-13 ended at 2026-11-14T00:00Z; at 08:00 it has not settled.
  const early = pendingUnits(emptyTally(), Date.parse('2026-11-14T08:00:00Z'));
  assert.deepEqual(early[0], { day: '2026-11-12', status: 'good' });
  assert.equal(early.length, 14);
});

test('swept units are skipped', () => {
  const t = emptyTally();
  t.swept['2026-11-13:good'] = { pages: 1, count: 0, truncated: false };
  assert.deepEqual(pendingUnits(t, NOW)[0], { day: '2026-11-13', status: 'bad' });
});

test('a run sweeps each day from midnight to midnight and stores what it found', async () => {
  const store = createMemoryReceptionStore();
  const { calls, sweep } = fakeSweep({ '2026-11-13:good': { observations: [obs('2026-11-13')], pages: 1, complete: true, truncated: false } });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(r.units, 14);
  assert.equal(r.observations, 1);
  assert.equal(r.failed, null);
  assert.equal(r.written, true);
  assert.equal(calls[0].startIso, '2026-11-13T00:00:00Z');
  assert.equal(calls[0].endIso, '2026-11-14T00:00:00Z');
  assert.equal(calls[0].deadlineMs, NOW + RUN_BUDGET_MS);
  const t = await store.read();
  assert.equal(t.tx.A.good.length, 1);
  assert.deepEqual(t.swept['2026-11-13:good'], { pages: 1, count: 1, truncated: false });
  assert.equal(pendingUnits(t, NOW).length, 0);
});

test('failed unit is retried, not half counted', async () => {
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({
    '2026-11-13:good': { observations: [obs('2026-11-13')], pages: 1, complete: true, truncated: false },
    '2026-11-13:bad': { observations: [obs('2026-11-13', 'B')], pages: 3, complete: false, truncated: false, error: 'HTTP 503' },
  });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(r.units, 1);
  assert.match(r.failed, /2026-11-13:bad.*503/);
  assert.equal(r.written, true);
  const t = await store.read();
  assert.deepEqual(Object.keys(t.tx), ['A']);
  assert.equal('2026-11-13:bad' in t.swept, false);
  assert.deepEqual(pendingUnits(t, NOW)[0], { day: '2026-11-13', status: 'bad' });
});

test('budget stops between units', async () => {
  let t = NOW;
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({ '2026-11-13:good': () => { t += RUN_BUDGET_MS + 1; return { observations: [], pages: 1, complete: true, truncated: false }; } });
  const r = await collectReception({ store, sweep, now: () => t });
  assert.equal(r.units, 1);
  assert.equal(r.failed, null);
});

test('truncated unit is kept and marked', async () => {
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({ '2026-11-13:good': { observations: [obs('2026-11-13')], pages: 300, complete: false, truncated: true } });
  await collectReception({ store, sweep, now: () => NOW });
  const t = await store.read();
  assert.deepEqual(t.swept['2026-11-13:good'], { pages: 300, count: 1, truncated: true });
  assert.equal(r_count(t), 1);
});
const r_count = (t) => t.tx.A.good.length;

test('nothing finished writes nothing', async () => {
  let writes = 0;
  const inner = createMemoryReceptionStore();
  const store = { read: inner.read, write: async (x) => { writes++; await inner.write(x); } };
  const { sweep } = fakeSweep({ '2026-11-13:good': { observations: [], pages: 0, complete: false, truncated: false, error: 'boom' } });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(r.units, 0);
  assert.equal(r.written, false);
  assert.equal(writes, 0);
});

test('the stored tally round-trips, and an unknown version is refused', () => {
  const t = emptyTally();
  t.swept['2026-11-13:good'] = { pages: 1, count: 0, truncated: false };
  assert.deepEqual(decodeReception(encodeReception(t)), t);
  assert.throws(() => decodeReception(encodeReception({ version: 9, tx: {}, swept: {} })), /version/);
});
