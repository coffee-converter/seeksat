import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses, accuracyNote } from '../lib/passes/engine.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const ISS = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const T0 = Date.parse('2026-03-01T12:00:00Z');
const DAY = 86_400_000;

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
