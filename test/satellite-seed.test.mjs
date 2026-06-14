import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../lib/catalog.mjs';
import { recordsToSatelliteTles, selectionUpdate } from '../lib/pass-finder/satellite-seed.js';

const ISS_REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' };

test('recordsToSatelliteTles maps present records, skips missing/invalid', () => {
  const map = { '25544': ISS_REC, '20580': { line1: 'bad', line2: 'bad' } };
  const out = recordsToSatelliteTles(CATALOG, map);
  assert.deepEqual(out[25544], { name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' });
  assert.equal(out[20580], undefined);   // structurally invalid → skipped
  assert.equal(out[53807], undefined);   // absent → skipped
});

test('selectionUpdate pushes the seeded TLE and the default mode', () => {
  const tiles = { 25544: { name: 'ISS (ZARYA)', line1: '1 25544U ...', line2: '2 25544 ...' } };
  const u = selectionUpdate(CATALOG, tiles, 25544);
  assert.equal(u.selectedNoradId, 25544);
  assert.deepEqual(u.tle, tiles[25544]);
  assert.equal(u.mode, 'visual');
});

test('selectionUpdate applies radio mode for NOAA-19', () => {
  const u = selectionUpdate(CATALOG, {}, 33591);
  assert.equal(u.selectedNoradId, 33591);
  assert.equal(u.mode, 'radio');
  assert.equal(u.tle, undefined);   // no seeded TLE → no tle in the patch
});

test('selectionUpdate ignores an unknown id', () => {
  assert.equal(selectionUpdate(CATALOG, {}, 99999), null);
});
