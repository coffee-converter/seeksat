import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReader } from '../lib/mirror/reader.mjs';
import { createMemorySnapshotStore } from '../lib/mirror/snapshot-store.mjs';
import { ISS_OMM, ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';

const T0 = Date.parse('2026-03-02T00:00:00Z');
const RELOAD = 15 * 60_000;
const quiet = { warn() {}, error() {} };

function rec(noradId, name, extra = {}) {
  return {
    noradId, name, omm: { ...ISS_OMM, NORAD_CAT_ID: noradId, OBJECT_NAME: name },
    epochMs: T0, source: 'celestrak-gp', fetchedAtMs: T0, groups: ['active'], ...extra,
  };
}
function snap(list, generatedAtMs = T0) {
  const objects = {};
  for (const r of list) objects[String(r.noradId)] = r;
  return { version: 1, generatedAtMs, objects };
}
function make({ store, onDemand, clock = { t: T0 } } = {}) {
  const calls = [];
  const od = onDemand || { get: async (id) => { calls.push(id); return null; } };
  const reader = createCatalogReader({ store, onDemand: od, now: () => clock.t, log: quiet });
  return { reader, calls, clock };
}

test('serves snapshot record with TLE lines', async () => {
  const store = createMemorySnapshotStore(snap([rec(25544, 'ISS (ZARYA)')]));
  const { reader } = make({ store });
  const r = await reader.getRecord(25544);
  assert.equal(r.line1, ISS_LINE1);
  assert.equal(r.line2, ISS_LINE2);
  assert.equal(r.noradId, 25544);
  assert.equal(await reader.ready(), true);
  assert.equal(reader.generatedAtMs(), T0);
});

test('getRecord returns fresh objects and does not mutate the stored record', async () => {
  const s = snap([rec(25544, 'ISS (ZARYA)')]);
  const { reader } = make({ store: createMemorySnapshotStore(s) });
  const a = await reader.getRecord(25544);
  a.name = 'changed';
  const b = await reader.getRecord(25544);
  assert.notEqual(a, b);
  assert.equal(b.name, 'ISS (ZARYA)');
  assert.equal('line1' in s.objects['25544'], false);
});

test('6-digit record has no lines', async () => {
  const store = createMemorySnapshotStore(snap([rec(123456, 'BIG')]));
  const { reader } = make({ store });
  const r = await reader.getRecord(123456);
  assert.equal(r.noradId, 123456);
  assert.equal(r.line1, undefined);
  assert.equal(r.line2, undefined);
});

test('unknown id goes to onDemand and gets lines', async () => {
  const store = createMemorySnapshotStore(snap([rec(25544, 'ISS (ZARYA)')]));
  const calls = [];
  const onDemand = { get: async (id) => { calls.push(id); return rec(99999, 'NEW', { source: 'celestrak-catnr', groups: [] }); } };
  const { reader } = make({ store, onDemand });
  const r = await reader.getRecord(99999);
  assert.deepEqual(calls, [99999]);
  assert.equal(r.noradId, 99999);
  assert.equal(typeof r.line1, 'string');
  const none = make({ store, onDemand: { get: async () => null } });
  assert.equal(await none.reader.getRecord(77777), null);
});

const tick = () => new Promise((r) => setImmediate(r));

test('snapshot reloads only after reloadMs', async () => {
  let reads = 0;
  const store = { async read() { reads++; return snap([rec(25544, 'ISS (ZARYA)')], T0 + reads); }, async write() {} };
  const { reader, clock } = make({ store });
  await reader.getRecord(25544);
  clock.t += RELOAD - 1;
  await reader.getRecord(25544);
  assert.equal(reads, 1);
  clock.t += 2;
  await reader.getRecord(25544);
  assert.equal(reads, 2);
  await tick();
  assert.equal(reader.generatedAtMs(), T0 + 2);
});

test('a reload runs in the background: callers get the current snapshot without waiting', { timeout: 2000 }, async () => {
  let reads = 0;
  let release;
  const store = {
    async read() {
      reads++;
      if (reads === 1) return snap([rec(1, 'OLD')], T0);
      await new Promise((r) => { release = r; });
      return snap([rec(1, 'NEW')], T0 + 1);
    },
    async write() {},
  };
  const { reader, clock, calls } = make({ store });
  assert.equal((await reader.getRecord(1)).name, 'OLD');
  clock.t += RELOAD;
  // The reload is stuck; these must still resolve from the old snapshot.
  assert.equal((await reader.getRecord(1)).name, 'OLD');
  assert.equal(await reader.ready(), true);
  assert.equal((await reader.search('old')).length, 1);
  assert.equal(reads, 2, 'one reload started, not one per caller');
  assert.deepEqual(calls, []);
  release();
  await tick();
  assert.equal((await reader.getRecord(1)).name, 'NEW');
  assert.equal(reader.generatedAtMs(), T0 + 1);
  assert.equal(reads, 2);
});

test('the first load is awaited and shared even when slow', async () => {
  let reads = 0;
  let release;
  const store = {
    async read() { reads++; await new Promise((r) => { release = r; }); return snap([rec(1, 'A')]); },
    async write() {},
  };
  const { reader } = make({ store });
  const pending = Promise.all([reader.getRecord(1), reader.ready()]);
  await tick();
  release();
  const [r, ok] = await pending;
  assert.equal(r.name, 'A');
  assert.equal(ok, true);
  assert.equal(reads, 1);
});

test('getSnapshotRecord serves snapshot records and never calls on-demand', async () => {
  const store = createMemorySnapshotStore(snap([rec(25544, 'ISS (ZARYA)')]));
  const { reader, calls } = make({ store });
  const r = await reader.getSnapshotRecord(25544);
  assert.equal(r.line1, ISS_LINE1);
  assert.equal(await reader.getSnapshotRecord(99999), null);
  const empty = make({ store: createMemorySnapshotStore(null) });
  assert.equal(await empty.reader.getSnapshotRecord(25544), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(empty.calls, []);
});

test('concurrent first calls share one read', async () => {
  let reads = 0;
  const store = { async read() { reads++; await new Promise((r) => setImmediate(r)); return snap([rec(1, 'A')]); }, async write() {} };
  const { reader } = make({ store });
  const out = await Promise.all([reader.ready(), reader.getRecord(1), reader.search('a')]);
  assert.equal(reads, 1);
  assert.equal(out[0], true);
  assert.equal(out[1].noradId, 1);
  assert.equal(out[2].length, 1);
});

test('ready false when store is empty, getRecord still tries on-demand', async () => {
  const { reader, calls } = make({ store: createMemorySnapshotStore(null) });
  assert.equal(await reader.ready(), false);
  assert.equal(reader.generatedAtMs(), null);
  assert.equal(await reader.getRecord(5), null);
  assert.deepEqual(calls, [5]);
  assert.deepEqual(await reader.search('x'), []);
});

test('a throwing store is logged, treated as empty, retried after reloadMs', async () => {
  let reads = 0;
  const logged = [];
  const store = {
    async read() { reads++; if (reads === 1) throw new Error('boom'); return snap([rec(1, 'A')]); },
    async write() {},
  };
  const clock = { t: T0 };
  const reader = createCatalogReader({ store, onDemand: { get: async () => null }, now: () => clock.t, log: { warn: (...a) => logged.push(a), error: (...a) => logged.push(a) } });
  assert.equal(await reader.ready(), false);
  assert.equal(await reader.ready(), false);
  assert.equal(reads, 1);
  assert.equal(logged.length, 1);
  clock.t += RELOAD;
  assert.equal(await reader.ready(), true);
  assert.equal(reads, 2);
});

test('a failed reload keeps the previous snapshot', async () => {
  let reads = 0;
  const store = { async read() { reads++; if (reads > 1) throw new Error('boom'); return snap([rec(1, 'A')]); }, async write() {} };
  const { reader, clock } = make({ store });
  assert.equal(await reader.ready(), true);
  clock.t += RELOAD;
  assert.equal(await reader.ready(), true);
  assert.equal(reads, 2);
  assert.equal((await reader.getRecord(1)).name, 'A');
});

const SEARCH = snap([
  rec(25544, 'ISS (ZARYA)'),
  rec(49044, 'ISS (NAUKA)'),
  rec(60001, 'MY ISS CLONE'),
  rec(60002, 'STARLINK-1'),
  rec(60003, 'Starlink-2'),
  rec(25544 + 100000, 'EXACT'),
  rec(555, 'ZZZ'),
]);
async function searchReader() {
  return make({ store: createMemorySnapshotStore(SEARCH) }).reader;
}

test('search: exact id first', async () => {
  const r = await (await searchReader()).search('25544');
  assert.equal(r[0].noradId, 25544);
  assert.deepEqual(Object.keys(r[0]).sort(), ['name', 'noradId']);
});

test('search: curated alias beats prefix beats substring', async () => {
  const r = await (await searchReader()).search('iss');
  assert.deepEqual(r.map((x) => x.noradId), [25544, 49044, 60001]);
});

test('search: exact name, case-insensitive, trimmed', async () => {
  const r = await (await searchReader()).search('  zzz ');
  assert.deepEqual(r.map((x) => x.noradId), [555]);
  const s = await (await searchReader()).search('STARLINK');
  assert.deepEqual(s.map((x) => x.name), ['STARLINK-1', 'Starlink-2']);
});

test('search: limit and empty query', async () => {
  const reader = await searchReader();
  assert.equal((await reader.search('s', 2)).length, 2);
  assert.deepEqual(await reader.search(''), []);
  assert.deepEqual(await reader.search('   '), []);
});
