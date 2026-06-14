// test/mcp-tle-record.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTleRecord, mergeRecord, tleAgeHours } from '../lib/mcp/tle-record.mjs';

const fetched = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990',
  line2: '2 25544  51.6400 100.0000 0000000   0.0000   0.0000 15.50000000000000',
  epochMs: 1000,
  source: 'wheretheiss',
};

test('makeTleRecord stamps fetchedAtMs and keeps fields', () => {
  const r = makeTleRecord(25544, fetched, 5000);
  assert.equal(r.noradId, 25544);
  assert.equal(r.line1, fetched.line1);
  assert.equal(r.epochMs, 1000);
  assert.equal(r.source, 'wheretheiss');
  assert.equal(r.fetchedAtMs, 5000);
});

test('mergeRecord keeps the newer epoch (incoming newer)', () => {
  const existing = makeTleRecord(25544, { ...fetched, epochMs: 1000 }, 0);
  const incoming = makeTleRecord(25544, { ...fetched, epochMs: 2000 }, 10);
  assert.equal(mergeRecord(existing, incoming).epochMs, 2000);
});

test('mergeRecord rejects an older incoming epoch (no clobber)', () => {
  const existing = makeTleRecord(25544, { ...fetched, epochMs: 2000 }, 0);
  const incoming = makeTleRecord(25544, { ...fetched, epochMs: 1000 }, 10);
  assert.equal(mergeRecord(existing, incoming).epochMs, 2000);
});

test('mergeRecord accepts incoming when no existing record', () => {
  const incoming = makeTleRecord(25544, fetched, 10);
  assert.equal(mergeRecord(null, incoming).epochMs, 1000);
});

test('tleAgeHours computes hours since epoch', () => {
  const r = makeTleRecord(25544, { ...fetched, epochMs: 0 }, 0);
  assert.equal(tleAgeHours(r, 3_600_000), 1);
});
