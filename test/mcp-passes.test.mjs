// test/mcp-passes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compass } from '../lib/sat/pass-rows.mjs';
import { findPasses, getPosition, nextPassWindow, passRating, windowMagnitude, ESTIMATED_MAG_NOTE } from '../lib/mcp/passes.mjs';
import { findPasses as engineFindPasses } from '../lib/passes/engine.mjs';
import { makeTrack } from '../lib/sat/track.mjs';
import { peakMagnitudeInWindow } from '../lib/pass-finder/scoring.js';
import { visualQuality } from '../lib/sky/visual-rating.mjs';
import { passQuality } from '../lib/passes/quality.mjs';
import { cloudBadge } from '../lib/sky/cloud-badge.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';
import { ISS_OMM, ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');
const MOLNIYA_T0 = Date.parse('2023-06-28T03:00:00Z');
const START = Date.parse('2024-01-01T12:00:00Z');

test('getPosition returns a geodetic sub-point and sunlit flag', () => {
  const p = getPosition({ line1: LINE1, line2: LINE2 }, new Date(START));
  assert.ok(p.latDeg >= -90 && p.latDeg <= 90);
  assert.ok(p.lonDeg >= -180 && p.lonDeg <= 180);
  assert.ok(p.altitudeKm > 300 && p.altitudeKm < 500, `alt ${p.altitudeKm}`);
  assert.equal(typeof p.sunlit, 'boolean');
});

test('findPasses (radio mode) returns ordered windows with the expected shape', () => {
  // Radio mode is deterministic and not gated on twilight/illumination,
  // so an observer under the ground track will always see passes - a
  // robust shape/ordering check independent of sun geometry.
  const { passes } = findPasses({
    record: { line1: LINE1, line2: LINE2 },
    observer: { latDeg: 0, lonDeg: 100 },
    startMs: START, windowHours: 48,
    minElevationDeg: 10, mode: 'radio',
  });
  assert.ok(passes.length > 0, 'finds at least one pass');
  for (const p of passes) {
    assert.ok(Date.parse(p.rise) <= Date.parse(p.peak));
    assert.ok(Date.parse(p.peak) <= Date.parse(p.set));
    assert.ok(p.peakElevationDeg >= 10);
    assert.ok(p.durationSec > 0);
    assert.equal(typeof p.sunlit, 'boolean');
    assert.ok('peakMagnitude' in p);
    assert.ok(p.captureProbability >= 0 && p.captureProbability <= 1);
    assert.equal(p.quality, p.peakMagnitudeEstimated ? Math.min(p.captureProbability, 0.4) : p.captureProbability, 'quality is the old name, with its old cap for an estimated brightness');
    assert.ok(p.azimuthDeg.rise >= 0 && p.azimuthDeg.rise < 360);
  }
  const rises = passes.map(p => Date.parse(p.rise));
  assert.deepEqual(rises, [...rises].sort((a, b) => a - b), 'chronological');
});

const NP_LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const NP_LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const NP_NOW = Date.parse('2024-01-01T00:00:00Z');

test('nextPassWindow finds a radio pass over the equator within the scan', () => {
  const pass = nextPassWindow({
    record: { line1: NP_LINE1, line2: NP_LINE2 },
    observer: { latDeg: 0, lonDeg: 0 }, startMs: NP_NOW, windowHours: 72, mode: 'radio',
  });
  assert.ok(pass, 'a pass exists');
  assert.ok(pass.win.startMs >= NP_NOW && pass.win.endMs <= NP_NOW + 72 * 3_600_000);
  assert.ok(pass.peakMs >= pass.win.startMs && pass.peakMs <= pass.win.endMs);
});

test('nextPassWindow returns null where the satellite never reaches (lat 85, incl 51.6)', () => {
  const pass = nextPassWindow({
    record: { line1: NP_LINE1, line2: NP_LINE2 },
    observer: { latDeg: 85, lonDeg: 0 }, startMs: NP_NOW, windowHours: 72, mode: 'radio',
  });
  assert.equal(pass, null);
});

test('getPosition works for a 6-digit, OMM-only record', () => {
  const t = new Date(Date.UTC(2026, 2, 1, 13, 30));
  const six = getPosition({ omm: { ...ISS_OMM, NORAD_CAT_ID: 100001 } }, t);
  const five = getPosition({ line1: ISS_LINE1, line2: ISS_LINE2 }, t);
  assert.equal(six.latDeg, five.latDeg);
  assert.equal(six.lonDeg, five.lonDeg);
});

// Visual-mode fixture: with LINE1/LINE2 an observer at (-30, 150) gets
// sunlit, dark-sky passes within 48 h of START.
const VIS_OBS = { latDeg: -30, lonDeg: 150 };

test('findPasses (visual) estimates the magnitude when standardMag is null, and rates it no higher than Fair', () => {
  const args = { record: { line1: LINE1, line2: LINE2 }, observer: VIS_OBS, startMs: START, windowHours: 72, mode: 'visual' };
  const { passes } = findPasses({ ...args, standardMag: null });
  const known = findPasses({ ...args, standardMag: -1.8 }).passes;
  assert.ok(passes.length > 0, 'finds a visual pass');
  assert.equal(passes.length, known.length);
  passes.forEach((p, i) => {
    assert.equal(typeof p.peakMagnitude, 'number');
    assert.equal(p.peakMagnitudeEstimated, true);
    assert.ok(p.brightnessNote.startsWith(ESTIMATED_MAG_NOTE));
    assert.match(p.brightnessNote, /Fair/);
    assert.ok(p.rating.bars <= 2, `bars ${p.rating.bars}`);
    assert.ok(p.rating.bars <= known[i].rating.bars);
    assert.match(p.rating.reason, /no higher than Fair/);
    // The capture probability leaves brightness out: the same for both.
    assert.equal(p.captureProbability, known[i].captureProbability);
    // The cautious guess (a small satellite) is far fainter than the ISS.
    assert.ok(p.peakMagnitude > known[i].peakMagnitude + 5);
  });
  // Even the 83-degree pass: a guessed magnitude this faint rates Poor.
  assert.deepEqual(passes.find((p) => p.peakElevationDeg > 80).rating.word, 'Poor');
  assert.ok(known.some((p) => p.rating.bars >= 4), 'the ISS itself rates well');
});

test('pass ratings are the app\'s: visualQuality with the cloud badge, or the elevation bars in radio mode', () => {
  const args = { record: { line1: LINE1, line2: LINE2 }, observer: VIS_OBS, startMs: START, windowHours: 72, mode: 'visual', standardMag: -1.8 };
  const plain = findPasses(args).passes;
  assert.ok(plain.length > 1);
  // Overcast from the start: every pass inside 4 days is Cloudy, one bar.
  const forecast = { startMs: START - 3_600_000, hours: Array.from({ length: 120 }, () => 100) };
  const cloudy = findPasses({ ...args, cloud: forecast, nowMs: START }).passes;
  for (const p of cloudy) {
    assert.equal(p.rating.bars, 1);
    assert.match(p.rating.reason, /Cloudy forecast/);
  }
  // A city sky shows fewer stars, so the same pass has less headroom.
  const city = findPasses({ ...args, skyType: 'city' }).passes;
  plain.forEach((p, i) => assert.ok(city[i].rating.headroomMag <= p.rating.headroomMag));
  // Straight from the app's functions on an engine-shaped pass.
  const p = { peakMs: START + 86_400_000, maxElevDeg: 50, peakMag: -2, peakMagSunAltDeg: -15, peakSunAltDeg: -15 };
  const app = visualQuality(p, { skyType: 'suburban', cloud: cloudBadge(45, 1) });
  const forecast45 = { startMs: START, hours: Array.from({ length: 72 }, () => 45) };
  const r = passRating(p, 'visual', { skyType: 'suburban', cloud: forecast45, nowMs: START });
  assert.deepEqual([r.word, r.bars, r.level, r.reason], [app.label, app.bars, app.level, app.reason]);
  assert.equal(r.headroomMag, 6.25); // a -15 degree Sun leaves a suburban sky at mag 4.25
  const radio = passRating({ maxElevDeg: 35 }, 'radio');
  const q = passQuality({ maxElevDeg: 35 });
  assert.deepEqual(radio, { word: q.label, bars: q.bars, level: q.level, reason: q.reason });
});

test('findPasses (visual) treats a missing standardMag as unknown brightness', () => {
  const { passes } = findPasses({
    record: { line1: LINE1, line2: LINE2 }, observer: VIS_OBS,
    startMs: START, windowHours: 48, mode: 'visual',
  });
  assert.ok(passes.length > 0);
  for (const p of passes) assert.equal(p.peakMagnitudeEstimated, true);
});

test('findPasses (visual) still computes a magnitude when standardMag is known', () => {
  const { passes } = findPasses({
    record: { line1: LINE1, line2: LINE2 }, observer: VIS_OBS,
    startMs: START, windowHours: 48, mode: 'visual', standardMag: -1.8,
  });
  assert.ok(passes.length > 0);
  assert.equal(typeof passes[0].peakMagnitude, 'number');
  assert.equal(passes[0].peakMagnitudeEstimated, false);
  assert.equal('brightnessNote' in passes[0], false);
});

test('known magnitudes include the atmosphere\'s dimming, as the app shows them', () => {
  const record = { line1: LINE1, line2: LINE2 };
  const args = { record, observer: VIS_OBS, startMs: START, windowHours: 48, standardMag: -1.8 };
  // Visual: exactly the engine's peak magnitude, the number the app shows.
  const track = makeTrack(record, null);
  track.standardMag = -1.8;
  const engine = engineFindPasses({ track, observers: [{ id: 'o', ...VIS_OBS }], mode: 'visual', minElevDeg: 10, startMs: START, endMs: START + 48 * 3_600_000 });
  const rows = findPasses({ ...args, mode: 'visual' }).passes;
  assert.deepEqual(rows.map((p) => p.peakMagnitude), engine.passes.map((p) => Math.round(p.peakMag * 10) / 10));
  // Radio: the window's brightest moment, dimmer than without extinction.
  const radio = findPasses({ ...args, observer: { latDeg: 0, lonDeg: 100 }, mode: 'radio' }).passes;
  const lit = radio.filter((p) => p.peakMagnitude != null);
  assert.ok(lit.length > 0);
  for (const p of lit) {
    const raw = peakMagnitudeInWindow({ startMs: Date.parse(p.rise), endMs: Date.parse(p.set) }, [{ latDeg: 0, lonDeg: 100 }], track.ecefAt, -1.8);
    assert.ok(p.peakMagnitude >= Math.round(raw * 10) / 10, `${p.peakMagnitude} vs ${raw}`);
  }
  // A high site has thinner air above it, so less dimming.
  const win = { startMs: Date.parse(lit[0].rise), endMs: Date.parse(lit[0].set) };
  const low = windowMagnitude(win, { latDeg: 0, lonDeg: 100 }, track.ecefAt, -1.8);
  const high = windowMagnitude(win, { latDeg: 0, lonDeg: 100, elevM: 3000 }, track.ecefAt, -1.8);
  assert.ok(high < low);
});

test('findPasses (radio) estimates an unknown magnitude without changing the rating', () => {
  const args = { record: { line1: LINE1, line2: LINE2 }, observer: { latDeg: 0, lonDeg: 100 }, startMs: START, mode: 'radio' };
  const guessed = findPasses(args).passes;
  const known = findPasses({ ...args, standardMag: -1.8 }).passes;
  assert.ok(guessed.length > 0);
  assert.deepEqual(guessed.map((p) => [p.captureProbability, p.rating]), known.map((p) => [p.captureProbability, p.rating]));
  for (const p of guessed) {
    assert.equal(p.peakMagnitudeEstimated, true);
    assert.equal(p.brightnessNote, ESTIMATED_MAG_NOTE);
  }
});

test('findPasses and nextPassWindow work on an OMM-only (6-digit) record', () => {
  const start = Date.UTC(2026, 2, 1, 12);
  const args = { observer: { latDeg: 0, lonDeg: 0 }, startMs: start, windowHours: 48, mode: 'radio' };
  const omm = { omm: { ...ISS_OMM, NORAD_CAT_ID: 100001 } };
  const tle = { line1: ISS_LINE1, line2: ISS_LINE2 };
  const fromOmm = findPasses({ record: omm, ...args }).passes;
  assert.ok(fromOmm.length > 0, 'finds passes from OMM alone');
  assert.deepEqual(fromOmm, findPasses({ record: tle, ...args }).passes);
  const win = nextPassWindow({ record: omm, ...args });
  assert.ok(win);
  assert.deepEqual(win, nextPassWindow({ record: tle, ...args }));
});

test('GOES 16 from EN52ve: no passes, a nearly fixed pointing', () => {
  const r = findPasses({ record: recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), observer: EN52VE, startMs: GOES_T0 });
  assert.equal(r.passes.length, 0);
  assert.equal(r.stationary.visible, true);
  // This element set has 0.7 deg of inclination: it wanders about 1.4 deg a day.
  assert.equal(r.stationary.motion, 'nearly');
  assert.match(r.stationary.note, /^Nearly geostationary/);
  assert.equal(r.stationary.elevationRangeDeg.length, 2);
  assert.equal(r.unavailable, false);
  assert.ok(r.stationary.elevationDeg > 30 && r.stationary.elevationDeg < 45);
});

