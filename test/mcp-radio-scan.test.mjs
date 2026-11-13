// test/mcp-radio-scan.test.mjs - the all-satellite radio scan behind
// best_pass (radio mode, no satellite): the coarse sweep, the cache, and the
// tool, checked against a brute-force run of the full engine. Offline:
// synthetic satellites built from the ISS fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sat from 'satellite.js';
import {
  coarsePasses, coarseScan, createLru, scanKey, cellOf, refineWindows, hourOf, REFINE_MIN,
} from '../lib/mcp/radio-scan.mjs';
import { bestPassTool, byRadioQuality, RADIO_SCAN_MAX_HOURS } from '../lib/mcp/tools.mjs';
import { findPasses } from '../lib/mcp/passes.mjs';
import { withLocalTimes } from '../lib/mcp/local-time.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

const NOW = Date.parse('2026-03-01T13:17:00Z');
const EPOCH = Date.parse('2026-03-01T12:00:00Z');

/** n low-orbit satellites spread over planes, phases, heights and
 *  inclinations, each with one downlink: odd ones on 70 cm, even on 2 m;
 *  every third a BPSK telemetry beacon, the rest FM repeaters. */
function synthetic(n, firstId = 90000) {
  const recs = new Map();
  for (let i = 0; i < n; i++) {
    const id = firstId + i;
    const omm = {
      ...ISS_OMM, NORAD_CAT_ID: id, OBJECT_NAME: `SYN ${i}`,
      INCLINATION: 40 + ((i * 37) % 60), RA_OF_ASC_NODE: (i * 53) % 360, MEAN_ANOMALY: (i * 97) % 360,
      MEAN_MOTION: 14.2 + ((i * 13) % 20) / 10,
    };
    const fm = i % 3 !== 0;
    recs.set(id, {
      noradId: id, name: `SYN ${i}`, omm, epochMs: EPOCH, source: 'fixture',
      downlinks: [{ hz: i % 2 ? 437_100_000 : 145_900_000, mode: fm ? 'fm' : 'bpsk', label: fm ? 'FM repeater' : 'Telemetry', default: true }],
    });
  }
  return recs;
}

function depsFor(recs, extra = {}) {
  const calls = { radioIds: 0 };
  return {
    calls,
    deps: {
      now: () => NOW,
      geocode: async () => null,
      fetchWeather: async () => null,
      getRecord: async (id) => recs.get(id) ?? null,
      radioIds: async () => { calls.radioIds++; return [...recs.keys()]; },
      radioScanCache: createLru(8),
      ...extra,
    },
  };
}

/** The full engine over every satellite, ranked as the scan ranks. */
function bruteForce(recs, { latDeg, lonDeg }, windowHours = 24) {
  const all = [];
  for (const [id, record] of recs) {
    const { passes } = findPasses({ record, observer: { latDeg, lonDeg }, startMs: NOW, windowHours, minElevationDeg: 10, mode: 'radio' });
    for (const p of passes) all.push({ noradId: id, ...p });
  }
  return all.sort(byRadioQuality);
}

test('the coarse sweep with jumps finds exactly what a plain 60 s sweep finds', () => {
  const orbits = [...synthetic(12).values()].map((r) => sat.json2satrec(r.omm));
  orbits.push(sat.twoline2satrec(MOLNIYA_LINE1, MOLNIYA_LINE2));
  const obs = { latDeg: 42.19, lonDeg: -88.21 };
  const start = Date.parse('2026-03-01T13:00:00Z');
  for (const satrec of orbits) {
    const t0 = satrec.satnum === '25485' ? Date.parse('2023-06-28T03:00:00Z') : start;
    const fast = coarsePasses(satrec, obs, t0, t0 + 48 * 3_600_000, 8);
    const slow = coarsePasses(satrec, obs, t0, t0 + 48 * 3_600_000, 8, { jump: false });
    assert.deepEqual(fast.runs, slow.runs, `satellite ${satrec.satnum}`);
    assert.ok(fast.samples < slow.samples, 'the jumps save samples');
  }
});

test('the coarse sweep sees every engine pass, with its peak to a fraction of a degree', () => {
  const rec = synthetic(1).values().next().value;
  const obs = { latDeg: 42.19, lonDeg: -88.21 };
  const { runs } = coarsePasses(sat.json2satrec(rec.omm), obs, NOW, NOW + 48 * 3_600_000, 10);
  const { passes } = findPasses({ record: rec, observer: obs, startMs: NOW, windowHours: 48, minElevationDeg: 10, mode: 'radio' });
  assert.ok(passes.length > 3);
  for (const p of passes) {
    const run = runs.find((r) => r.firstMs <= Date.parse(p.set) && r.lastMs >= Date.parse(p.rise));
    assert.ok(run, `rough pass for ${p.rise}`);
    assert.ok(Math.abs(run.peakElevDeg - p.peakElevationDeg) < 0.3, `${run.peakElevDeg} vs ${p.peakElevationDeg}`);
  }
});

