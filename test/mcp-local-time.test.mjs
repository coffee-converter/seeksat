// test/mcp-local-time.test.mjs - local times in MCP results and how time
// inputs are read (lib/mcp/local-time.mjs), offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAt, localIso, withLocalTimes, parseTimeInput } from '../lib/mcp/local-time.mjs';
import { findPassesTool, getPositionTool, getPassWeatherTool, radioPassTool } from '../lib/mcp/tools.mjs';

test('zoneAt looks the zone up offline, UTC when it cannot', () => {
  assert.equal(zoneAt(41.9, -87.6), 'America/Chicago');
  assert.equal(zoneAt(-33.9, 151.2), 'Australia/Sydney');
  assert.equal(zoneAt(95, 0), 'UTC');
});

test('localIso gives the wall clock with its offset, across DST and odd offsets', () => {
  assert.equal(localIso(Date.parse('2026-11-14T23:41:00Z'), 'America/Chicago'), '2026-11-14T17:41:00-06:00');
  assert.equal(localIso(Date.parse('2026-07-01T23:41:00Z'), 'America/Chicago'), '2026-07-01T18:41:00-05:00');
  assert.equal(localIso(Date.parse('2026-11-14T00:00:30.900Z'), 'Asia/Kolkata'), '2026-11-14T05:30:30+05:30');
  assert.equal(localIso(Date.parse('2026-11-14T00:00:00Z'), 'Pacific/Chatham'), '2026-11-14T13:45:00+13:45');
  assert.equal(localIso(Date.parse('2026-11-14T00:00:00Z'), 'UTC'), '2026-11-14T00:00:00+00:00');
});

test('withLocalTimes adds <key>Local next to every UTC time, at any depth', () => {
  const out = withLocalTimes({
    tleEpoch: '2026-11-14T00:00:00.000Z',
    passes: [{ rise: '2026-11-14T23:41:00.000Z', azimuthDeg: { rise: 10 }, visibleFrom: null }],
    window: { start: '2026-11-15T00:00:00.000Z' },
    interpretedAs: { utc: '2026-11-14T23:41:00.000Z' },
    name: '2026-11-14',
  }, 'America/Chicago');
  assert.deepEqual(Object.keys(out.passes[0]), ['rise', 'riseLocal', 'azimuthDeg', 'visibleFrom']);
  assert.equal(out.passes[0].riseLocal, '2026-11-14T17:41:00-06:00');
  assert.equal(out.window.startLocal, '2026-11-14T18:00:00-06:00');
  assert.equal(out.tleEpochLocal, undefined);
  assert.deepEqual(out.interpretedAs, { utc: '2026-11-14T23:41:00.000Z' });
  assert.equal(out.nameLocal, undefined);
});

test('parseTimeInput: Z and offsets are exact; no offset reads on the given clock', () => {
  assert.equal(parseTimeInput('2026-11-15T03:00:00Z').ms, Date.parse('2026-11-15T03:00:00Z'));
  assert.equal(parseTimeInput('2026-11-14T21:00-06:00').ms, Date.parse('2026-11-15T03:00:00Z'));
  assert.equal(parseTimeInput('2026-11-14T21:00:00-0600').ms, Date.parse('2026-11-15T03:00:00Z'));
  assert.equal(parseTimeInput('2026-11-15 03:00z').ms, Date.parse('2026-11-15T03:00:00Z'));
  const chi = parseTimeInput('2026-11-14T21:00', { timeZone: 'America/Chicago' });
  assert.equal(chi.ms, Date.parse('2026-11-15T03:00:00Z'));
  assert.deepEqual(chi.interpretedAs, {
    input: '2026-11-14T21:00', utc: '2026-11-15T03:00:00.000Z', local: '2026-11-14T21:00:00-06:00',
    timeZone: 'America/Chicago', offsetGiven: false, note: 'No offset was given, so it was read as America/Chicago time.',
  });
  // Summer time, and a date alone (its midnight).
  assert.equal(parseTimeInput('2026-07-01T21:00', { timeZone: 'America/Chicago' }).ms, Date.parse('2026-07-02T02:00:00Z'));
  assert.equal(parseTimeInput('2026-11-14', { timeZone: 'Asia/Tokyo' }).ms, Date.parse('2026-11-13T15:00:00Z'));
  assert.equal(parseTimeInput('2026-11-14T21:00:00Z').interpretedAs.offsetGiven, true);
});

test('parseTimeInput refuses what it cannot read, with an example', () => {
  for (const bad of ['tomorrow 9pm', '2026-02-31T10:00', '2026-11-14T25:00', '', '1731542400']) {
    assert.throws(() => parseTimeInput(bad, { name: 'time' }), /is not a time I can read\. Use ISO 8601, e\.g\. "2026-11-14T21:00:00-06:00"/, bad);
  }
});

// Tool results: the ISS fixture from mcp-tools.test.mjs.
const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2, epochMs: Date.parse('2024-01-01T12:00:00Z'), source: 'fixture', fetchedAtMs: 0 };
const NOW = Date.parse('2024-01-01T13:00:00Z');
const deps = {
  getRecord: async (id) => (id === 25544 ? REC : null),
  geocode: async (q) => (q === 'Chicago' ? { latDeg: 41.88, lonDeg: -87.63, displayName: 'Chicago, Illinois, United States' } : null),
  fetchWeather: async () => null,
  now: () => NOW,
};

test('pass results carry the time zone and a local twin for every time', async () => {
  const out = await findPassesTool({ satellite: 'iss', location: 'Chicago', mode: 'radio' }, deps);
  assert.equal(out.resolvedLocation.timeZone, 'America/Chicago');
  assert.ok(out.passes.length > 0);
  for (const p of out.passes) {
    for (const k of ['rise', 'peak', 'set']) assert.equal(p[`${k}Local`], localIso(Date.parse(p[k]), 'America/Chicago'));
    assert.match(p.riseLocal, /-06:00$/);
  }
  const radio = await radioPassTool({ satellite: 'iss', lat: 41.88, lon: -87.63 }, deps);
  assert.match(radio.window.startLocal, /-06:00$/);
  assert.ok(radio.table.every((r) => r.timeLocal));
});

test('time inputs read in the observer zone and echo how they were read', async () => {
  const pos = await getPositionTool({ satellite: 'iss', time: '2024-01-01T08:00' }, deps);
  assert.equal(pos.time, '2024-01-01T08:00:00.000Z', 'no place: read as UTC');
  assert.match(pos.interpretedAs.note, /UTC/);
  const there = await getPositionTool({ satellite: 25544, time: '2024-01-01T08:00', location: 'Chicago' }, deps);
  assert.equal(there.time, '2024-01-01T14:00:00.000Z');
  assert.equal(there.timeLocal, '2024-01-01T08:00:00-06:00');
  const w = await getPassWeatherTool({ lat: 41.88, lon: -87.63, time: '2024-01-01T20:00' }, deps);
  assert.equal(w.time, '2024-01-02T02:00:00.000Z');
  await assert.rejects(() => getPositionTool({ satellite: 'iss', time: 'noon' }, deps), /time "noon" is not a time I can read/);
});
