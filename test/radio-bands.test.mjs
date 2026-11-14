import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_IDS, bandOf, bandsOf, inBands, parseBands, isHearable, hasHearable } from '../lib/radio/bands.mjs';

test('bandOf places common satellite frequencies', () => {
  assert.equal(bandOf(29_450_000), 'hf');
  assert.equal(bandOf(137_100_000), 'wx');
  assert.equal(bandOf(145_800_000), '2m');
  assert.equal(bandOf(437_800_000), '70cm');
  assert.equal(bandOf(1_700_000_000), 'l');
  assert.equal(bandOf(2_265_000_000), 's');
  assert.equal(bandOf(149_025_000), 'other');
  assert.equal(bandOf(8_200_000_000), 'other');
});

test('parseBands: known ids only; all of them, or not a list, means every band', () => {
  assert.deepEqual(parseBands(['2m', '70cm', 'nope']), ['2m', '70cm']);
  assert.equal(parseBands([...BAND_IDS]), null);
  assert.equal(parseBands('2m'), null);
  assert.deepEqual(parseBands([]), []);
});

test('inBands keeps the downlinks you can hear and keeps a default among them', () => {
  const links = [
    { hz: 145_800_000, label: 'Voice', default: true },
    { hz: 437_800_000, label: 'Repeater' },
    { hz: 2_265_000_000, label: 'S-band' },
  ];
  assert.equal(inBands(links, null), links);
  assert.deepEqual(inBands(links, ['70cm', 's']).map((d) => [d.hz, d.default === true]), [[437_800_000, true], [2_265_000_000, false]]);
  assert.deepEqual(inBands(links, ['2m']).map((d) => d.hz), [145_800_000]);
  assert.deepEqual(inBands(links, ['hf']), []);
});

test('bandsOf lists each band once, in order', () => {
  assert.deepEqual(bandsOf([{ hz: 437e6 }, { hz: 145.8e6 }, { hz: 436e6 }]), ['2m', '70cm']);
  assert.deepEqual(bandsOf(undefined), []);
});

test('VHF and UHF are hearable, S-band and HF are not', () => {
  assert.ok(isHearable(145.8e6));
  assert.ok(isHearable(437.8e6));
  assert.ok(isHearable(137.1e6));
  assert.ok(isHearable(30e6));
  assert.ok(!isHearable(2.2e9));
  assert.ok(!isHearable(1.0e9));
  assert.ok(!isHearable(29.9e6));
  assert.ok(hasHearable([{ hz: 2.2e9 }, { hz: 437e6 }]));
  assert.ok(!hasHearable([{ hz: 2.2e9 }]));
  assert.ok(!hasHearable([]));
  assert.ok(!hasHearable(null));
});
