import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshMirror, refreshResponse } from '../lib/mirror/refresh.mjs';
import { buildSnapshot } from '../lib/mirror/snapshot.mjs';
import { createMemorySnapshotStore } from '../lib/mirror/snapshot-store.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const NOW = Date.parse('2026-03-02T00:00:00Z');
const other = { ...ISS_OMM, OBJECT_NAME: 'OTHER', NORAD_CAT_ID: 99999 };
const GROUPS = ['stations', 'active'];
const quiet = { warn() {}, error() {} };

test('all groups OK writes and counts unique ids', async () => {
  const store = createMemorySnapshotStore(null);
  const data = { stations: [ISS_OMM], active: [ISS_OMM, other] };
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async (g) => data[g], now: () => NOW, log: quiet });
  assert.deepEqual(r, { written: true, objectCount: 2, failedGroups: [] });
  assert.equal(Object.keys((await store.read()).objects).length, 2);
});

test('every group failing writes nothing and keeps previous', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 1000 });
  const store = createMemorySnapshotStore(previous);
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async () => { throw new Error('down'); }, now: () => NOW, log: quiet });
  assert.equal(r.written, false);
  assert.deepEqual(r.failedGroups, GROUPS);
  assert.deepEqual(await store.read(), previous);
});

test('one group failing still writes and keeps its previous records', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 1000 });
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
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 1000 });
  const store = createMemorySnapshotStore(previous);
  const r = await refreshMirror({ store, groups: GROUPS, fetchGroup: async () => [], now: () => NOW, log: quiet });
  assert.equal(r.written, false);
  assert.deepEqual(r.failedGroups, GROUPS);
  assert.deepEqual(await store.read(), previous);
});

test('one group returning [] carries its previous records forward', async () => {
  const previous = buildSnapshot({ results: { stations: { ok: true, omms: [ISS_OMM] } }, previous: null, nowMs: NOW - 1000 });
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
