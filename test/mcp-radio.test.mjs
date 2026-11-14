import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radioPassTool, searchSatellitesTool, findPassesTool } from '../lib/mcp/tools.mjs';
import { radioPass, MAX_TABLE_ROWS } from '../lib/mcp/radio.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const ISS = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'test', fetchedAtMs: 0 };
const NOW = Date.parse('2024-01-01T13:00:00Z');
const GOES = { ...recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'), epochMs: Date.parse('2026-10-31T14:00:00Z') };
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');

const SEARCH = [
  { noradId: 36395, name: 'SDO', radio: false, bands: [], tier: 1 },
  { noradId: 66688, name: 'WISDOM A', radio: false, bands: [], tier: 5 },
];
const deps = {
  getRecord: async (id) => (id === 25544 ? ISS : id === 36395 ? { ...ISS, noradId: 36395, name: 'SDO' } : null),
  geocode: async () => null,
  fetchWeather: async () => null,
  now: () => NOW,
  search: async (q, limit) => (q.toLowerCase().includes('sdo') ? SEARCH : q.toLowerCase().startsWith('wis') ? [{ ...SEARCH[1], tier: 2 }] : []).slice(0, limit),
};

test('get_radio_pass: the next ISS pass with frequencies, Doppler, tune times and a pointing table', async () => {
  const out = await radioPassTool({ satellite: 'iss', lat: EN52VE.latDeg, lon: EN52VE.lonDeg, frequencyMHz: 145.8 }, deps);
  assert.equal(out.noradId, 25544);
  assert.equal(out.url, 'https://seeksat.com/sat/25544');
  assert.equal(out.frequencyMHz, 145.8);
  assert.equal(out.window.kind, 'pass');
  assert.ok(out.summary.dopplerSwingHz > 3000 && out.summary.dopplerSwingHz < 8000, `${out.summary.dopplerSwingHz}`);
  assert.ok(out.tuneAt.some((t) => t.label === 'Closest approach'));
  for (const t of out.tuneAt) assert.ok(Math.abs(t.receiveMHz - 145.8) < 0.01, `${t.label} ${t.receiveMHz}`);
  assert.ok(out.table.length > 5 && out.table.length <= MAX_TABLE_ROWS);
  const row = out.table[0];
  assert.ok('azimuthDeg' in row && 'elevationDeg' in row && 'receiveMHz' in row);
  assert.ok(Math.abs(row.receiveMHz - 145.8) < 0.01);
  assert.match(out.note, /unknown/);
});

test('get_radio_pass: a satellite that never sets gets the next 24 hours', () => {
  const out = radioPass({ record: GOES, observer: EN52VE, startMs: GOES_T0, frequencyHz: 1_694_100_000 });
  assert.equal(out.window.kind, 'day');
  assert.equal(Date.parse(out.window.end) - Date.parse(out.window.start), 86_400_000);
  assert.deepEqual(out.tuneAt.map((t) => t.label).filter((l) => l !== 'Closest approach').sort(), ['Highest frequency', 'Lowest frequency']);
});

test('get_radio_pass without a frequency gives range rate only, and says so', () => {
  const out = radioPass({ record: GOES, observer: EN52VE, startMs: GOES_T0 });
  assert.equal(out.frequencyMHz, null);
  assert.equal(out.summary.dopplerSwingHz, null);
  assert.equal('receiveMHz' in out.table[0], false);
  assert.match(out.note, /No frequency/);
});

test('search_satellites returns the catalog search, and names resolve on whole-name matches only', async () => {
  const out = await searchSatellitesTool({ query: 'sdo' }, deps);
  assert.deepEqual(out.results[0], { noradId: 36395, name: 'SDO', url: 'https://seeksat.com/sat/36395', hasKnownDownlinks: false, bands: [] });
  // "sdo" is a whole-name match: other tools accept it.
  const fp = await findPassesTool({ satellite: 'sdo', lat: EN52VE.latDeg, lon: EN52VE.lonDeg }, deps);
  assert.match(fp.satellite, /SDO/);
  // "wis" only starts a name: not resolved, with a pointer to search.
  await assert.rejects(findPassesTool({ satellite: 'wis', lat: 0, lon: 0 }, deps), /search_satellites/);
  await assert.rejects(searchSatellitesTool({ query: ' ' }, deps), /query is required/);
});

test('search_satellites: a downlink kind passed as mode is refused with how to ask instead', async () => {
  const { z } = await import('zod');
  const { TOOL_SPECS } = await import('../lib/mcp/tool-specs.mjs');
  const spec = (TOOL_SPECS ?? []).find((t) => t.name === 'search_satellites');
  assert.ok(spec, 'spec exported');
  const schema = z.object(spec.inputSchema);
  const bad = schema.safeParse({ query: 'iss', mode: 'sstv' });
  assert.equal(bad.success, false);
  assert.match(bad.error.issues[0].message, /mode "radio" with the kind as the query, e\.g\. query "sstv"/);
  assert.equal(schema.safeParse({ query: 'sstv', mode: 'radio' }).success, true);
  assert.match(spec.inputSchema.query.description, /downlink kind as the whole query/);
});