test('Molniya passes come back from the MCP search, several hours long', () => {
  const r = findPasses({ record: recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MOLNIYA 1-91'), observer: EN52VE,
    startMs: MOLNIYA_T0, windowHours: 72, mode: 'radio' });
  assert.ok(r.passes.some((p) => p.durationSec > 4 * 3600));
});

test('MCP pass rows keep their shape', () => {
  const [p] = findPasses({ record: { line1: LINE1, line2: LINE2 }, observer: { latDeg: 0, lonDeg: 100 }, startMs: START, mode: 'radio' }).passes;
  assert.deepEqual(Object.keys(p).sort(), ['azimuthDeg', 'brightnessNote', 'direction', 'durationSec', 'entersShadow', 'inProgress', 'leavesShadow',
    'peak', 'peakElevationDeg', 'peakMagnitude', 'peakMagnitudeEstimated', 'peakRangeKm', 'quality', 'rating', 'rise', 'set', 'sunlit', 'visibleFrom',
    'visibleUntil', 'captureProbability'].sort());
});

test('pass rows give compass words for each azimuth and the range at the peak', () => {
  const { passes } = findPasses({ record: { line1: LINE1, line2: LINE2 }, observer: { latDeg: 0, lonDeg: 100 }, startMs: START, mode: 'radio' });
  assert.ok(passes.length > 0);
  for (const p of passes) {
    for (const k of ['rise', 'peak', 'set']) assert.equal(p.direction[k], compass(p.azimuthDeg[k]));
    // A low orbit: a few hundred km overhead, up to about 2,000 km at a low peak.
    assert.ok(p.peakRangeKm > 300 && p.peakRangeKm < 2500, String(p.peakRangeKm));
  }
  const high = passes.reduce((a, b) => (b.peakElevationDeg > a.peakElevationDeg ? b : a));
  const low = passes.reduce((a, b) => (b.peakElevationDeg < a.peakElevationDeg ? b : a));
  assert.ok(high.peakRangeKm < low.peakRangeKm);
});

