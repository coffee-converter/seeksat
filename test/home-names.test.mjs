import test from 'node:test';
import assert from 'node:assert/strict';
import { satName } from '../lib/home/names.mjs';

const none = { records: new Map(), custom: [] };

test('satName uses the catalog short name', () => {
  assert.equal(satName(25544, none), 'ISS');
});

test('satName falls back to the record name, then NORAD id', () => {
  const records = new Map([[99998, { noradId: 99998, name: 'FOO-1' }]]);
  assert.equal(satName(99998, { records, custom: [] }), 'FOO-1');
  assert.equal(satName(99999, none), 'NORAD 99999');
});

test('satName uses a pasted satellite name', () => {
  const custom = [{ noradId: 99997, name: 'MY SAT', line1: '', line2: '' }];
  assert.equal(satName(99997, { records: new Map(), custom }), 'MY SAT');
});
