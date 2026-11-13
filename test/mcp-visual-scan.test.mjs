// test/mcp-visual-scan.test.mjs - the visual best_pass scan (visual mode, no
// satellite named): the popular satellites plus CelesTrak's visual group,
// checked against a brute-force run of the full engine. Offline: synthetic
// satellites built from the ISS fixture, and a made-up cloud forecast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLru } from '../lib/mcp/radio-scan.mjs';
import { roughVisualScore, byRoughVisual } from '../lib/mcp/visual-scan.mjs';
import { bestPassTool, byQuality, VISUAL_SCAN_MAX_HOURS } from '../lib/mcp/tools.mjs';
import { findPasses } from '../lib/mcp/passes.mjs';
import { withLocalTimes } from '../lib/mcp/local-time.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

// Just after midnight in Sydney, a day after the fixture epoch.
const NOW = Date.parse('2026-03-01T13:17:00Z');
const EPOCH = Date.parse('2026-03-01T12:00:00Z');
const SYDNEY = { lat: -33.9, lon: 151.2 };

/** n low-orbit satellites spread over planes, phases and heights. */
function synthetic(n, firstId = 90000) {
  const recs = new Map();
  for (let i = 0; i < n; i++) {
    const id = firstId + i;
    const omm = {
      ...ISS_OMM, NORAD_CAT_ID: id, OBJECT_NAME: `SYN ${i}`,
      INCLINATION: 40 + ((i * 37) % 60), RA_OF_ASC_NODE: (i * 53) % 360, MEAN_ANOMALY: (i * 97) % 360,
      MEAN_MOTION: 14.2 + ((i * 13) % 20) / 10,
    };
    recs.set(id, { noradId: id, name: `SYN ${i}`, omm, epochMs: EPOCH, source: 'fixture', groups: ['visual'] });
  }
  return recs;
}

function depsFor(recs, extra = {}) {
  const calls = { visualIds: 0, weather: 0 };
  return {
    calls,
    deps: {
      now: () => NOW,
      geocode: async () => null,
      fetchWeather: async () => { calls.weather++; return null; },
      getRecord: async (id) => recs.get(id) ?? null,
      visualIds: async () => { calls.visualIds++; return [...recs.keys()]; },
      visualScanCache: createLru(8),
      ...extra,
    },
  };
}

/** The full engine over every satellite, ranked as the scan ranks. */
function bruteForce(recs, { lat, lon }, windowHours, cloud = null) {
  const all = [];
  for (const [id, record] of recs) {
    const { passes } = findPasses({ record, observer: { latDeg: lat, lonDeg: lon }, startMs: NOW, windowHours, minElevationDeg: 10, mode: 'visual', cloud });
    for (const p of passes) all.push({ noradId: id, ...p });
  }
  return all.sort((a, b) => byQuality(a, b) || (Date.parse(a.rise) - Date.parse(b.rise)));
}

const RECS = synthetic(30);

test('visual best_pass scan matches the full engine run over every satellite', async () => {
  const { deps } = depsFor(RECS);
  const out = await bestPassTool({ ...SYDNEY, windowHours: 24, limit: 5 }, deps);
  const brute = bruteForce(RECS, SYDNEY, 24).slice(0, 5);
  assert.ok(brute.length === 5, 'the fixture has enough visible passes');
  assert.equal(out.mode, 'visual');
  assert.equal(out.satellitesScanned, 30);
  // The popular satellites are candidates too; this fixture has no orbits for them.
  assert.ok(out.skippedCounts['no orbit data yet'] >= 1);
  assert.deepEqual(out.passes.map((p) => [p.noradId, p.rise, p.quality]), brute.map((p) => [p.noradId, p.rise, p.quality]));
  const { noradId, satellite, shortName, url, elementAge, ...row } = out.best;
  assert.equal(elementAge.level, 'fresh');
  assert.equal(out.skippedStaleElements, 0);
  const { noradId: _id, ...bruteRow } = brute[0];
  assert.deepEqual(row, withLocalTimes(bruteRow, 'Australia/Sydney'));
  assert.equal(satellite, RECS.get(noradId).name);
  assert.equal(url, `https://seeksat.com/sat/${noradId}`);
  assert.equal(out.weather.used, false);
  assert.match(out.weather.reason, /neutral 0\.5/);
});

