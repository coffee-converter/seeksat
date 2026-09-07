import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassCsv } from '../lib/pass-finder/radio-csv.js';

/** Value of `column` in the Nth data row, looked up by header name so a new
 *  column cannot silently shift what an assertion is checking. */
function cell(csv, column, row = 1) {
  const lines = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  const i = lines[0].split(',').indexOf(column);
  assert.ok(i >= 0, `no such column: ${column}`);
  return lines[row].split(',')[i];
}

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
  assert.match(csv, /# observer_elev_m:\s+180 \(lookup, orthometric\)/);
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
    'time_utc,az_deg,el_deg,ang_rate_deg_s,range_m,range_rate_mps,doppler_hz,rx_freq_hz,doppler_rate_hz_s,rel_signal_db',
  );
  const cells = lines[1].split(',');
  assert.equal(cell(csv, 'time_utc'), '2024-01-01T12:00:00.250Z', 'millisecond timestamps');
  assert.equal(cell(csv, 'az_deg'), '271.900');
  assert.equal(cell(csv, 'el_deg'), '12.346');
  assert.equal(cell(csv, 'range_m'), '812345.7');
});

test('a null frequency leaves the Doppler columns empty, not NaN', () => {
  const csv = radioPassCsv(
    [{ ...SAMPLES[0], dopplerHz: null }],
    { ...META, freqHz: null },
  );
  assert.ok(!csv.includes('NaN'));
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(cell(csv, 'doppler_hz'), '');
});


// ---- rx_freq_hz: the absolute frequency to tune to ----------------------

test('rx_freq_hz is downlink plus Doppler, as an integer Hz value', () => {
  // A rig takes an absolute frequency, not an offset. 437.800 MHz with
  // +9551.4 Hz of Doppler tunes to 437809551 Hz.
  const csv = radioPassCsv(SAMPLES, META);
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(cell(csv, 'rx_freq_hz'), String(Math.round(437_800_000 + 9551.4)));
});

test('rx_freq_hz is empty, not NaN, when no frequency is set', () => {
  const csv = radioPassCsv(
    [{ ...SAMPLES[0], dopplerHz: null }],
    { ...META, freqHz: null },
  );
  assert.ok(!csv.includes('NaN'));
  const row = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[1];
  assert.equal(cell(csv, 'rx_freq_hz'), '');
});

test('the header warns that rx_freq_hz is not good to its printed precision', () => {
  // The shape is good to ~1 Hz; the absolute value is not, because the
  // transmitter's own oscillator offset is unknown.
  const csv = radioPassCsv(SAMPLES, META);
  assert.match(csv, /^# rx_freq_hz\s+Hz\s+The frequency to tune to: downlink_hz \+ doppler_hz\./m);
  assert.match(csv, /~\+\/-1\.09 kHz/);
  assert.match(csv, /Rounded to whole Hz/);
});


// ---- header legend ------------------------------------------------------

test('every emitted column is documented in the header legend', () => {
  // The legend and the column list share one source of truth, so a column
  // added without a description is a construction error, not a doc lapse.
  const csv = radioPassCsv(SAMPLES, META);
  const header = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim())[0];
  for (const name of header.split(',')) {
    const doc = new RegExp(`^# ${name}\\s+\\S+\\s+\\S`, 'm');
    assert.match(csv, doc, `column ${name} has no legend entry`);
  }
});

test('the header is organised into labelled sections', () => {
  const csv = radioPassCsv(SAMPLES, META);
  for (const s of ['Satellite', 'Observer', 'Pass', 'Provenance', 'Columns', 'Notes']) {
    assert.match(csv, new RegExp(`^# --- ${s} -+$`, 'm'), `missing section ${s}`);
  }
});


