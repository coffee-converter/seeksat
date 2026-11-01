// test/mcp-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool } from '../lib/mcp/tools.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'wheretheiss', fetchedAtMs: 0 };
const NOW = Date.parse('2024-01-01T13:00:00Z');

const deps = {
  getRecord: async (id) => (id === 25544 ? REC : null),
  geocode: async (q) => (q.toLowerCase() === 'tokyo' ? { latDeg: 35.68, lonDeg: 139.69, displayName: 'Tokyo, Japan' } : null),
  fetchWeather: async () => null,
  now: () => NOW,
};

test('listSatellites returns catalog entries with freshness', async () => {
  const out = await listSatellites(deps);
  const iss = out.satellites.find(s => s.noradId === 25544);
  assert.equal(iss.name, 'ISS (ZARYA)');
  assert.equal(iss.tleAgeHours, 1);
  assert.equal(iss.source, 'wheretheiss');
});

test('getPositionTool resolves a satellite and returns a sub-point', async () => {
  const out = await getPositionTool({ satellite: 'iss' }, deps);
  assert.ok(out.altitudeKm > 300 && out.altitudeKm < 500);
  assert.equal(out.tleAgeHours, 1);
});

test('findPassesTool geocodes a location string', async () => {
  const out = await findPassesTool({ satellite: 'iss', location: 'Tokyo', mode: 'radio' }, deps);
  assert.equal(out.resolvedLocation.displayName, 'Tokyo, Japan');
  assert.ok(Array.isArray(out.passes));
});

test('findPassesTool errors clearly on unknown satellite', async () => {
  await assert.rejects(() => findPassesTool({ satellite: 'narnia', lat: 0, lon: 0 }, deps), /unknown satellite/i);
});

test('findPassesTool errors when neither coords nor location given', async () => {
  await assert.rejects(() => findPassesTool({ satellite: 'iss' }, deps), /location/i);
});

test('nextVisiblePassTool returns a single pass or null', async () => {
  const out = await nextVisiblePassTool({ satellite: 'iss', lat: 0, lon: 100, mode: 'radio' }, deps);
  assert.ok(out.pass === null || typeof out.pass.rise === 'string');
});

import { assertTierAllows } from '../lib/mcp/tools.mjs';

test('assertTierAllows gates premium satellites for the free tier', () => {
  const premium = { name: 'Spy Sat', tier: 'premium' };
  assert.throws(() => assertTierAllows(premium, 'free'), /premium satellite/i);
  assert.doesNotThrow(() => assertTierAllows(premium, 'pro'));
});

test('assertTierAllows always allows free satellites', () => {
  const free = { name: 'ISS (ZARYA)', tier: 'free' };
  assert.doesNotThrow(() => assertTierAllows(free, 'free'));
  assert.doesNotThrow(() => assertTierAllows(free, 'pro'));
});

test('listSatellites includes each satellite tier', async () => {
  const out = await listSatellites(deps);
  const iss = out.satellites.find((s) => s.noradId === 25544);
  assert.equal(iss.tier, 'free');
});

test('getPositionTool still works at the default free tier for a free satellite', async () => {
  const out = await getPositionTool({ satellite: 'iss' }, deps);
  assert.ok(out.altitudeKm > 300);
});

test('getPositionTool serves an OMM-only synthesized satellite with the record name', async () => {
  const omm = {
    OBJECT_NAME: 'BIG ONE', OBJECT_ID: '2024-001A', EPOCH: '2024-01-01T12:00:00.000000',
    MEAN_MOTION: 15.5, ECCENTRICITY: 0.00035, INCLINATION: 51.64, RA_OF_ASC_NODE: 100,
    ARG_OF_PERICENTER: 100, MEAN_ANOMALY: 260, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: 100001, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 1, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  };
  const rec = { noradId: 100001, name: 'BIG ONE', omm, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'snapshot', fetchedAtMs: 0, groups: [] };
  const d = { ...deps, getRecord: async (id) => (id === 100001 ? rec : null) };
  const out = await getPositionTool({ satellite: '100001' }, d);
  assert.equal(out.name, 'BIG ONE');
  assert.ok(out.altitudeKm > 300 && out.altitudeKm < 500);
});

