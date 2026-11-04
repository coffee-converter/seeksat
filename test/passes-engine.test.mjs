import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subpoint } from '../lib/map/geometry.mjs';
import { satAltitudeDeg } from '../lib/pass-finder/visibility.js';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses, accuracyNote, stationaryPointing, peakMagnitude } from '../lib/passes/engine.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, INCLINED_GEO_LINE1, INCLINED_GEO_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;
const iss = ISS, ISS_T0 = T0;
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');

test('ISS from EN52ve: 17 radio passes in 3 days, the first at 13:16Z for about 5 minutes', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + 3 * DAY });
  assert.equal(r.kind, 'passes');
  assert.equal(r.passes.length, 17);
  const p = r.passes[0];
  assert.ok(Math.abs(p.startMs - Date.parse('2026-03-01T13:16:00Z')) < 60_000);
  assert.ok(Math.abs(p.durationMs / 60_000 - 5.3) < 0.3);
  assert.ok(p.maxElevDeg >= 10 && p.maxElevDeg <= 90);
  assert.ok(p.peakMs > p.startMs && p.peakMs < p.endMs);
});
test('visual mode returns only visible passes', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'visual', startMs: T0, endMs: T0 + 3 * DAY });
  assert.equal(r.passes.length, 4);
  assert.ok(r.passes.every((p) => p.visible));
});
test('Molniya passes last hours, some over 8', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const s = Date.parse('2023-06-27T04:00:00Z');
  const r = findPasses({ track: m, observers: [EN52VE], mode: 'radio', startMs: s, endMs: s + 3 * DAY });
  assert.equal(r.passes.length, 7);
  assert.ok(r.passes.some((p) => p.durationMs > 8 * 3_600_000));
});
test('GOES-16 is a fixed pointing from EN52ve and never rises at 80° N', () => {
  const g = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
  const s = Date.parse('2026-10-31T15:00:00Z');
  const here = findPasses({ track: g, observers: [EN52VE], startMs: s });
  assert.equal(here.kind, 'stationary');
  assert.equal(here.visible, true);
  const pt = here.pointing[0];
  assert.ok(pt.elDeg > 37.7 && pt.elDeg < 39.3);
  assert.ok(pt.azDeg > 203.3 && pt.azDeg < 204.2);
  const north = findPasses({ track: g, observers: [{ id: 'n', latDeg: 80, lonDeg: -88 }], startMs: s });
  assert.deepEqual([north.kind, north.visible], ['stationary', false]);
});
test('joint windows lie inside the single-observer windows', () => {
  const toronto = { id: 'yyz', latDeg: 43.65, lonDeg: -79.38 };
  const one = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + 3 * DAY }).passes;
  const both = findPasses({ track: ISS, observers: [EN52VE, toronto], startMs: T0, endMs: T0 + 3 * DAY }).passes;
  assert.ok(both.length >= 1 && both.length <= one.length);
  for (const j of both) assert.ok(one.some((p) => p.startMs <= j.startMs && j.endMs <= p.endMs));
});
test('a pass in progress at the search start is flagged, not given a rise time', () => {
  const first = findPasses({ track: ISS, observers: [EN52VE], startMs: T0, endMs: T0 + DAY }).passes[0];
  const mid = Math.round((first.startMs + first.endMs) / 2);
  const p = findPasses({ track: ISS, observers: [EN52VE], startMs: mid, endMs: mid + DAY }).passes[0];
  assert.equal(p.inProgress, true);
  assert.equal(p.startMs, mid);
});
test('elements that will not propagate are unavailable, not "no passes"', () => {
  const dead = { ...ISS, ecefAt: () => null };
  assert.deepEqual(findPasses({ track: dead, observers: [EN52VE], startMs: T0 }), { kind: 'unavailable', reason: 'propagation' });
});
test('the default horizon is 10 days', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], startMs: T0 });
  assert.ok(r.passes.at(-1).endMs <= T0 + 10 * DAY);
  assert.ok(r.passes.at(-1).startMs > T0 + 9 * DAY);
});
test('accuracyNote', () => {
  assert.equal(accuracyNote(T0, T0 + 3 * DAY), null);
  assert.deepEqual(accuracyNote(T0, T0 + 4.24 * DAY), { ageDays: 4.2, text: 'Elements are 4.2 days old at this pass, so times may be off by a minute or more.' });
});

test('no observers means no passes, not a crash', () => {
  assert.deepEqual(findPasses({ track: ISS, observers: [], startMs: T0 }), { kind: 'passes', passes: [] });
});

