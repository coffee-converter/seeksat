import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';
import { passWindowAtMsForObserver, walkOptsForOrbit } from '../lib/pass-finder/observer-pass.js';
import { radioChartWindows } from '../lib/pass-finder/radio-window.js';
import { peakStepMsFor } from '../lib/pass-finder/window-scoring.js';

const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
const anchor = Date.parse('2023-06-27T07:00:00Z'); // inside a ~365 min radio pass from EN52ve
test('a Molniya pass is walked to its real edges, not clamped', () => {
  const w = passWindowAtMsForObserver(EN52VE, anchor, 'radio', 10, m.ecefAt, walkOptsForOrbit('heo', m.periodMs));
  assert.equal(w.clamped, false);
  assert.ok(Math.abs((w.endMs - w.startMs) / 60_000 - 365.5) < 2, `${(w.endMs - w.startMs) / 60_000} min`);
});
test('the old LEO budget clamps the same pass', () => {
  const w = passWindowAtMsForObserver(EN52VE, anchor, 'radio', 10, m.ecefAt);
  assert.equal(w.clamped, true);
});
test('walkOptsForOrbit', () => {
  assert.deepEqual(walkOptsForOrbit('leo', 5_550_000), { maxEdgeMs: 900_000, coarseStepMs: 1000 });
  assert.deepEqual(walkOptsForOrbit('geo', 86_164_000), { maxEdgeMs: 86_164_000, coarseStepMs: 30_000 });
});
test('radioChartWindows carries opts to both walks', () => {
  const r = radioChartWindows(EN52VE, anchor, 10, m.ecefAt, walkOptsForOrbit('heo', m.periodMs));
  assert.equal(r.clamped, false);
  assert.ok(r.full.endMs - r.full.startMs >= r.workable.endMs - r.workable.startMs);
});
test('peakStepMsFor', () => {
  assert.equal(peakStepMsFor(5 * 60_000), 5000);
  assert.equal(peakStepMsFor(9 * 3_600_000), 16_200);
});
