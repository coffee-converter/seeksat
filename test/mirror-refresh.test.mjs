import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshMirror, refreshResponse, MIN_REFETCH_MS, catnrKey } from '../lib/mirror/refresh.mjs';
import { buildSnapshot } from '../lib/mirror/snapshot.mjs';
import { createMemorySnapshotStore } from '../lib/mirror/snapshot-store.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const NOW = Date.parse('2026-03-02T00:00:00Z');
const HOUR = 3_600_000;
const other = { ...ISS_OMM, OBJECT_NAME: 'OTHER', NORAD_CAT_ID: 99999 };
const GROUPS = ['stations', 'active'];
const quiet = { warn() {}, error() {} };

test('all groups OK writes and counts unique ids', async () => {
  const store = createMemorySnapshotStore(null);
  const data = { stations: [ISS_OMM], active: [ISS_OMM, other] };
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async (g) => data[g], now: () => NOW, log: quiet });
  // A first run reports nothing new: every page would be.
  assert.deepEqual(r, { written: true, objectCount: 2, failedGroups: [], skippedGroups: [], addedIds: [], removedIds: [] });
  assert.equal(Object.keys((await store.read()).objects).length, 2);
});

test('every group failing writes nothing and keeps previous', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 3 * HOUR });
  const store = createMemorySnapshotStore(previous);
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async () => { throw new Error('down'); }, now: () => NOW, log: quiet });
  assert.equal(r.written, false);
  assert.deepEqual(r.failedGroups, GROUPS);
  assert.deepEqual(await store.read(), previous);
});

test('one group failing still writes and keeps its previous records', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 3 * HOUR });
  const store = createMemorySnapshotStore(previous);
  const fetchGroup = async (g) => { if (g === 'stations') throw new Error('down'); return [other]; };
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  assert.equal(r.written, true);
  assert.deepEqual(r.failedGroups, ['stations']);
  const s = await store.read();
  assert.ok(s.objects['25544']);
  assert.ok(s.objects['99999']);
  assert.equal(r.objectCount, 2);
});

test('null previous with all OK writes normally', async () => {
  const store = createMemorySnapshotStore(null);
  const r = await refreshMirror({ store, groups: ['stations'], fetchGroup: async () => [ISS_OMM], now: () => NOW, log: quiet });
  assert.equal(r.written, true);
  assert.equal(r.objectCount, 1);
});

test('groups are fetched sequentially', async () => {
  const store = createMemorySnapshotStore(null);
  let inflight = 0, max = 0;
  const fetchGroup = async () => { inflight++; max = Math.max(max, inflight); await new Promise((r) => setTimeout(r, 5)); inflight--; return [ISS_OMM]; };
  await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  assert.equal(max, 1);
});

test('all groups returning [] writes nothing and keeps previous', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 3 * HOUR });
  const store = createMemorySnapshotStore(previous);
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async () => [], now: () => NOW, log: quiet });
  assert.equal(r.written, false);
  assert.deepEqual(r.failedGroups, GROUPS);
  assert.deepEqual(await store.read(), previous);
});

test('one group returning [] carries its previous records forward', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 3 * HOUR });
  const store = createMemorySnapshotStore(previous);
  const fetchGroup = async (g) => (g === 'stations' ? [] : [other]);
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  assert.equal(r.written, true);
  assert.deepEqual(r.failedGroups, ['stations']);
  const s = await store.read();
  assert.ok(s.objects['25544']);
  assert.ok(s.objects['99999']);
});

test('refreshResponse: nothing written with failed groups is a 502', () => {
  const result = { written: false, objectCount: 7, failedGroups: ['active', 'stations'] };
  assert.deepEqual(refreshResponse(result), { status: 502, body: { ok: false, ...result } });
});

test('refreshResponse: a write, or no write with no failed groups, is a 200', () => {
  const wrote = { written: true, objectCount: 3, failedGroups: ['stations'] };
  assert.deepEqual(refreshResponse(wrote), { status: 200, body: { ok: true, ...wrote } });
  const empty = { written: false, objectCount: 0, failedGroups: [] };
  assert.deepEqual(refreshResponse(empty), { status: 200, body: { ok: true, ...empty } });
});

test('a group fetched under 2 hours ago is skipped and carried forward', async () => {
  assert.equal(MIN_REFETCH_MS, 2 * HOUR);
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 2 * HOUR + 1 });
  const store = createMemorySnapshotStore(previous);
  const asked = [];
  const fetchGroup = async (g) => { asked.push(g); return [other]; };
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  assert.deepEqual(asked, ['active']);
  assert.deepEqual(r, { written: true, objectCount: 2, failedGroups: [], skippedGroups: ['stations'], addedIds: [99999], removedIds: [] });
  const s = await store.read();
  assert.ok(s.objects['25544'], 'skipped group records carry forward');
  assert.equal(s.groupFetchedAtMs.stations, NOW - 2 * HOUR + 1, 'skipped group keeps its fetch time');
  assert.equal(s.groupFetchedAtMs.active, NOW);
});

test('a group fetched exactly 2 hours ago is fetched again', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 2 * HOUR });
  const asked = [];
  await refreshMirror({ store: createMemorySnapshotStore(previous), groups: ['stations'],
    fetchGroup: async (g) => { asked.push(g); return [ISS_OMM]; }, now: () => NOW, log: quiet });
  assert.deepEqual(asked, ['stations']);
});

test('running twice in a row makes no second CelesTrak request and returns 200', async () => {
  const store = createMemorySnapshotStore(null);
  let calls = 0;
  const fetchGroup = async () => { calls++; return [ISS_OMM]; };
  await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  const second = await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW + 60_000, log: quiet });
  assert.equal(calls, 2);
  assert.deepEqual(second, { written: false, objectCount: 1, failedGroups: [], skippedGroups: GROUPS });
  assert.equal(refreshResponse(second).status, 200);
});