test('visual scan folds one cloud forecast into the ranking', async () => {
  // Clear for the first 12 hours, then overcast: a pass under cloud ranks
  // below a clear one, and every row says how cloudy its peak is.
  const forecast = { startMs: NOW - 3_600_000, hours: Array.from({ length: 48 }, (_, i) => (i < 13 ? 0 : 100)) };
  const { deps, calls } = depsFor(RECS, { fetchWeather: async () => { calls.weather++; return forecast; } });
  const out = await bestPassTool({ ...SYDNEY, windowHours: 24, limit: 5 }, deps);
  assert.equal(calls.weather, 1, 'one forecast call covers every pass');
  assert.equal(out.weather.used, true);
  const brute = bruteForce(RECS, SYDNEY, 24, forecast).slice(0, 5);
  assert.deepEqual(out.passes.map((p) => [p.noradId, p.rise, p.quality]), brute.map((p) => [p.noradId, p.rise, p.quality]));
  for (const p of out.passes) assert.equal(typeof p.cloudCoverPct, 'number');
  assert.ok(out.best.cloudCoverPct === 0, 'the best pass is under the clear sky');
  // A failing forecast ranks without clouds, and says so.
  const { deps: down } = depsFor(RECS, { fetchWeather: async () => { throw new Error('offline'); } });
  const flat = await bestPassTool({ ...SYDNEY, windowHours: 24, limit: 5 }, down);
  assert.equal(flat.weather.used, false);
  assert.equal(flat.best.cloudCoverPct, undefined);
});

test('visual scan: a known bright satellite outranks its estimated twin', async () => {
  // The ISS (curated, standard magnitude -1.8) on the same orbit as SYN 0.
  const twin = new Map([[90000, RECS.get(90000)], [25544, { ...RECS.get(90000), noradId: 25544, name: 'ISS (ZARYA)' }]]);
  const { deps } = depsFor(twin);
  const out = await bestPassTool({ ...SYDNEY, windowHours: 24, limit: 10 }, deps);
  assert.equal(out.best.noradId, 25544);
  assert.equal(out.best.peakMagnitudeEstimated, false);
  for (const p of out.passes.filter((x) => x.peakMagnitudeEstimated)) assert.ok(p.quality <= 0.4);
});

test('visual scan: stage 1 is cached per cell and hour, the window is capped, geosynchronous is skipped', async () => {
  const goes = { ...recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), epochMs: EPOCH, groups: ['visual'] };
  const recs = new Map([...synthetic(5), [41866, goes]]);
  const { deps, calls } = depsFor(recs);
  const a = await bestPassTool({ ...SYDNEY, windowHours: 24 }, deps);
  await bestPassTool({ lat: -33.91, lon: 151.21, windowHours: 24 }, deps);
  assert.equal(calls.visualIds, 1, 'the second ask in the same cell and hour reuses the sweep');
  assert.equal(a.skippedCounts['geosynchronous: no passes'], 1);
  assert.equal(a.satellitesScanned, 5);
  const long = await bestPassTool({ ...SYDNEY, windowHours: 240, limit: 1 }, deps);
  assert.equal(long.windowHours, VISUAL_SCAN_MAX_HOURS);
  assert.match(long.windowNote, /168 hours/);
});

test('roughVisualScore: darker, higher and longer score more; a guess is capped at Fair', () => {
  const seen = (n, elDeg, sunAltDeg, mag = 2) => Array.from({ length: n }, (_, i) => ({ ms: i * 60_000, elDeg, sunAltDeg, mag }));
  const high = roughVisualScore({ estimated: false, seen: seen(4, 60, -15) });
  const low = roughVisualScore({ estimated: false, seen: seen(4, 15, -15) });
  const short = roughVisualScore({ estimated: false, seen: seen(1, 60, -15) });
  assert.ok(high.score > low.score && high.score > short.score);
  const guess = roughVisualScore({ estimated: true, seen: seen(4, 60, -15, -1) });
  assert.ok(guess.score <= 0.4);
  const rows = [
    { id: 'guess', score: 0.4, estimated: true, mag: -1, firstMs: 0 },
    { id: 'known', score: 0.4, estimated: false, mag: 3, firstMs: 1 },
    { id: 'top', score: 0.5, estimated: false, mag: 4, firstMs: 2 },
  ];
  assert.deepEqual(rows.sort(byRoughVisual).map((r) => r.id), ['top', 'known', 'guess']);
});
