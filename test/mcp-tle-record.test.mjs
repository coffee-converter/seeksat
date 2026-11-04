// test/mcp-tle-record.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecord, tleAgeHours } from '../lib/mcp/tle-record.mjs';

const rec = (epochMs) => ({
  noradId: 25544,
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990',
  line2: '2 25544  51.6400 100.0000 0000000   0.0000   0.0000 15.50000000000000',
  epochMs,
  source: 'wheretheiss',
  fetchedAtMs: 0,
});

test('mergeRecord keeps the newer epoch (incoming newer)', () => {
  assert.equal(mergeRecord(rec(1000), rec(2000)).epochMs, 2000);
});

test('mergeRecord rejects an older incoming epoch (no clobber)', () => {
  assert.equal(mergeRecord(rec(2000), rec(1000)).epochMs, 2000);
});

test('mergeRecord accepts incoming when no existing record', () => {
  assert.equal(mergeRecord(null, rec(1000)).epochMs, 1000);
});

test('tleAgeHours computes hours since epoch', () => {
  assert.equal(tleAgeHours(rec(0), 3_600_000), 1);
});