test('a failed group keeps its previous fetch time', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 3 * HOUR });
  const store = createMemorySnapshotStore(previous);
  const fetchGroup = async (g) => { if (g === 'stations') throw new Error('down'); return [other]; };
  await refreshMirror({ store, groups: GROUPS, fetchGroup, now: () => NOW, log: quiet });
  assert.equal((await store.read()).groupFetchedAtMs.stations, NOW - 3 * HOUR);
});

const noaa19 = { ...ISS_OMM, OBJECT_NAME: 'NOAA 19', NORAD_CAT_ID: 33591 };

function pinned(byId) {
  const asked = [];
  const fetchByCatnr = async (id) => { asked.push(id); return byId(id); };
  return { asked, fetchByCatnr };
}

test('a pinned id no group holds is fetched by CATNR and tagged as such', async () => {
  const store = createMemorySnapshotStore(null);
  const p = pinned(async () => noaa19);
  const r = await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
    pinnedIds: [25544, 33591], fetchByCatnr: p.fetchByCatnr, now: () => NOW, log: quiet });
  assert.deepEqual(p.asked, [33591], 'ids a group supplied are not requested');
  assert.equal(r.objectCount, 2);
  const s = await store.read();
  assert.equal(s.objects['33591'].source, 'celestrak-catnr');
  assert.deepEqual(s.objects['33591'].groups, [catnrKey(33591)]);
  assert.equal(s.objects['25544'].source, 'celestrak-gp');
  assert.equal(s.groupFetchedAtMs[catnrKey(33591)], NOW);
});

test('a pinned id fetched under 2 hours ago is skipped and carried forward', async () => {
  const store = createMemorySnapshotStore(null);
  const first = pinned(async () => noaa19);
  await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
    pinnedIds: [33591], fetchByCatnr: first.fetchByCatnr, now: () => NOW, log: quiet });
  const second = pinned(async () => noaa19);
  const r = await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
    pinnedIds: [33591], fetchByCatnr: second.fetchByCatnr, now: () => NOW + HOUR, log: quiet });
  assert.deepEqual(second.asked, []);
  assert.deepEqual(r.skippedGroups, ['active', catnrKey(33591)]);
  assert.ok((await store.read()).objects['33591'], 'kept from the previous snapshot');
});

test('a pinned id that fails or is absent keeps its previous record', async () => {
  const store = createMemorySnapshotStore(null);
  await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
    pinnedIds: [33591], fetchByCatnr: async () => noaa19, now: () => NOW, log: quiet });
  for (const impl of [async () => { throw new Error('celestrak: paused'); }, async () => null]) {
    const later = NOW + 3 * HOUR;
    const r = await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
      pinnedIds: [33591], fetchByCatnr: impl, now: () => later, log: quiet });
    assert.deepEqual(r.failedGroups, [catnrKey(33591)]);
    assert.ok((await store.read()).objects['33591']);
  }
});

test('a pinned id now back in a group is not requested', async () => {
  const store = createMemorySnapshotStore(null);
  await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM],
    pinnedIds: [33591], fetchByCatnr: async () => noaa19, now: () => NOW, log: quiet });
  const p = pinned(async () => noaa19);
  await refreshMirror({ store, groups: ['active'], fetchGroup: async () => [ISS_OMM, noaa19],
    pinnedIds: [33591], fetchByCatnr: p.fetchByCatnr, now: () => NOW + 3 * HOUR, log: quiet });
  assert.deepEqual(p.asked, []);
  const rec = (await store.read()).objects['33591'];
  assert.deepEqual(rec.groups, ['active']);
});

test('downlinks: fetched on the first run, kept within a day, kept when a fetch fails', async () => {
  const store = createMemorySnapshotStore(null);
  const DL = { 25544: [{ hz: 145_800_000, label: 'Voice', mode: 'fm', source: 'satnogs', default: true }] };
  let asks = 0;
  const run = (nowMs, fetchDownlinks) => refreshMirror({
    store, groups: ['active'], fetchGroup: async () => [ISS_OMM], now: () => nowMs, log: quiet, fetchDownlinks,
  });
  const first = await run(NOW, async () => { asks++; return DL; });
  assert.equal(first.downlinkSatellites, 1);
  assert.deepEqual((await store.read()).downlinks, DL);
  assert.equal((await store.read()).downlinksFetchedAtMs, NOW);
  // 4 h later: not asked again.
  await run(NOW + 4 * HOUR, async () => { asks++; return {}; });
  assert.equal(asks, 1);
  assert.deepEqual((await store.read()).downlinks, DL);
  // A day later it asks; a failure keeps the last set and says so.
  const failed = await run(NOW + 25 * HOUR, async () => { asks++; throw new Error('SatNOGS down'); });
  assert.equal(asks, 2);
  assert.equal(failed.downlinksFailed, true);
  assert.deepEqual((await store.read()).downlinks, DL);
  assert.equal((await store.read()).downlinksFetchedAtMs, NOW);
});

test('a refresh reports the satellites it added and the ones gone, for search engines', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM, other] } }, previous: null, nowMs: NOW - 30 * HOUR });
  const r = await refreshMirror({ store: createMemorySnapshotStore(previous), groups: ['stations'], fetchGroup: async () => [ISS_OMM], now: () => NOW, log: quiet });
  assert.deepEqual(r.addedIds, []);
  assert.deepEqual(r.removedIds, [99999]);
});