const round1 = (x) => Math.round(x * 10) / 10;
test('GEO pointing values are rounded to 0.1°', () => {
  const r = findPasses({ track: goes, observers: [EN52VE], startMs: GOES_T0 });
  for (const k of ['azDeg', 'elDeg', 'elMinDeg', 'elMaxDeg']) assert.equal(r.pointing[0][k], round1(r.pointing[0][k]));
});
test('GEO pointing starts from the first sample that propagates', () => {
  const first = stationaryPointing(goes, [EN52VE], GOES_T0)[0];
  const step = 600_000;
  const holey = { ...goes, ecefAt: (d) => {
    const k = (d.getTime() - GOES_T0) / step;
    return k === 0 || k === 2 || k === 5 ? null : goes.ecefAt(d);
  } };
  const p = stationaryPointing(holey, [EN52VE], GOES_T0)[0];
  const second = stationaryPointing({ ...goes, ecefAt: (d) => goes.ecefAt(d) }, [EN52VE], GOES_T0 + step)[0];
  for (const k of ['azDeg', 'elDeg', 'elMinDeg', 'elMaxDeg']) assert.ok(Number.isFinite(p[k]), k);
  assert.equal(p.azDeg, second.azDeg);
  assert.equal(p.elDeg, second.elDeg);
  assert.ok(first.azDeg !== null);
});
test('GEO pointing is all null when no sample propagates', () => {
  const dead = { ...goes, ecefAt: () => null };
  assert.deepEqual(stationaryPointing(dead, [EN52VE], GOES_T0)[0], { obsId: 'en52ve', azDeg: null, elDeg: null, elMinDeg: null, elMaxDeg: null, azMinDeg: null, azMaxDeg: null });
});
test('the last pass runs past a search end that cuts it', () => {
  const first = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }).passes[0];
  const cut = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0, endMs: first.peakMs }).passes;
  assert.equal(cut.at(-1).runsPastEnd, true);
  assert.equal(cut.at(-1).endMs, first.peakMs);
  assert.ok(cut.slice(0, -1).every((p) => !p.runsPastEnd));
});
test('an inclined geosynchronous orbit near the visibility edge has daily passes', () => {
  const t = makeTrack(recordFrom(INCLINED_GEO_LINE1, INCLINED_GEO_LINE2, 'INCLINED GEO'));
  assert.equal(t.orbitClass, 'geo');
  const lonDeg = subpoint(t.ecefAt(new Date(GOES_T0))).lonDeg;
  const r = findPasses({ track: t, observers: [{ id: 'far-north', latDeg: 70, lonDeg }], startMs: GOES_T0 });
  assert.equal(r.kind, 'passes');
  assert.ok(r.passes.length >= 5);
  assert.ok(r.passes.every((p) => p.durationMs < 24 * 3_600_000));
});
test('a joint pass reports the lower of the observers\' elevations at its peak', () => {
  const other = { id: 'b', latDeg: 41.0, lonDeg: -84.0 };
  for (const p of findPasses({ track: iss, observers: [EN52VE, other], startMs: ISS_T0 }).passes) {
    const e = iss.ecefAt(new Date(p.peakMs));
    assert.equal(p.maxElevDeg, round1(Math.min(satAltitudeDeg(EN52VE, e), satAltitudeDeg(other, e))));
  }
});

// Visual peak magnitude. makeTrack without a catalogue entry has no
// standardMag, so the bright track supplies the ISS's -1.8.
const ISS_BRIGHT = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'), { standardMag: -1.8 });
const TWILIGHT_SUN_DEG = -6;
const MAG_FIELDS = ['peakMag', 'peakMagSunAltDeg', 'peakMagElDeg', 'peakSunAltDeg'];

