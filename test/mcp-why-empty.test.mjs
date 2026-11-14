// test/mcp-why-empty.test.mjs - an empty pass list says why, and every pass
// row links to that pass on seeksat.com.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxElevationDeg, noPassReason, latText } from '../lib/mcp/why-empty.mjs';
import { findPassesTool, nextVisiblePassTool, bestPassTool } from '../lib/mcp/tools.mjs';
import { makeTrack } from '../lib/sat/track.mjs';
import { decodeStateBlob } from '../lib/pass-finder/state-blob.js';
import { ISS_OMM } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

const EPOCH = Date.parse('2026-03-01T12:00:00Z');
const ISS = { noradId: 25544, name: 'ISS (ZARYA)', omm: ISS_OMM, epochMs: EPOCH, source: 'fixture' };
const deps = (nowMs, getRecord = async (id) => (id === 25544 ? ISS : null)) => ({
  now: () => nowMs, geocode: async () => null, fetchWeather: async () => null, getRecord,
});

test('maxElevationDeg: the highest a satellite can get from a latitude', () => {
  const track = makeTrack(ISS);
  assert.ok(maxElevationDeg(track, 0) > 89.9, 'overhead at the equator');
  assert.ok(maxElevationDeg(track, 51) > 89.9, 'overhead under its inclination');
  const at65 = maxElevationDeg(track, 65);
  assert.ok(at65 > 7 && at65 < 10, String(at65));
  assert.ok(maxElevationDeg(track, -80) < 0);
  assert.equal(latText(64.6), '65°N');
  assert.equal(latText(-33.9), '34°S');
});

test('an empty find_passes says it never rises high enough from that latitude', async () => {
  const out = await findPassesTool({ satellite: 'iss', lat: 65, lon: 25, mode: 'radio' }, deps(EPOCH));
  assert.deepEqual(out.passes, []);
  assert.match(out.note, /^It never rises above 10° from 65°N: with an orbit inclined 52°, it gets at most \d° up there\.$/);
  const next = await nextVisiblePassTool({ satellite: 25544, lat: -80, lon: 0 }, deps(EPOCH));
  assert.equal(next.pass, null);
  assert.match(next.note, /never comes above the horizon from there/);
  const best = await bestPassTool({ satellite: 'iss', lat: 65, lon: 25, mode: 'radio' }, deps(EPOCH));
  assert.equal(best.best, null);
  assert.match(best.note, /never rises above 10° from 65°N/);
});

test('a geostationary satellite below the horizon says so', async () => {
  const goes = { ...recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), epochMs: Date.parse('2026-10-31T14:00:00Z') };
  const out = await findPassesTool({ satellite: 41866, lat: -33.9, lon: 151.2 }, deps(Date.parse('2026-10-31T15:00:00Z'), async () => goes));
  assert.equal(out.stationary.visible, false);
  assert.equal(out.note, 'Geostationary: it stays below 10° here, so it is never in view from this place.');
});

test('visual mode: a sky that never gets dark, or passes that are never lit in the dark', () => {
  const track = makeTrack(ISS);
  const june = Date.parse('2026-06-21T00:00:00Z');
  const base = { track, mode: 'visual', minElevationDeg: 0, windowHours: 24, stationary: null };
  assert.match(noPassReason({ ...base, observer: { latDeg: 70, lonDeg: 20 }, startMs: june }), /^The sky never gets dark enough here in the next 24 hours/);
  assert.match(noPassReason({ ...base, observer: { latDeg: 40, lonDeg: 20 }, startMs: june, hasRadioPass: () => true }), /none of those passes above 0° is sunlit while the sky is dark/);
  assert.match(noPassReason({ ...base, observer: { latDeg: 40, lonDeg: 20 }, startMs: june, hasRadioPass: () => false }), /^No pass above 0° in the next 24 hours/);
});

test('pass rows link to that pass on seeksat.com from that place', async () => {
  const out = await findPassesTool({ satellite: 'iss', lat: -33.9, lon: 151.2, mode: 'radio', minElevation: 20 }, deps(EPOCH));
  assert.ok(out.passes.length > 0);
  for (const p of out.passes) {
    const m = p.passUrl.match(/^https:\/\/seeksat\.com\/sat\/25544\/share\/([\w-]+)$/);
    assert.ok(m, p.passUrl);
    const state = decodeStateBlob(m[1]);
    assert.equal(state.noradId, 25544);
    assert.equal(state.passTimeMs, Date.parse(p.peak));
    assert.equal(state.mode, 'radio');
    assert.equal(state.minElevDeg, 20);
    assert.deepEqual(state.observers, [{ name: '-33.90, 151.20', latDeg: -33.9, lonDeg: 151.2 }]);
  }
});
