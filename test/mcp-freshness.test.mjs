// test/mcp-freshness.test.mjs - element age in MCP results, stale objects
// left out of whole-sky answers, and times too far from the epoch refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementAgeAt, staleAt, assertNearEpoch, MAX_EPOCH_GAP_DAYS } from '../lib/mcp/freshness.mjs';
import { getPositionTool, findPassesTool, getPassChartTool, whatsUpNowTool, identifySatelliteTool, bestPassTool, listSatellites } from '../lib/mcp/tools.mjs';
import { createLru } from '../lib/mcp/radio-scan.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const DAY = 86_400_000;
const EPOCH = Date.parse('2026-03-01T12:00:00Z');

test('elementAgeAt grades the gap as the app does, with a short warning when not fresh', () => {
  assert.deepEqual(elementAgeAt(EPOCH, EPOCH + 2 * DAY), { level: 'fresh', ageDays: 2 });
  const old = elementAgeAt(EPOCH, EPOCH + 9 * DAY);
  assert.equal(old.level, 'old');
  assert.equal(old.warning, 'The elements are 9 days old, so times may be off by a minute or more.');
  const stale = elementAgeAt(EPOCH, EPOCH + 20 * DAY);
  assert.equal(stale.level, 'stale');
  assert.match(stale.warning, /20 days old, so positions and times may be well off \(stale\)/);
  // Either side of the epoch counts, and an asked-about time says so.
  const before = elementAgeAt(EPOCH, EPOCH - 10 * DAY, { asked: true });
  assert.equal(before.level, 'old');
  assert.match(before.warning, /^The time asked about is 10 days from the elements' epoch \(2026-03-01\)/);
  assert.equal(elementAgeAt(null, EPOCH).level, 'stale');
});

test('staleAt and assertNearEpoch', () => {
  assert.equal(staleAt(EPOCH, EPOCH + 13 * DAY), false);
  assert.equal(staleAt(EPOCH, EPOCH + 15 * DAY), true);
  assert.equal(staleAt(EPOCH, EPOCH - 15 * DAY), true);
  assert.equal(staleAt(null, EPOCH), true);
  assert.doesNotThrow(() => assertNearEpoch(EPOCH, EPOCH + MAX_EPOCH_GAP_DAYS * DAY));
  assert.throws(() => assertNearEpoch(EPOCH, Date.parse('1990-01-01T00:00:00Z')), /time 1990-01-01T00:00:00\.000Z is 13209 days from the orbital elements' epoch \(2026-03-01\)\. Predictions that far from the epoch are not meaningful; ask about a time within 30 days of it\./);
});

const ISS = { noradId: 25544, name: 'ISS (ZARYA)', omm: ISS_OMM, epochMs: EPOCH, source: 'fixture', fetchedAtMs: 0 };
const depsAt = (nowMs, extra = {}) => ({
  now: () => nowMs,
  geocode: async () => null,
  fetchWeather: async () => null,
  getRecord: async (id) => (id === 25544 ? ISS : null),
  ...extra,
});
const AT = { lat: -33.9, lon: 151.2 };

test('satellite results carry elementAge, and a far-off time is refused', async () => {
  const fresh = await getPositionTool({ satellite: 'iss' }, depsAt(EPOCH + DAY));
  assert.deepEqual(fresh.elementAge, { level: 'fresh', ageDays: 1 });
  const old = await findPassesTool({ satellite: 'iss', ...AT, mode: 'radio' }, depsAt(EPOCH + 9 * DAY));
  assert.equal(old.elementAge.level, 'old');
  assert.match(old.elementAge.warning, /9 days old/);
  // A time asked about: graded at that time.
  const later = await getPositionTool({ satellite: 'iss', time: '2026-03-12T12:00:00Z' }, depsAt(EPOCH + DAY));
  assert.equal(later.elementAge.level, 'old');
  assert.match(later.elementAge.warning, /time asked about is 11 days/);
  await assert.rejects(() => getPositionTool({ satellite: 'iss', time: '1990-01-01T00:00:00Z' }, depsAt(EPOCH)), /days from the orbital elements' epoch/);
  await assert.rejects(() => getPassChartTool({ satellite: 'iss', ...AT, time: '2027-01-01T00:00:00Z' }, depsAt(EPOCH)), /days from the orbital elements' epoch/);
  const list = await listSatellites(depsAt(EPOCH + 20 * DAY));
  assert.equal(list.satellites.find((s) => s.noradId === 25544).elementAge.level, 'stale');
});

/** n low-orbit satellites, the first `staleCount` with elements 30 days old. */
function catalog(n, nowMs, staleCount) {
  return Array.from({ length: n }, (_, i) => {
    const id = 90000 + i;
    const epochMs = i < staleCount ? nowMs - 30 * DAY : EPOCH;
    const omm = { ...ISS_OMM, NORAD_CAT_ID: id, OBJECT_NAME: `SYN ${i}`, RA_OF_ASC_NODE: (i * 53) % 360, MEAN_ANOMALY: (i * 97) % 360, INCLINATION: 40 + ((i * 37) % 60) };
    return { noradId: id, record: { noradId: id, name: `SYN ${i}`, omm, epochMs }, downlinks: [{ hz: 437e6, mode: 'fm', label: 'FM', default: true }] };
  });
}

test('whole-sky tools leave out stale elements and say how many', async () => {
  const now = EPOCH + 3_600_000;
  const list = catalog(40, now, 5);
  const d = depsAt(now, { skyCatalog: async () => list });
  const up = await whatsUpNowTool({ ...AT, mode: 'radio', minElevation: 0, limit: 50 }, d);
  assert.equal(up.skippedStaleElements, 5);
  assert.equal(up.satellitesScanned, 35);
  assert.match(up.staleNote, /^5 satellites were left out/);
  assert.ok(up.satellites.every((s) => s.noradId >= 90005 && s.elementAge.level === 'fresh'));
  // A sighting far from every epoch: nothing can be placed, and it says so.
  const far = await identifySatelliteTool({ ...AT, time: '2026-06-01T10:00:00Z', azimuth: 90, elevation: 40 }, d);
  assert.equal(far.satellitesScanned, 0);
  assert.equal(far.skippedStaleElements, 40);
  assert.match(far.staleNote, /^Every satellite was left out/);
});

test('scans leave out stale elements and count them', async () => {
  const now = EPOCH + 3_600_000;
  const recs = new Map(catalog(12, now, 4).map((x) => [x.noradId, { ...x.record, downlinks: x.downlinks, groups: ['visual'] }]));
  const d = depsAt(now, {
    getRecord: async (id) => recs.get(id) ?? null,
    radioIds: async () => [...recs.keys()],
    visualIds: async () => [...recs.keys()],
    radioScanCache: createLru(4),
    visualScanCache: createLru(4),
  });
  const radio = await bestPassTool({ ...AT, mode: 'radio' }, d);
  assert.equal(radio.skippedStaleElements, 4);
  assert.equal(radio.satellitesScanned, 8);
  const visual = await bestPassTool({ ...AT, windowHours: 24 }, d);
  assert.equal(visual.skippedStaleElements, 4);
  assert.equal(visual.satellitesScanned, 8);
  for (const p of [...radio.passes, ...visual.passes]) assert.equal(p.elementAge.level, 'fresh');
});
