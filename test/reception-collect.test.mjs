// test/reception-collect.test.mjs - the reception collector: which days it
// sweeps, in what order, and that a failed sweep is never half counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReception, pendingUnits, BACKFILL_DAYS, RUN_BUDGET_MS, SETTLE_MS, WINDOW_HOURS, MIN_UNIT_BUDGET_MS } from '../lib/reception/collect.mjs';
import { createMemoryReceptionStore, encodeReception, decodeReception, RECEPTION_PATHNAME } from '../lib/reception/store.mjs';
import { emptyTally } from '../lib/reception/tally.mjs';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const obs = (day, uuid = 'A') => ({ uuid, noradId: 25544, endMs: Date.parse(`${day}T06:00:00Z`), lowHz: 437_550_000, highHz: 437_550_000 });

/** A sweep that answers per (day, status) from a table; missing: complete, empty. */
function fakeSweep(table = {}) {
  const calls = [];
  const sweep = async ({ status, startIso, endIso, deadlineMs }) => {
    const key = `${startIso.slice(0, 13)}:${status}`;
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
  assert.equal(WINDOW_HOURS, 6);
  assert.equal(MIN_UNIT_BUDGET_MS, 45_000);
  assert.equal(RECEPTION_PATHNAME, 'catalog/reception.json.gz');
});

test('first run works newest settled window first', () => {
  const units = pendingUnits(emptyTally(), NOW);
  assert.equal(units.length, 7 * 4 * 2);
  assert.deepEqual(units[0], { key: '2026-11-13T18:good', status: 'good', startIso: '2026-11-13T18:00:00Z', endIso: '2026-11-14T00:00:00Z' });
  assert.deepEqual(units[1], { key: '2026-11-13T18:bad', status: 'bad', startIso: '2026-11-13T18:00:00Z', endIso: '2026-11-14T00:00:00Z' });
  assert.equal(units[2].key, '2026-11-13T12:good');
  assert.equal(units.at(-1).key, '2026-11-07T00:bad');
});

test('a window is swept only once it has settled for 12 hours', () => {
  // At 08:00 the 13th's last window ended 8 hours ago: start from its 12:00 one.
  const early = pendingUnits(emptyTally(), Date.parse('2026-11-14T08:00:00Z'));
  assert.equal(early[0].key, '2026-11-13T12:good');
  assert.equal(early.length, 7 * 4 * 2);
});

test('swept units are skipped', () => {
  const t = emptyTally();
  t.swept['2026-11-13T18:good'] = { pages: 1, count: 0, truncated: false };
  assert.equal(pendingUnits(t, NOW)[0].key, '2026-11-13T18:bad');
});

test('a run sweeps each window and stores what it found', async () => {
  const store = createMemoryReceptionStore();
  const { calls, sweep } = fakeSweep({ '2026-11-13T18:good': { observations: [obs('2026-11-13')], pages: 1, complete: true, truncated: false } });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(r.units, 56);
  assert.equal(r.observations, 1);
  assert.equal(r.failed, null);
  assert.equal(r.written, true);
  assert.equal(calls[0].startIso, '2026-11-13T18:00:00Z');
  // Up to an hour past the window: an observation that starts inside it and
  // ends after still counts, in the window where it starts.
  assert.equal(calls[0].endIso, '2026-11-14T01:00:00Z');
  assert.equal(calls[0].deadlineMs, NOW + RUN_BUDGET_MS);
  const t = await store.read();
  assert.equal(t.tx.A.good.length, 1);
  assert.deepEqual(t.swept['2026-11-13T18:good'], { pages: 1, count: 1, truncated: false });
  assert.equal(pendingUnits(t, NOW).length, 0);
});

test('failed unit is retried, not half counted', async () => {
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({
    '2026-11-13T18:good': { observations: [obs('2026-11-13')], pages: 1, complete: true, truncated: false },
    '2026-11-13T18:bad': { observations: [obs('2026-11-13', 'B')], pages: 3, complete: false, truncated: false, error: 'HTTP 503' },
  });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(r.units, 1);
  assert.match(r.failed, /2026-11-13T18:bad.*503/);
  assert.equal(r.written, true);
  const t = await store.read();
  assert.deepEqual(Object.keys(t.tx), ['A']);
  assert.equal('2026-11-13T18:bad' in t.swept, false);
  assert.equal(pendingUnits(t, NOW)[0].key, '2026-11-13T18:bad');
});

test('budget stops between units', async () => {
  let t = NOW;
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({ '2026-11-13T18:good': () => { t += RUN_BUDGET_MS + 1; return { observations: [], pages: 1, complete: true, truncated: false }; } });
  const r = await collectReception({ store, sweep, now: () => t });
  assert.equal(r.units, 1);
  assert.equal(r.failed, null);
});

test('truncated unit is kept and marked', async () => {
  const store = createMemoryReceptionStore();
  const { sweep } = fakeSweep({ '2026-11-13T18:good': { observations: [obs('2026-11-13')], pages: 300, complete: false, truncated: true } });
  await collectReception({ store, sweep, now: () => NOW });
  const t = await store.read();
  assert.deepEqual(t.swept['2026-11-13T18:good'], { pages: 300, count: 1, truncated: true });
  assert.equal(r_count(t), 1);
});
const r_count = (t) => t.tx.A.good.length;

test('nothing finished writes nothing', async () => {
  let writes = 0;
  const inner = createMemoryReceptionStore();
  const store = { read: inner.read, write: async (x) => { writes++; await inner.write(x); } };
  const { sweep } = fakeSweep({ '2026-11-13T18:good': { observations: [], pages: 0, complete: false, truncated: false, error: 'boom' } });
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

test('a unit is not started with less than 45 s of the budget left', async () => {
  let t = NOW;
  const store = createMemoryReceptionStore();
  const { calls, sweep } = fakeSweep({ '2026-11-13T18:good': () => { t += RUN_BUDGET_MS - 30_000; return { observations: [], pages: 1, complete: true, truncated: false }; } });
  const r = await collectReception({ store, sweep, now: () => t });
  assert.equal(calls.length, 1);
  assert.equal(r.units, 1);
});

test('a one-off error skips that window and goes on; it is tried again next run', async () => {
  const store = createMemoryReceptionStore();
  const { calls, sweep } = fakeSweep({
    '2026-11-13T18:good': { observations: [], pages: 0, complete: false, truncated: false, error: 'HTTP 404', stopRun: false },
  });
  const r = await collectReception({ store, sweep, now: () => NOW });
  assert.equal(calls.length, 56);
  assert.equal(r.units, 55);
  assert.match(r.failed, /2026-11-13T18:good: HTTP 404/);
  const t = await store.read();
  assert.equal(pendingUnits(t, NOW)[0].key, '2026-11-13T18:good');
});

test('runSummary says what a run did in one line', async () => {
  const { runSummary } = await import('../lib/reception/collect.mjs');
  assert.equal(runSummary({ units: 4, observations: 812, truncated: 0, failed: null, written: true }), 'refresh-reception: 4 windows, 812 observations, saved');
  assert.equal(runSummary({ units: 0, observations: 0, truncated: 0, failed: '2026-11-13T00:good: HTTP 429', written: false }), 'refresh-reception: 0 windows, 0 observations, not saved; stopped at 2026-11-13T00:good: HTTP 429');
  assert.equal(runSummary({ units: 2, observations: 10, truncated: 1, failed: null, written: true }), 'refresh-reception: 2 windows (1 cut short), 10 observations, saved');
});
