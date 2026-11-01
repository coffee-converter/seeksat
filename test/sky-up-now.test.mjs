import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { upNow, compassName } from '../lib/sky/up-now.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;
const { passes } = findPasses({ track: ISS, observers: [EN52VE], mode: 'radio', startMs: T0, endMs: T0 + DAY });
const pass = passes[0];
const tracks = new Map([[ISS.noradId, ISS]]);
const at = (nowMs, extra = {}) => upNow({ tracks, observer: EN52VE, nowMs, ...extra });

test('inside a pass gives the ISS with plausible az/el', () => {
  const r = at(pass.peakMs);
  assert.equal(r.length, 1);
  assert.equal(r[0].noradId, ISS.noradId);
  assert.ok(r[0].elDeg >= pass.maxElevDeg - 3 && r[0].elDeg <= 90);
  assert.ok(r[0].azDeg >= 0 && r[0].azDeg < 360);
  assert.equal(r[0].elDeg, Math.round(r[0].elDeg * 10) / 10);
});
test('outside every pass gives []', () => {
  const t = pass.startMs - 30 * 60_000;
  assert.deepEqual(at(t), []);
});
test('rising flips across the peak', () => {
  assert.equal(at(pass.peakMs - 90_000)[0].rising, true);
  assert.equal(at(pass.peakMs + 90_000)[0].rising, false);
});
test('sorted by elevation, highest first', () => {
  const low = { ...ISS, noradId: 1, ecefAt: (d) => ISS.ecefAt(new Date(d.getTime() - 120_000)) };
  const two = new Map([[1, low], [ISS.noradId, ISS]]);
  const r = upNow({ tracks: two, observer: EN52VE, nowMs: pass.peakMs - 60_000 });
  assert.equal(r.length, 2);
  assert.ok(r[0].elDeg >= r[1].elDeg);
});
test('colors and names carry through; compassName', () => {
  const r = upNow({ tracks, observer: EN52VE, nowMs: pass.peakMs, colors: new Map([[ISS.noradId, '#abc']]) });
  assert.equal(r[0].color, '#abc');
  assert.equal(r[0].name, ISS.shortName);
  assert.equal(compassName(225), 'SW');
});
