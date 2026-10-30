import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOmm, ommEpochMs, ommToTleLines } from '../lib/sat/omm.mjs';
import { ISS_OMM, ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';

test('ommToTleLines reproduces the fixture TLE exactly, checksums included', () => {
  assert.deepEqual(ommToTleLines(ISS_OMM), { line1: ISS_LINE1, line2: ISS_LINE2 });
});
test('ommToTleLines returns null for a 6-digit catalog number', () => {
  assert.equal(ommToTleLines({ ...ISS_OMM, NORAD_CAT_ID: 100001 }), null);
});
test('ommEpochMs reads EPOCH as UTC', () => {
  assert.equal(ommEpochMs(ISS_OMM), Date.UTC(2026, 2, 1, 12));
});
test('normalizeOmm coerces numeric strings and keeps text fields', () => {
  const o = normalizeOmm({ ...ISS_OMM, MEAN_MOTION: '15.5', NORAD_CAT_ID: '25544' });
  assert.equal(o.MEAN_MOTION, 15.5);
  assert.equal(o.NORAD_CAT_ID, 25544);
  assert.equal(o.OBJECT_NAME, 'ISS (ZARYA)');
});
test('normalizeOmm rejects a record missing MEAN_MOTION or with a non-integer NORAD_CAT_ID', () => {
  const { MEAN_MOTION, ...noMm } = ISS_OMM;
  assert.equal(normalizeOmm(noMm), null);
  assert.equal(normalizeOmm({ ...ISS_OMM, NORAD_CAT_ID: 'abc' }), null);
});
test('normalizeOmm rejects an unparseable EPOCH', () => {
  assert.equal(normalizeOmm({ ...ISS_OMM, EPOCH: 'yesterday' }), null);
});
test('ommToTleLines wraps REV_AT_EPOCH to 5 digits and keeps line 2 at 69 chars', () => {
  const { line2 } = ommToTleLines({ ...ISS_OMM, REV_AT_EPOCH: 123456 });
  assert.equal(line2.length, 69);
  assert.equal(line2.slice(63, 68), '23456');
});
test('ommToTleLines wraps ELEMENT_SET_NO to 4 digits and keeps line 1 at 69 chars', () => {
  const { line1 } = ommToTleLines({ ...ISS_OMM, ELEMENT_SET_NO: 12345 });
  assert.equal(line1.length, 69);
  assert.equal(line1.slice(64, 68), '2345');
});