test('findPasses flags elements that cannot be propagated', () => {
  const dead = { noradId: 25544, name: 'ISS', omm: { ...ISS_OMM, MEAN_MOTION: 17.5, EPOCH: '2018-01-01T00:00:00.000000', BSTAR: 0.01 }, epochMs: Date.parse('2018-01-01T00:00:00Z') };
  const r = findPasses({ record: dead, observer: EN52VE, startMs: Date.parse('2026-03-01T12:00:00Z') });
  assert.deepEqual(r, { passes: [], stationary: null, unavailable: true });
});

// The seen part of a pass, and where it crosses the shadow edge. With the
// LINE1/LINE2 fixture, evening passes over (-30, 150) fade into Earth's
// shadow mid-sky, and dawn passes over (50, 0) appear out of it.
const VIS_ARGS = { record: { line1: LINE1, line2: LINE2 }, startMs: START, windowHours: 72, standardMag: -1.8 };

test('visual pass rows: the seen window is the row itself, and an evening pass fades into shadow', () => {
  const { passes } = findPasses({ ...VIS_ARGS, observer: VIS_OBS, mode: 'visual' });
  assert.ok(passes.length > 0);
  for (const p of passes) {
    assert.equal(p.visibleFrom, p.rise);
    assert.equal(p.visibleUntil, p.set);
    assert.equal(p.leavesShadow, null);
  }
  // Every one of these ends in shadow while still up, so "set" is the fade.
  assert.ok(passes.every((p) => p.entersShadow === p.set), JSON.stringify(passes.map((p) => [p.set, p.entersShadow])));
});