test('coarse sweep: elements that do not propagate are unavailable', () => {
  const dead = sat.json2satrec({ ...ISS_OMM, MEAN_MOTION: 17.5, EPOCH: '2018-01-01T00:00:00.000000', BSTAR: 0.01 });
  const r = coarseScan([{ noradId: 1, satrec: dead }], { latDeg: 0, lonDeg: 0 }, NOW, NOW + 3_600_000, 8);
  assert.deepEqual(r.unavailable, [1]);
  assert.deepEqual(r.passes, []);
});

test('createLru keeps the most recently used entries', () => {
  const lru = createLru(2);
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1); // a is now the newest
  lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.get('c'), 3);
  assert.equal(lru.size, 2);
});

test('scanKey shares a cell and hour, and ignores the order of bands and modes', () => {
  const base = { hourMs: hourOf(NOW), windowHours: 24, minElevationDeg: 10, bands: ['70cm', '2m'], modes: null };
  assert.equal(scanKey({ ...base, latDeg: 42.19, lonDeg: -88.21 }), scanKey({ ...base, latDeg: 42.21, lonDeg: -88.29, bands: ['2m', '70cm'] }));
  assert.notEqual(scanKey({ ...base, latDeg: 42.19, lonDeg: -88.21 }), scanKey({ ...base, latDeg: 42.4, lonDeg: -88.21 }));
  assert.notEqual(scanKey({ ...base, latDeg: 42.19, lonDeg: -88.21 }), scanKey({ ...base, latDeg: 42.19, lonDeg: -88.21, modes: ['fm'] }));
  assert.deepEqual(cellOf(42.19, -88.21), { latDeg: 42.25, lonDeg: -88.25 });
  assert.equal(hourOf(NOW), Date.parse('2026-03-01T13:00:00Z'));
});

test('refineWindows pads, clamps to the window, and merges per satellite', () => {
  const m = 60_000;
  const passes = [
    { noradId: 1, firstMs: 10 * m, lastMs: 15 * m, peakElevDeg: 80, score: 1 },
    { noradId: 1, firstMs: 17 * m, lastMs: 18 * m, peakElevDeg: 20, score: 0.5 },
    { noradId: 2, firstMs: 0, lastMs: 4 * m, peakElevDeg: 40, score: 0.9 },
    { noradId: 3, firstMs: 500 * m, lastMs: 505 * m, peakElevDeg: 70, score: 1 }, // outside
  ];
  const w = refineWindows(passes, 2 * m, 100 * m, 3);
  assert.deepEqual([...w.keys()].sort(), [1, 2]);
  assert.deepEqual(w.get(1), [{ startMs: 7 * m, endMs: 21 * m }]);
  assert.deepEqual(w.get(2), [{ startMs: 2 * m, endMs: 7 * m }]);
  assert.ok(REFINE_MIN >= 3);
});

for (const where of [{ latDeg: 42.19, lonDeg: -88.21 }, { latDeg: -33.9, lonDeg: 151.2 }]) {
  test(`radio best_pass scan matches the full engine run over every satellite (${where.latDeg}, ${where.lonDeg})`, async () => {
    const recs = synthetic(80);
    const { deps } = depsFor(recs);
    const out = await bestPassTool({ lat: where.latDeg, lon: where.lonDeg, mode: 'radio', limit: 5 }, deps);
    const brute = bruteForce(recs, where).slice(0, 5);
    assert.equal(out.satellitesScanned, 80);
    assert.equal(out.matchedSatellites, 80);
    assert.equal(out.windowHours, 24);
    assert.deepEqual(out.passes.map((p) => [p.noradId, p.rise, p.quality]), brute.map((p) => [p.noradId, p.rise, p.quality]));
    // The rows are the same rows find_passes gives, plus who and what to tune.
    const { noradId, satellite, shortName, downlinks, url, elementAge, ...row } = out.best;
    assert.deepEqual(elementAge, { level: 'fresh', ageDays: 0.1 });
    const { noradId: _id, ...bruteRow } = brute[0];
    assert.deepEqual(row, withLocalTimes(bruteRow, out.resolvedLocation.timeZone));
    assert.equal(satellite, recs.get(noradId).name);
    assert.equal(url, `https://seeksat.com/sat/${noradId}`);
    assert.ok(downlinks.length === 1 && downlinks[0].frequencyMHz > 100 && downlinks[0].mode);
  });
}

