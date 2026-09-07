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
  assert.match(csv, /# satellite:\s+ISS \(ZARYA\)/);
  assert.match(csv, /# downlink_hz:\s+437800000/);
  assert.match(csv, /# tle_epoch:\s+2023-12-30T12:00:00\.000Z/);
  assert.match(csv, /# tle_epoch_age_days:\s+2\.0/);
  assert.match(csv, /# observer_elev_m:\s+180 \(lookup\)/);
  assert.match(csv, /# clock_skew_ms:\s+-420/);
});

test('TLE age is reported as a magnitude with direction, never bare negative', () => {
  // Propagating to a time BEFORE epoch is legitimate and gives a negative
  // age; "-0.45 days old" would read as a bug.
  const csv = radioPassCsv(SAMPLES, { ...META, tleEpochMs: Date.UTC(2024, 0, 3) });
  assert.match(csv, /# tle_epoch_age_days:\s+1\.5 \(before epoch\)/);
});

test('column order is fixed and values keep useful precision', () => {
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  assert.equal(
    lines[0],
    'time_utc,az_deg,el_deg,range_m,range_rate_mps,doppler_hz,rx_freq_hz,doppler_rate_hz_s,rel_signal_db',
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


// ---- rx_freq_hz: the absolute frequency to tune to ----------------------

test('rx_freq_hz is downlink plus Doppler, as an integer Hz value', () => {
  // A rig takes an absolute frequency, not an offset. 437.800 MHz with
  // +9551.4 Hz of Doppler tunes to 437809551 Hz.
  const csv = radioPassCsv(SAMPLES, META);
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  const cells = row.split(',');
  assert.equal(cells[6], String(Math.round(437_800_000 + 9551.4)));
});

test('rx_freq_hz is empty, not NaN, when no frequency is set', () => {
  const csv = radioPassCsv(
    [{ ...SAMPLES[0], dopplerHz: null }],
    { ...META, freqHz: null },
  );
  assert.ok(!csv.includes('NaN'));
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(row.split(',')[6], '');
});

test('the header warns that rx_freq_hz is not good to its printed precision', () => {
  // The shape is good to ~1 Hz; the absolute value is not, because the
  // transmitter's own oscillator offset is unknown.
  const csv = radioPassCsv(SAMPLES, META);
  assert.match(csv, /^# rx_freq_hz\s+downlink_hz \+ doppler_hz/m);
  assert.match(csv, /ABSOLUTE accuracy is ~\+\/-1\.1 kHz/);
});


// ---- header legend ------------------------------------------------------

test('every emitted column is documented in the header legend', () => {
  // The legend and the column list share one source of truth, so a column
  // added without a description is a construction error, not a doc lapse.
  const csv = radioPassCsv(SAMPLES, META);
  const header = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[0];
  for (const name of header.split(',')) {
    const doc = new RegExp(`^# ${name}\\s+\\S`, 'm');
    assert.match(csv, doc, `column ${name} has no legend entry`);
  }
});

test('the header is organised into labelled sections', () => {
  const csv = radioPassCsv(SAMPLES, META);
  for (const s of ['Satellite', 'Observer', 'Pass', 'Provenance', 'Columns', 'Notes']) {
    assert.match(csv, new RegExp(`^# --- ${s} -+$`, 'm'), `missing section ${s}`);
  }
});
