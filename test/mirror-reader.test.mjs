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

test('getRecord passes an unknown on-demand result through as undefined', async () => {
  const store = createMemorySnapshotStore(snap([rec(25544, 'ISS (ZARYA)')]));
  const { reader } = make({ store, onDemand: { get: async () => undefined } });
  assert.equal(await reader.getRecord(77777), undefined);
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

test('a throwing store is logged, treated as empty, retried after emptyRetryMs', async () => {
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
  clock.t += 29_999;
  assert.equal(await reader.ready(), false);
  assert.equal(reads, 1);
  clock.t += 1;
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
  assert.deepEqual(Object.keys(r[0]).sort(), ['bands', 'name', 'noradId', 'radio', 'tier']);
  assert.equal(r[0].tier, 0);
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

test('noradIds lists snapshot ids ascending, [] without a snapshot', async () => {
  const store = createMemorySnapshotStore(snap([rec(40000, 'B'), rec(25544, 'A'), rec(100000, 'C')]));
  const { reader } = make({ store });
  assert.deepEqual(await reader.noradIds(), [25544, 40000, 100000]);
  const empty = make({ store: createMemorySnapshotStore(null) });
  assert.deepEqual(await empty.reader.noradIds(), []);
});

test('GPS satellites are found by GPS, by PRN and by their catalog name', async () => {
  const store = createMemorySnapshotStore(snap([
    rec(24876, 'GPS BIIR-2 (PRN 13)', { altName: 'NAVSTAR 43 (USA 132)', groups: ['active', 'gps-ops'] }),
    rec(40294, 'GPS BIIF-9 (PRN 26)', { altName: 'NAVSTAR 73 (USA 260)', groups: ['active', 'gps-ops'] }),
    rec(100956, 'CPSAT'),
    rec(43450, 'APSTAR-6C'),
  ]));
  const { reader } = make({ store });
  const ids = async (q) => (await reader.search(q)).map((r) => r.noradId);
  const gps = await ids('GPS');
  assert.deepEqual(gps.slice(0, 2).sort(), [24876, 40294]);
  assert.equal((await ids('PRN 13'))[0], 24876);
  assert.equal((await ids('navstar 43'))[0], 24876);
});

test('a served record carries the snapshot downlinks for it, and only its own', async () => {
  const s = snap([rec(25544, 'ISS (ZARYA)'), rec(99999, 'QUIET')]);
  s.downlinks = { 25544: [{ hz: 145_800_000, label: 'Voice', mode: 'fm', source: 'satnogs', default: true }] };
  const { reader } = make({ store: createMemorySnapshotStore(s) });
  assert.equal((await reader.getRecord(25544)).downlinks[0].hz, 145_800_000);
  assert.equal((await reader.getSnapshotRecord(25544)).downlinks.length, 1);
  assert.equal((await reader.getRecord(99999)).downlinks, undefined);
});

test('radio-mode search: satellites with downlinks first, and downlink words find them', async () => {
  const s = snap([
    rec(70001, 'ALPHASAT A'),
    rec(70002, 'ALPHASAT B'),
    rec(70003, 'ALPHASAT C'),
  ]);
  s.downlinks = {
    70002: [{ hz: 145_800_000, label: 'Mode V SSTV', mode: 'sstv', source: 'satnogs', default: true }],
    70003: [{ hz: 437_000_000, label: 'Telemetry', mode: 'fm', source: 'satnogs', default: true }],
  };
  const { reader } = make({ store: createMemorySnapshotStore(s) });
  const plain = await reader.search('alphasat');
  assert.deepEqual(plain.map((r) => [r.noradId, r.radio]), [[70001, false], [70002, true], [70003, true]]);
  const radio = await reader.search('alphasat', 20, { radio: true });
  assert.deepEqual(radio.map((r) => r.noradId), [70002, 70003, 70001]);
  // A whole-name match outranks weaker matches with downlinks.
  const exact = await reader.search('alphasat a', 20, { radio: true });
  assert.equal(exact[0].noradId, 70001);
  // A downlink word: by mode or by a word in the label; not a name search.
  const ids = async (q) => (await reader.search(q, 20, { radio: true })).map((r) => r.noradId).filter((id) => id >= 70000);
  assert.deepEqual(await ids('sstv'), [70002]);
  assert.deepEqual(await ids('FM'), [70003]);
  assert.deepEqual(await ids('telemetry'), [70003]);
  // Outside radio mode the same word is an ordinary name search.
  assert.deepEqual((await reader.search('sstv')).filter((r) => r.noradId >= 70000), []);
});

test('radioIds: curated and SatNOGS satellites with downlinks that the snapshot has orbits for', async () => {
  // ISS is curated with downlinks; Tiangong is curated without, and has none
  // in the snapshot either; 70002 has SatNOGS downlinks; 70004 has downlinks
  // but no orbit in the snapshot (so a scan never asks CelesTrak for it).
  const s = snap([rec(25544, 'ISS (ZARYA)'), rec(48274, 'CSS (TIANHE)'), rec(70001, 'QUIET'), rec(70002, 'TALKER')]);
  s.downlinks = {
    70002: [{ hz: 145_800_000, label: 'Mode V SSTV', mode: 'sstv', source: 'satnogs', default: true }],
    70004: [{ hz: 437_000_000, label: 'Telemetry', mode: 'fm', source: 'satnogs', default: true }],
  };
  const { reader, calls } = make({ store: createMemorySnapshotStore(s) });
  assert.deepEqual(await reader.radioIds(), [25544, 70002]);
  assert.deepEqual(calls, []);
  // No snapshot: nothing, rather than an on-demand lookup.
  const { reader: empty } = make({ store: createMemorySnapshotStore(null) });
  assert.deepEqual(await empty.radioIds(), []);
});

test('visualIds: snapshot satellites in the visual group, ascending', async () => {
  const s = snap([rec(70003, 'R/B', { groups: ['visual'] }), rec(25544, 'ISS (ZARYA)', { groups: ['active', 'visual'] }), rec(70001, 'QUIET')]);
  const { reader, calls } = make({ store: createMemorySnapshotStore(s) });
  assert.deepEqual(await reader.visualIds(), [25544, 70003]);
  assert.deepEqual(calls, []);
  const { reader: empty } = make({ store: createMemorySnapshotStore(null) });
  assert.deepEqual(await empty.visualIds(), []);
});

test('skyCatalog: every snapshot satellite with its downlinks, one list per snapshot', async () => {
  const s = snap([rec(25544, 'ISS (ZARYA)'), rec(70001, 'QUIET'), rec(70002, 'TALKER')]);
  s.downlinks = { 70002: [{ hz: 145_800_000, label: 'Mode V SSTV', mode: 'sstv', source: 'satnogs', default: true }] };
  const { reader, calls } = make({ store: createMemorySnapshotStore(s) });
  const list = await reader.skyCatalog();
  assert.deepEqual(list.map((x) => [x.noradId, x.downlinks.length]).sort((a, b) => a[0] - b[0]), [[25544, 2], [70001, 0], [70002, 1]]);
  assert.equal(list.find((x) => x.noradId === 70001).record, s.objects['70001']);
  assert.equal(await reader.skyCatalog(), list, 'built once per snapshot');
  assert.deepEqual(calls, []);
  const { reader: empty } = make({ store: createMemorySnapshotStore(null) });
  assert.deepEqual(await empty.skyCatalog(), []);
});
