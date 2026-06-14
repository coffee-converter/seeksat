// test/tle-seed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordToTle, isNewerTle } from '../lib/pass-finder/tle-seed.js';

const L1_OLD = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const L1_NEW = '1 25544U 98067A   24002.50000000  .00000000  00000+0  00000+0 0  9991';
const L2     = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';

const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: L1_OLD, line2: L2, epochMs: 1, source: 'x', fetchedAtMs: 0 };

test('recordToTle maps a valid record to the Tle shape', () => {
  assert.deepEqual(recordToTle(REC), { name: 'ISS (ZARYA)', line1: L1_OLD, line2: L2 });
});

test('recordToTle returns null for missing record', () => {
  assert.equal(recordToTle(null), null);
  assert.equal(recordToTle(undefined), null);
});

test('recordToTle returns null for a malformed record (non-TLE lines)', () => {
  assert.equal(recordToTle({ name: 'x', line1: 'nope', line2: 'nope' }), null);
  assert.equal(recordToTle({ name: 'x', line1: L1_OLD }), null); // missing line2
});

test('recordToTle defaults a missing name to empty string', () => {
  assert.equal(recordToTle({ line1: L1_OLD, line2: L2 }).name, '');
});

test('isNewerTle: strictly-newer fetched epoch wins', () => {
  assert.equal(isNewerTle(L1_OLD, L1_NEW), true);
});

test('isNewerTle: equal or older fetched epoch does not win', () => {
  assert.equal(isNewerTle(L1_OLD, L1_OLD), false);
  assert.equal(isNewerTle(L1_NEW, L1_OLD), false);
});

test('isNewerTle: junk fetched line never wins', () => {
  assert.equal(isNewerTle(L1_OLD, 'garbage'), false);
  assert.equal(isNewerTle(L1_OLD, ''), false);
});

test('isNewerTle: empty/invalid current is replaceable by a valid fetch', () => {
  assert.equal(isNewerTle('', L1_NEW), true);
  assert.equal(isNewerTle('garbage', L1_NEW), true);
});