test('visual pass rows: a dawn pass appears out of the shadow mid-sky', () => {
  const { passes } = findPasses({ ...VIS_ARGS, windowHours: 48, observer: { latDeg: 50, lonDeg: 0 }, mode: 'visual' });
  const dawn = passes.filter((p) => p.leavesShadow);
  assert.ok(dawn.length > 0, 'finds a pass leaving the shadow');
  for (const p of dawn) {
    assert.equal(p.leavesShadow, p.rise);
    assert.equal(p.visibleFrom, p.rise);
    assert.equal(p.entersShadow, null);
  }
});

test('radio pass rows say when the pass can be seen: null in daylight, cut short by the shadow', () => {
  const { passes } = findPasses({ ...VIS_ARGS, observer: VIS_OBS, mode: 'radio' });
  const never = passes.filter((p) => p.visibleFrom === null);
  const seen = passes.filter((p) => p.visibleFrom !== null);
  assert.ok(never.length > 0 && seen.length > 0);
  for (const p of never) assert.equal(p.visibleUntil, null);
  for (const p of seen) {
    assert.ok(p.rise <= p.visibleFrom && p.visibleFrom < p.visibleUntil && p.visibleUntil <= p.set);
  }
  // The same pass in visual mode is exactly the seen part of the radio pass.
  const visual = findPasses({ ...VIS_ARGS, observer: VIS_OBS, mode: 'visual' }).passes;
  for (const v of visual) {
    const r = seen.find((p) => p.visibleFrom === v.rise);
    assert.ok(r, `radio pass for ${v.rise}`);
    assert.equal(r.visibleUntil, v.set);
    assert.equal(r.entersShadow, v.entersShadow);
  }
  // One of them goes into shadow before it sets: seen until then, not to the set.
  assert.ok(seen.some((p) => p.entersShadow && p.entersShadow < p.set && p.visibleUntil === p.entersShadow));
});