test('legend entries are separated, so caveats do not run into the next column', () => {
  // A wrapped caveat sitting flush above the next column name was what made
  // the block read as one run-on paragraph.
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# --- Columns'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('# --- Notes'));
  const block = lines.slice(start, end);
  // Every column after the first is immediately preceded by a bare '#'.
  for (const name of ['az_deg', 'rx_freq_hz', 'rel_signal_db']) {
    const at = block.findIndex((l) => l.startsWith(`# ${name} `));
    assert.ok(at > 0, `${name} missing from legend`);
    assert.equal(block[at - 1], '#', `${name} has no separator above it`);
  }
});

test('legend lines stay inside the header rule width', () => {
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# --- Columns'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('# --- Notes'));
  for (const l of lines.slice(start + 1, end)) {
    assert.ok(l.length <= 94, `legend line overflows: ${l.length} chars\n${l}`);
  }
});


test('the oscillator tolerance scales with the carrier', () => {
  // 2.5 ppm is ~1.09 kHz at 437.800 MHz but only ~365 Hz at 145.800 - a
  // hardcoded figure was three times too pessimistic on 2 m.
  const uhf = radioPassCsv(SAMPLES, { ...META, freqHz: 437_800_000 });
  const vhf = radioPassCsv(SAMPLES, { ...META, freqHz: 145_800_000 });
  assert.match(uhf, /~\+\/-1\.09 kHz/);
  assert.match(vhf, /~\+\/-365 Hz/);
  assert.ok(!vhf.includes('1.09 kHz'), 'VHF must not carry the UHF figure');
});

test('the assumed oscillator spec is stated, not hidden', () => {
  // It is an assumption, not a published spacecraft figure, so a reader
  // must be able to see it and substitute their own.
  assert.match(radioPassCsv(SAMPLES, META), /assumed 2\.5 ppm/);
});


test('no header line exceeds the rule width, TLE lines included', () => {
  // The TLE lines are fixed-format 69 chars and cannot be wrapped, so they
  // set the floor for the rule rather than being allowed to overhang it.
  const csv = radioPassCsv(SAMPLES, {
    ...META,
    tleLine1: '1 25544U 98067A   26248.50000000  .00016717  00000-0  30777-3 0  9993',
    tleLine2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49814556 20000',
  });
  for (const l of csv.split('\n').filter((x) => x.startsWith('#'))) {
    assert.ok(l.length <= 94, `header line overflows at ${l.length}: ${l}`);
  }
});


test('every data row has exactly as many fields as the column header', () => {
  // The row is a hand-written literal in the emit loop; nothing else
  // catches a column added to COLUMN_DOCS without a matching value.
  const csv = radioPassCsv(SAMPLES, META);
  const rows = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  const width = rows[0].split(',').length;
  assert.ok(rows.length > 1, 'expected at least one data row');
  for (const r of rows.slice(1)) {
    assert.equal(r.split(',').length, width, `field count drifted: ${r}`);
  }
});


test('a truncated window says so, and a normal one stays quiet', () => {
  // aos/los/duration and the swing are all derived from the window bounds,
  // so a clamped window must not present them as a complete pass.
  const clamped = radioPassCsv(SAMPLES, { ...META, clamped: true });
  assert.match(clamped, /# window_truncated:\s+yes/);
  assert.match(clamped, /search cap, not horizon crossings/);
  assert.ok(!radioPassCsv(SAMPLES, META).includes('window_truncated'));
});


test('the CSV carries angular rate, the camera half of the pass', () => {
  // The chart draws this as its first panel and the feature exists for the
  // joint radio+optical reading, but the export - the thing you drive a
  // mount with - used to omit it entirely.
  const csv = radioPassCsv(SAMPLES, META);
  const lines = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim());
  assert.equal(cell(csv, 'ang_rate_deg_s'), SAMPLES[0].angRateDegPerSec.toFixed(4));
});

test('the clamped note stays aligned instead of printing a bare colon', () => {
  const csv = radioPassCsv(SAMPLES, { ...META, clamped: true });
  assert.ok(!csv.includes('# :'), 'no keyless continuation line');
  for (const l of csv.split('\n').filter((x) => x.startsWith('#'))) {
    assert.ok(l.length <= 94, `clamped note overflows at ${l.length}: ${l}`);
  }
});
