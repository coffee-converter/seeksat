import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { passRows, compass } from '../lib/sat/pass-rows.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const ISS_T0 = Date.parse('2026-03-01T12:00:00Z');
const ISS_EPOCH = iss.epochMs;
const DAY = 86_400_000;
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');
const opts = { epochMs: ISS_EPOCH, nowMs: ISS_T0, minElevDeg: 10, mode: 'radio', timeZone: 'UTC', locale: 'en-GB' };

test('rows for ISS passes', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }), opts);
  assert.equal(v.kind, 'rows');
  assert.match(v.rows[0].startLabel, /^\d\d:\d\d$/);
  assert.match(v.rows[0].dayLabel, /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  assert.match(v.rows[0].maxElevLabel, /^\d+°$/);
  assert.match(v.rows[0].azLabel, /^(N|NE|E|SE|S|SW|W|NW) \d+° to (N|NE|E|SE|S|SW|W|NW) \d+°$/);
});
test('a pass far from the epoch carries the accuracy note', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_EPOCH + 5 * DAY }), { ...opts, nowMs: ISS_EPOCH + 5 * DAY });
  assert.match(v.rows[0].accuracy, /days old at this pass/);
});
test('GOES 16 stationary text is rounded', () => {
  const v = passRows(findPasses({ track: goes, observers: [EN52VE], startMs: GOES_T0 }), opts);
  assert.equal(v.kind, 'stationary');
  assert.match(v.text, /^Fixed in your sky at azimuth \d+\.\d°, elevation \d+\.\d°\./);
});
test('stationary that never rises', () => {
  const r = { kind: 'stationary', visible: false, pointing: [{ obsId: 'home', azDeg: 1, elDeg: -5, elMinDeg: -6, elMaxDeg: -4 }] };
  assert.equal(passRows(r, opts).text, 'It never rises here.');
  r.pointing[0].elMaxDeg = 4;
  assert.equal(passRows(r, opts).text, 'It never rises above 10° here.');
});
test('messages', () => {
  assert.equal(passRows({ kind: 'passes', passes: [] }, { ...opts, mode: 'visual' }).text, 'No visible passes in the next 10 days.');
  assert.equal(passRows({ kind: 'passes', passes: [] }, opts).text, 'No passes above 10° in the next 10 days.');
  assert.equal(passRows({ kind: 'unavailable' }, opts).text, "These elements can't be used to compute passes.");
});
test('compass', () => {
  assert.deepEqual([0, 22, 23, 180, 337, 338].map(compass), ['N', 'N', 'NE', 'S', 'NW', 'N']);
});