test('radio rows rate by height and by range at the peak', async () => {
  const { radioQuality } = await import('../lib/passes/quality.mjs');
  const { rankKey } = await import('../lib/mcp/passes.mjs');
  const record = recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2);
  const { passes } = findPasses({ record, observer: EN52VE, startMs: MOLNIYA_T0, windowHours: 48, minElevationDeg: 10, mode: 'radio' });
  assert.ok(passes.length > 0);
  let cut = 0;
  for (const row of passes) {
    const q = radioQuality({ maxElevDeg: row.peakElevationDeg }, row.peakRangeKm);
    assert.equal(row.rating.bars, q.bars, `${row.peak}`);
    if (q.bars < passQuality({ maxElevDeg: row.peakElevationDeg }).bars) cut++;
  }
  assert.ok(cut > 0, 'a Molniya orbit is far enough to lose bars');
  // The rank key rates the same pass the same way.
  const track = makeTrack(record);
  const obs = { id: 'o', name: 'o', latDeg: EN52VE.latDeg, lonDeg: EN52VE.lonDeg, tz: 'UTC' };
  const r = engineFindPasses({ track, observers: [obs], mode: 'radio', minElevDeg: 10, startMs: MOLNIYA_T0, endMs: MOLNIYA_T0 + 48 * 3_600_000 });
  const key = rankKey(r.passes[0], track, obs, 'radio', 10);
  assert.equal(key.rating.bars, passes[0].rating.bars);
});