test('tools throw "no orbit data" when getRecord resolves null', async () => {
  const d = { ...deps, getRecord: async () => null };
  await assert.rejects(() => getPositionTool({ satellite: 'iss' }, d), /no orbit data for ISS \(ZARYA\) \(25544\) yet/);
  await assert.rejects(() => getPositionTool({ satellite: '25485' }, d), /no orbit data for NORAD 25485 yet/);
});

import { bestPassTool } from '../lib/mcp/tools.mjs';

// A synthesized (non-curated) satellite has no standardMag: visual passes
// must report peakMagnitude null rather than a made-up number.
const SYN = { ...REC, noradId: 25485, name: 'SYNTH SAT' };
const synDeps = { ...deps, getRecord: async (id) => (id === 25485 ? SYN : null) };
const VIS = { lat: -30, lon: 150, mode: 'visual' };

test('find_passes / next_visible_pass / best_pass leave magnitude null for a synthesized satellite', async () => {
  const fp = await findPassesTool({ satellite: '25485', ...VIS }, synDeps);
  assert.ok(fp.passes.length > 0, 'fixture yields visual passes');
  for (const p of fp.passes) assert.equal(p.peakMagnitude, null);
  const nv = await nextVisiblePassTool({ satellite: 25485, ...VIS }, synDeps);
  assert.equal(nv.pass.peakMagnitude, null);
  const bp = await bestPassTool({ satellite: '25485', ...VIS }, synDeps);
  assert.ok(bp.best);
  assert.equal(bp.best.peakMagnitude, null);
});

test('synthesized satellites are named from the record; curated ones keep the curated name', async () => {
  const pos = await getPositionTool({ satellite: '25485' }, synDeps);
  assert.equal(pos.name, 'SYNTH SAT');
  const bp = await bestPassTool({ satellite: '25485', ...VIS }, synDeps);
  assert.equal(bp.best.satellite, 'SYNTH SAT');
  const fp = await findPassesTool({ satellite: '25485', ...VIS }, synDeps);
  assert.equal(fp.satellite, 'SYNTH SAT');
  // Curated: the catalog name wins over whatever CelesTrak calls it.
  const renamed = { ...deps, getRecord: async (id) => (id === 25544 ? { ...REC, name: 'ISS (ZARYA) NEW' } : null) };
  assert.equal((await getPositionTool({ satellite: 'iss' }, renamed)).name, 'ISS (ZARYA)');
  const bpIss = await bestPassTool({ satellite: 'iss', lat: 0, lon: 100, mode: 'radio' }, renamed);
  assert.equal(bpIss.best.satellite, 'ISS (ZARYA)');
});

test('best_pass skips a synthesized satellite with no record under its NORAD name', async () => {
  const d = { ...deps, getRecord: async () => null };
  const out = await bestPassTool({ satellite: '25485', lat: 0, lon: 0 }, d);
  assert.deepEqual(out.skipped, [{ satellite: 'NORAD 25485', reason: 'no orbit data yet' }]);
});

import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

test('best_pass skips a geostationary satellite with a reason', async () => {
  const goes = { ...recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), epochMs: Date.parse('2026-10-31T14:00:00Z') };
  const d = { ...deps, now: () => Date.parse('2026-10-31T15:00:00Z'), getRecord: async (id) => (id === 41866 ? goes : null) };
  const out = await bestPassTool({ satellite: 41866, lat: EN52VE.latDeg, lon: EN52VE.lonDeg }, d);
  assert.deepEqual(out.skipped, [{ satellite: 'GOES 16', reason: 'geostationary: fixed in the sky, no passes' }]);
  const fp = await findPassesTool({ satellite: 41866, lat: EN52VE.latDeg, lon: EN52VE.lonDeg }, d);
  assert.equal(fp.passes.length, 0);
  assert.equal(fp.stationary.visible, true);
  const nv = await nextVisiblePassTool({ satellite: 41866, lat: EN52VE.latDeg, lon: EN52VE.lonDeg }, d);
  assert.equal(nv.pass, null);
  assert.ok(nv.stationary);
});
