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

// GPS satellites: 'active' names them by catalog name (NAVSTAR 43 (USA 132)),
// 'gps-ops' by the name people search for (GPS BIIR-2  (PRN 13)).
const navstar = { ...ISS_OMM, NORAD_CAT_ID: 24876, OBJECT_NAME: 'NAVSTAR 43 (USA 132)' };
const gpsName = { ...navstar, OBJECT_NAME: 'GPS BIIR-2  (PRN 13)' };

test('a GPS satellite takes its gps-ops name and keeps the catalog name as altName', () => {
  for (const results of [{ active: ok(navstar), 'gps-ops': ok(gpsName) }, { 'gps-ops': ok(gpsName), active: ok(navstar) }]) {
    const r = buildSnapshot({ results, previous: null, nowMs: NOW }).objects['24876'];
    assert.equal(r.name, 'GPS BIIR-2 (PRN 13)'); // spaces collapsed
    assert.equal(r.altName, 'NAVSTAR 43 (USA 132)');
  }
});

test('a refresh that skips gps-ops keeps the GPS name from the last one', () => {
  const first = buildSnapshot({ results: { active: ok(navstar), 'gps-ops': ok(gpsName) }, previous: null, nowMs: NOW });
  const next = buildSnapshot({
    results: { active: ok({ ...navstar, EPOCH: '2026-03-03T00:00:00.000000' }), 'gps-ops': { ok: false } },
    previous: first, nowMs: NOW + 4 * 3_600_000,
  });
  const r = next.objects['24876'];
  assert.equal(r.name, 'GPS BIIR-2 (PRN 13)');
  assert.equal(r.altName, 'NAVSTAR 43 (USA 132)');
  assert.ok(r.groups.includes('gps-ops'));
});

test('a satellite gps-ops no longer lists goes back to its catalog name', () => {
  const first = buildSnapshot({ results: { active: ok(navstar), 'gps-ops': ok(gpsName) }, previous: null, nowMs: NOW });
  const next = buildSnapshot({
    results: { active: ok(navstar), 'gps-ops': ok(other) }, previous: first, nowMs: NOW + 4 * 3_600_000,
  });
  assert.equal(next.objects['24876'].name, 'NAVSTAR 43 (USA 132)');
  assert.equal(next.objects['24876'].altName, undefined);
});

test('an object outside the name groups gets no altName', () => {
  const r = buildSnapshot({ results: { active: ok({ ...other, OBJECT_NAME: 'SOME  SAT' }) }, previous: null, nowMs: NOW }).objects['99999'];
  assert.equal(r.name, 'SOME  SAT');
  assert.equal(r.altName, undefined);
});
