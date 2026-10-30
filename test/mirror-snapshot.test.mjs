import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, encodeSnapshot, decodeSnapshot } from '../lib/mirror/snapshot.mjs';
import { ommEpochMs } from '../lib/sat/omm.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const NOW = Date.parse('2026-03-02T00:00:00Z');
const older = { ...ISS_OMM, EPOCH: '2026-02-28T12:00:00.000000' };
const other = { ...ISS_OMM, OBJECT_NAME: 'OTHER', NORAD_CAT_ID: 99999 };
const ok = (...omms) => ({ ok: true, omms });

test('object in two OK groups becomes one record with both groups', () => {
  const s = buildSnapshot({ results: { stations: ok(ISS_OMM), active: ok(ISS_OMM) }, previous: null, nowMs: NOW });
  assert.equal(s.version, 1);
  assert.equal(s.generatedAtMs, NOW);
  assert.deepEqual(Object.keys(s.objects), ['25544']);
  const r = s.objects['25544'];
  assert.deepEqual(r.groups, ['stations', 'active']);
  assert.equal(r.name, 'ISS (ZARYA)');
  assert.equal(r.source, 'celestrak-gp');
  assert.equal(r.fetchedAtMs, NOW);
  assert.equal(r.epochMs, ommEpochMs(ISS_OMM));
});

test('previous undefined or null is accepted', () => {
  for (const previous of [undefined, null]) {
    const s = buildSnapshot({ results: { a: ok(ISS_OMM) }, previous, nowMs: NOW });
    assert.equal(Object.keys(s.objects).length, 1);
  }
});

test('older incoming keeps previous record, groups reflect this refresh', () => {
  const prev = buildSnapshot({ results: { stations: ok(ISS_OMM) }, previous: null, nowMs: NOW - 1000 });
  const s = buildSnapshot({ results: { stations: ok(older), active: ok(older) }, previous: prev, nowMs: NOW });
  const r = s.objects['25544'];
  assert.equal(r.epochMs, ommEpochMs(ISS_OMM));
  assert.equal(r.fetchedAtMs, NOW - 1000);
  assert.deepEqual(r.groups, ['stations', 'active']);
});

test('object only in a failed group carries forward unchanged', () => {
  const prev = buildSnapshot({ results: { stations: ok(ISS_OMM), active: ok(other) }, previous: null, nowMs: NOW - 1000 });
  const s = buildSnapshot({ results: { stations: { ok: false }, active: ok(other) }, previous: prev, nowMs: NOW });
  assert.deepEqual(s.objects['25544'], prev.objects['25544']);
  assert.equal(s.objects['99999'].fetchedAtMs, NOW);
});

test('object missing from all OK groups and no failed group is dropped', () => {
  const prev = buildSnapshot({ results: { stations: ok(ISS_OMM), active: ok(other) }, previous: null, nowMs: NOW - 1000 });
  const s = buildSnapshot({ results: { stations: ok(), active: ok(other) }, previous: prev, nowMs: NOW });
  assert.deepEqual(Object.keys(s.objects), ['99999']);
});

test('encode/decode round trip and version check', () => {
  const s = buildSnapshot({ results: { a: ok(ISS_OMM, other) }, previous: null, nowMs: NOW });
  const buf = encodeSnapshot(s);
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual(decodeSnapshot(buf), s);
  assert.deepEqual(decodeSnapshot(new Uint8Array(buf)), s);
  const bad = encodeSnapshot({ version: 2, generatedAtMs: 0, objects: {} });
  assert.throws(() => decodeSnapshot(bad), /version/);
});