test('radio scan filters by band and by mode', async () => {
  const recs = synthetic(30);
  const { deps } = depsFor(recs);
  const loc = { lat: 42.19, lon: -88.21, mode: 'radio', limit: 10 };
  const uhf = await bestPassTool({ ...loc, bands: ['70cm'] }, deps);
  assert.equal(uhf.matchedSatellites, 15);
  assert.deepEqual(uhf.filters, { bands: ['70cm'], modes: null });
  assert.ok(uhf.passes.length > 0);
  for (const p of uhf.passes) assert.ok(p.downlinks.every((d) => d.frequencyMHz > 400 && d.frequencyMHz < 450));
  const bpsk = await bestPassTool({ ...loc, modes: ['bpsk'] }, deps);
  assert.equal(bpsk.matchedSatellites, 10);
  for (const p of bpsk.passes) assert.equal(p.downlinks[0].mode, 'bpsk');
  // "telemetry" is matched in the label.
  const tlm = await bestPassTool({ ...loc, modes: ['telemetry'] }, deps);
  assert.equal(tlm.matchedSatellites, 10);
  const none = await bestPassTool({ ...loc, bands: ['s'] }, deps);
  assert.equal(none.matchedSatellites, 0);
  assert.equal(none.best, null);
  await assert.rejects(() => bestPassTool({ ...loc, bands: ['23cm'] }, deps), /unknown band: 23cm/);
  await assert.rejects(() => bestPassTool({ ...loc, modes: ['dstar'] }, deps), /unknown mode: dstar/);
});

test('radio scan: the coarse sweep is cached per cell and hour, and the window is capped', async () => {
  const recs = synthetic(20);
  const { deps, calls } = depsFor(recs);
  const a = await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio' }, deps);
  const b = await bestPassTool({ lat: 42.2, lon: -88.2, mode: 'radio' }, deps);
  assert.equal(calls.radioIds, 1, 'the second ask in the same cell and hour reuses the sweep');
  assert.ok(a.best && b.best);
  assert.deepEqual(b.resolvedLocation, { latDeg: 42.2, lonDeg: -88.2, displayName: null, timeZone: 'America/Chicago' });
  await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio', minElevation: 30 }, deps);
  assert.equal(calls.radioIds, 2, 'another minimum elevation is another sweep');
  const long = await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio', windowHours: 200 }, deps);
  assert.equal(long.windowHours, RADIO_SCAN_MAX_HOURS);
  assert.match(long.windowNote, /72 hours/);
  // Without a cache it still works, sweeping every time.
  const { deps: bare, calls: bareCalls } = depsFor(recs, { radioScanCache: undefined });
  await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio' }, bare);
  await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio' }, bare);
  assert.equal(bareCalls.radioIds, 2);
});

test('radio scan counts what it cannot rank: geosynchronous, no orbit, dead elements', async () => {
  const recs = synthetic(5);
  const goes = { ...recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), epochMs: EPOCH, downlinks: [{ hz: 1_694_100_000, mode: 'bpsk', label: 'HRIT' }] };
  const dead = { ...recs.get(90000), noradId: 90099, omm: { ...ISS_OMM, NORAD_CAT_ID: 90099, MEAN_MOTION: 17.5, EPOCH: '2018-01-01T00:00:00.000000', BSTAR: 0.01 } };
  const all = new Map([...recs, [41866, goes], [90099, dead]]);
  const { deps } = depsFor(all, { radioIds: async () => [...all.keys(), 90100] });
  const out = await bestPassTool({ lat: 42.19, lon: -88.21, mode: 'radio' }, deps);
  assert.deepEqual(out.skippedCounts, { 'geosynchronous: no passes': 1, "elements can't be propagated": 1, 'no orbit data yet': 1 });
  assert.equal(out.satellitesScanned, 5);
});

test('a named satellite or visual mode keeps the old best_pass path; radio rows list downlinks', async () => {
  const recs = synthetic(3);
  const { deps, calls } = depsFor(recs);
  const named = await bestPassTool({ satellite: '90001', lat: 42.19, lon: -88.21, mode: 'radio' }, deps);
  assert.equal(calls.radioIds, 0);
  assert.equal(named.satellitesScanned, 1);
  assert.equal(named.best.downlinks[0].frequencyMHz, 437.1);
  const visual = await bestPassTool({ lat: 42.19, lon: -88.21 }, deps);
  assert.equal(calls.radioIds, 0);
  assert.equal(visual.mode, 'visual');
});

test('benchmark: a 400-satellite radio scan over 24 hours takes well under a few seconds', async () => {
  const recs = synthetic(400);
  const { deps } = depsFor(recs);
  const loc = { lat: 42.19, lon: -88.21, mode: 'radio', limit: 5 };
  let t0 = performance.now();
  const cold = await bestPassTool(loc, deps);
  const coldMs = performance.now() - t0;
  t0 = performance.now();
  await bestPassTool({ ...loc, lat: 42.2 }, deps);
  const warmMs = performance.now() - t0;
  console.log(`radio scan, 400 satellites, 24 h: ${coldMs.toFixed(0)} ms cold, ${warmMs.toFixed(0)} ms from the cache (${cold.checkedInDetail} checked in detail)`);
  assert.equal(cold.satellitesScanned, 400);
  // About 0.3 s on a quiet laptop; the limit leaves room for a busy machine.
  assert.ok(coldMs < 5000, `took ${coldMs} ms`);
  assert.ok(warmMs < coldMs);
});