test('visual ISS passes carry a peak magnitude from a dark, sunlit sample', () => {
  const r = findPasses({ track: ISS_BRIGHT, observers: [EN52VE], mode: 'visual', startMs: T0, endMs: T0 + 3 * DAY });
  assert.ok(r.passes.length >= 1);
  for (const p of r.passes) {
    assert.ok(Number.isFinite(p.peakMag) && p.peakMag > -4 && p.peakMag < 3, `peakMag ${p.peakMag}`);
    assert.ok(p.peakMagSunAltDeg <= TWILIGHT_SUN_DEG);
    assert.ok(p.peakMagElDeg > 0 && p.peakMagElDeg <= 90);
    assert.ok(Number.isFinite(p.peakSunAltDeg) && p.peakSunAltDeg <= TWILIGHT_SUN_DEG);
  }
});
test('a track with no published brightness gets a null peakMag but keeps the other fields', () => {
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'visual', startMs: T0, endMs: T0 + 3 * DAY });
  assert.equal(ISS.standardMag, null);
  assert.ok(r.passes.length >= 1);
  for (const p of r.passes) {
    for (const k of MAG_FIELDS) assert.ok(k in p, k);
    assert.equal(p.peakMag, null);
    assert.equal(p.peakMagSunAltDeg, null);
    assert.equal(p.peakMagElDeg, null);
    assert.ok(Number.isFinite(p.peakSunAltDeg));
  }
});
test('radio passes do not gain the magnitude fields', () => {
  const r = findPasses({ track: ISS_BRIGHT, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  for (const p of r.passes) for (const k of MAG_FIELDS) assert.ok(!(k in p), k);
});
test('the magnitude fields are plain numbers or null, so they cross postMessage', () => {
  const r = findPasses({ track: ISS_BRIGHT, observers: [EN52VE], mode: 'visual', startMs: T0, endMs: T0 + 3 * DAY });
  assert.deepEqual(structuredClone(r), r);
  for (const p of r.passes) for (const k of MAG_FIELDS) assert.ok(p[k] === null || typeof p[k] === 'number', k);
});

// A dusk pass from 50° S, 165° W on 2026-03-03: the ISS culminates near 70°
// at 06:21Z with the Sun at about -5.7°, so its highest, brightest moment is
// in a twilight sky. The Sun reaches -6° at about 06:23Z, as the ISS sinks
// through 23°, and the visual pass is only that dark tail.
const DUSK_OBS = { id: 'dusk', latDeg: -50, lonDeg: -165 };
const duskRadioPass = () => findPasses({
  track: ISS_BRIGHT, observers: [DUSK_OBS], mode: 'radio', minElevDeg: 0, startMs: T0, endMs: T0 + 3 * DAY,
}).passes.find((p) => Math.abs(p.peakMs - Date.parse('2026-03-03T06:21:08Z')) < 60_000);

test('a pass that peaks in twilight takes its peak magnitude from the dark part', () => {
  const radio = duskRadioPass();
  assert.ok(radio && radio.maxElevDeg > 60);
  const dusk = findPasses({ track: ISS_BRIGHT, observers: [DUSK_OBS], mode: 'visual', minElevDeg: 0, startMs: T0, endMs: T0 + 3 * DAY })
    .passes.find((p) => p.startMs >= radio.startMs && p.endMs <= radio.endMs);
  assert.ok(dusk, 'the dark tail of the dusk pass is a visual pass');
  assert.ok(dusk.startMs > radio.peakMs);
  assert.ok(Number.isFinite(dusk.peakMag));
  assert.ok(dusk.peakMagSunAltDeg <= TWILIGHT_SUN_DEG);
  assert.ok(dusk.peakMagElDeg < 30, `peakMagElDeg ${dusk.peakMagElDeg}`);
});
test('peakMagnitude skips twilight samples even inside the window it is given', () => {
  const radio = duskRadioPass();
  const dark = peakMagnitude(ISS_BRIGHT, [DUSK_OBS], radio.startMs, radio.endMs);
  assert.ok(Number.isFinite(dark.peakMag));
  assert.ok(dark.peakMagSunAltDeg <= TWILIGHT_SUN_DEG);
  assert.ok(dark.peakMagElDeg < 30, `peakMagElDeg ${dark.peakMagElDeg}`);
  // Over the twilight half alone, nothing qualifies.
  const twilight = peakMagnitude(ISS_BRIGHT, [DUSK_OBS], radio.startMs, radio.peakMs);
  assert.deepEqual(twilight, { peakMag: null, peakMagSunAltDeg: null, peakMagElDeg: null });
  // No published brightness: no magnitude at all.
  assert.deepEqual(peakMagnitude(ISS, [DUSK_OBS], radio.startMs, radio.endMs), { peakMag: null, peakMagSunAltDeg: null, peakMagElDeg: null });
});
test('peakMagnitude needs every observer in a dark sky', () => {
  const radio = duskRadioPass();
  // At 90° E it is about midday during this pass.
  const day = { id: 'day', latDeg: 50, lonDeg: 90 };
  assert.deepEqual(peakMagnitude(ISS_BRIGHT, [DUSK_OBS, day], radio.startMs, radio.endMs), { peakMag: null, peakMagSunAltDeg: null, peakMagElDeg: null });
});

test('every pass has finite start and end elevations; radio passes have time above 10 and 30 degrees', () => {
  for (const mode of ['radio', 'visual']) {
    const r = findPasses({ track: ISS, observers: [EN52VE], mode, startMs: T0, endMs: T0 + 3 * DAY });
    assert.ok(r.passes.length > 0);
    for (const p of r.passes) {
      assert.ok(Number.isFinite(p.startElevDeg) && Number.isFinite(p.endElevDeg));
    }
  }
  const r = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + 3 * DAY });
  for (const p of r.passes) assert.ok(p.msAbove10 >= p.msAbove30 && p.msAbove30 >= 0);
  assert.ok(r.passes.some((p) => p.msAbove10 > 0));
});
test('a pass cut short by a propagation failure keeps real end bearings', () => {
  const full = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  const p = full.passes[0];
  const dieMs = Math.floor((p.peakMs + p.endMs) / 2000) * 1000;
  const dying = { ...ISS, ecefAt: (d) => (d.getTime() >= dieMs ? null : ISS.ecefAt(d)) };
  const r = findPasses({ track: dying, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  assert.equal(r.passes.length, 1);
  const q = r.passes[0];
  assert.equal(q.endMs, dieMs);
  assert.ok(Number.isFinite(q.endAzDeg) && Number.isFinite(q.endElevDeg));
  assert.ok(q.endElevDeg > 0);
});
test('pass edges do not move when the search starts a little later', () => {
  const a = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
  const b = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0 + 123_457, endMs: T0 + DAY });
  assert.deepEqual(b.passes.map((p) => [p.startMs, p.endMs, p.peakMs]), a.passes.map((p) => [p.startMs, p.endMs, p.peakMs]));
});
