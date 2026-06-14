// test/mcp-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSatellites, findPassesTool, getPositionTool, nextVisiblePassTool } from '../lib/mcp/tools.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'wheretheiss', fetchedAtMs: 0 };
const NOW = Date.parse('2024-01-01T13:00:00Z');

const deps = {
  readMap: async () => ({ 25544: REC }),
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
