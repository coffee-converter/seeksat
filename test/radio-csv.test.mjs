import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassCsv } from '../lib/pass-finder/radio-csv.js';

const SAMPLES = [{
  tMs: Date.UTC(2024, 0, 1, 12, 0, 0, 250),
  rangeM: 812345.678, rangeRateMps: -6543.21, dopplerHz: 9551.4,
  elDeg: 12.3456, azDeg: 271.9, angRateDegPerSec: 0.3412, relSignalDb: -5.87,
}];

const META = {
  satelliteName: 'ISS (ZARYA)', observerName: 'Chicago',
  freqHz: 437_800_000, tleEpochMs: Date.UTC(2023, 11, 30, 12, 0, 0),
  clockSkewMs: -420, elevM: 180, elevSource: 'lookup',
};

test('header block records the inputs a reader needs to judge the data', () => {
  const csv = radioPassCsv(SAMPLES, META);
  assert.match(csv, /# satellite: ISS \(ZARYA\)/);
  assert.match(csv, /# downlink_hz: 437800000/);
  assert.match(csv, /# tle_epoch: 2023-12-30T12:00:00\.000Z/);
  assert.match(csv, /# tle_epoch_age_days: 2\.0/);
  assert.match(csv, /# observer_elev_m: 180 \(lookup\)/);
  assert.match(csv, /# clock_skew_ms: -420/);
});

test('TLE age is reported as a magnitude with direction, never bare negative', () => {
  // Propagating to a time BEFORE epoch is legitimate and gives a negative
  // age; "-0.45 days old" would read as a bug.
  const csv = radioPassCsv(SAMPLES, { ...META, tleEpochMs: Date.UTC(2024, 0, 3) });
  assert.match(csv, /# tle_epoch_age_days: 1\.5 \(before epoch\)/);
});

test('column order is fixed and values keep useful precision', () => {
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  assert.equal(
    lines[0],
    'time_utc,az_deg,el_deg,range_m,range_rate_mps,doppler_hz,doppler_rate_hz_s,rel_signal_db',
  );
  const cells = lines[1].split(',');
  assert.equal(cells[0], '2024-01-01T12:00:00.250Z', 'millisecond timestamps');
  assert.equal(cells[1], '271.900');
  assert.equal(cells[2], '12.346');
  assert.equal(cells[3], '812345.7');
});

test('a null frequency leaves the Doppler columns empty, not NaN', () => {
  const csv = radioPassCsv(
    [{ ...SAMPLES[0], dopplerHz: null }],
    { ...META, freqHz: null },
  );
  assert.ok(!csv.includes('NaN'));
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(row.split(',')[5], '');
});
