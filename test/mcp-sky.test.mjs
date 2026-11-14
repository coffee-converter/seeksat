// test/mcp-sky.test.mjs - whole-sky MCP tools (whats_up_now and
// identify_satellite) over a synthetic catalog built from the ISS fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsUpNowTool, identifySatelliteTool } from '../lib/mcp/tools.mjs';
import { prepareSky, parseCompass, angularSeparationDeg, bearingDiffDeg, travelBearingDeg } from '../lib/mcp/sky.mjs';
import { compass } from '../lib/sat/pass-rows.mjs';
import { makeTrack } from '../lib/sat/track.mjs';
import { satAltAzDeg } from '../lib/pass-finder/visibility.js';
import { apparentAltDeg } from '../lib/refraction.js';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const SYDNEY = { lat: -33.9, lon: 151.2 };
// 20:30 local: the Sun is 12 degrees down, low orbits still catch sunlight.
const DUSK = Date.parse('2026-03-01T09:30:00Z');
const NOON = Date.parse('2026-03-01T03:00:00Z');

/** n low-orbit satellites spread over planes and phases; every fourth has an
 *  FM downlink. */
function catalog(n = 300) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const id = 90000 + i;
    const omm = {
      ...ISS_OMM, NORAD_CAT_ID: id, OBJECT_NAME: `SYN ${i}`,
      INCLINATION: 40 + ((i * 37) % 60), RA_OF_ASC_NODE: (i * 53) % 360, MEAN_ANOMALY: (i * 97) % 360,
      MEAN_MOTION: 14.2 + ((i * 13) % 20) / 10,
    };
    list.push({
      noradId: id, record: { noradId: id, name: `SYN ${i}`, omm },
      downlinks: i % 4 ? [] : [{ hz: 437_000_000 + i * 1000, mode: 'fm', label: 'FM repeater', default: true }],
    });
  }
  return list;
}
const LIST = catalog();
const depsAt = (ms, list = LIST) => ({ now: () => ms, geocode: async () => null, skyCatalog: async () => list });

/** Azimuth and apparent elevation the app's own track and helpers give. */
function engineLook(record, observer, ms) {
  const { az, alt } = satAltAzDeg(observer, makeTrack(record).ecefAt(new Date(ms)));
  return { az, el: apparentAltDeg(alt) };
}

test('whats_up_now (visual): sunlit satellites in a dark sky, brightest first', async () => {
  const out = await whatsUpNowTool({ ...SYDNEY }, depsAt(DUSK));
  assert.equal(out.skyDark, true);
  assert.ok(out.sunAltitudeDeg < -6);
  assert.equal(out.satellitesScanned, 300);
  assert.ok(out.satellites.length >= 3, `${out.satellites.length} up`);
  assert.equal(out.aboveCount, out.satellites.length);
  const mags = out.satellites.map((s) => s.magnitude);
  assert.deepEqual(mags, [...mags].sort((a, b) => a - b));
  for (const s of out.satellites) {
    assert.equal(s.sunlit, true);
    assert.equal(s.magnitudeEstimated, true);
    assert.ok(s.elevationDeg >= 10);
    assert.equal(s.url, `https://seeksat.com/sat/${s.noradId}`);
    assert.equal('downlinks' in s, false);
    // Same pointing as the app's track and helpers.
    const look = engineLook(LIST.find((x) => x.noradId === s.noradId).record, { latDeg: SYDNEY.lat, lonDeg: SYDNEY.lon }, DUSK);
    assert.ok(Math.abs(look.el - s.elevationDeg) < 0.06 && Math.abs(look.az - s.azimuthDeg) < 0.06, `${s.noradId}`);
  }
  assert.match(out.note, /estimated/);
});

test('whats_up_now (visual): a known bright satellite outranks its estimated twin', async () => {
  const first = (await whatsUpNowTool({ ...SYDNEY }, depsAt(DUSK))).satellites[0];
  const twin = LIST.find((x) => x.noradId === first.noradId);
  // The ISS (standard magnitude -1.8) on exactly that orbit.
  const iss = { noradId: 25544, record: { noradId: 25544, name: 'ISS (ZARYA)', omm: { ...twin.record.omm, NORAD_CAT_ID: 25544 } }, downlinks: [] };
  const out = await whatsUpNowTool({ ...SYDNEY }, depsAt(DUSK, [...LIST, iss]));
  const [top, next] = out.satellites;
  assert.equal(top.noradId, 25544);
  assert.equal(top.name, 'ISS (ZARYA)');
  assert.equal(top.magnitudeEstimated, false);
  assert.equal(next.noradId, first.noradId);
  assert.ok(Math.abs(next.magnitude - top.magnitude - 7.8) < 0.15, `${top.magnitude} vs ${next.magnitude}`);
});

test('whats_up_now (visual) in daylight lists nothing and says why', async () => {
  const out = await whatsUpNowTool({ ...SYDNEY }, depsAt(NOON));
  assert.equal(out.skyDark, false);
  assert.deepEqual(out.satellites, []);
  assert.match(out.note, /the Sun is \d+° up/);
  assert.match(out.note, /radio/);
});

test('whats_up_now (radio): satellites with downlinks, highest first, day or night', async () => {
  for (const ms of [DUSK, NOON]) {
    const out = await whatsUpNowTool({ ...SYDNEY, mode: 'radio', minElevation: 0 }, depsAt(ms));
    assert.ok(out.satellites.length > 0, `some up at ${new Date(ms).toISOString()}`);
    const els = out.satellites.map((s) => s.elevationDeg);
    assert.deepEqual(els, [...els].sort((a, b) => b - a));
    for (const s of out.satellites) {
      assert.equal((s.noradId - 90000) % 4, 0, 'only satellites with downlinks');
      assert.equal(s.downlinks[0].mode, 'fm');
      assert.ok(s.downlinks[0].frequencyMHz > 437);
      assert.equal(typeof s.sunlit, 'boolean');
    }
  }
});

test('whats_up_now respects minElevation and limit', async () => {
  const all = await whatsUpNowTool({ ...SYDNEY, mode: 'radio', minElevation: 0, limit: 50 }, depsAt(NOON));
  const one = await whatsUpNowTool({ ...SYDNEY, mode: 'radio', minElevation: 0, limit: 1 }, depsAt(NOON));
  assert.deepEqual(one.satellites, all.satellites.slice(0, 1));
  assert.equal(one.aboveCount, all.aboveCount);
  const high = await whatsUpNowTool({ ...SYDNEY, mode: 'radio', minElevation: 30, limit: 50 }, depsAt(NOON));
  assert.deepEqual(high.satellites, all.satellites.filter((s) => s.elevationDeg >= 30));
});

test('whats_up_now needs the catalog and a location', async () => {
  await assert.rejects(() => whatsUpNowTool({ ...SYDNEY }, { now: () => DUSK }), /catalog is unavailable/);
  await assert.rejects(() => whatsUpNowTool({}, depsAt(DUSK)), /location/);
});

test('prepareSky builds satrecs once per catalog list, and drops bad elements', () => {
  const bad = { noradId: 1, record: { noradId: 1, name: 'NOTHING' }, downlinks: [] };
  const list = [...LIST.slice(0, 5), bad];
  const a = prepareSky(list);
  assert.equal(prepareSky(list), a);
  assert.equal(a.length, 5);
  assert.equal(a[0].name, 'SYN 0');
});

// identify_satellite: point at a satellite whats_up_now lists, and it should
// come back as the best match.
const visibleNow = async () => (await whatsUpNowTool({ ...SYDNEY }, depsAt(DUSK))).satellites;
const AT_DUSK = { ...SYDNEY, time: new Date(DUSK).toISOString() };
const OBS = { latDeg: SYDNEY.lat, lonDeg: SYDNEY.lon };

test('identify_satellite: the satellite at the reported spot is the best match', async () => {
  for (const s of await visibleNow()) {
    const out = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg }, depsAt(0));
    const [top] = out.candidates;
    assert.equal(top.noradId, s.noradId);
    assert.ok(top.angularErrorDeg < 0.2);
    assert.equal(top.url, s.url);
    assert.equal(top.magnitude, s.magnitude);
    assert.equal(out.skyDark, true);
    assert.equal(out.satellitesScanned, 300);
    assert.match(top.travel, /^(N|NE|E|SE|S|SW|W|NW)$/);
    assert.equal(top.travelErrorDeg, null);
  }
});

test('identify_satellite: its direction of travel is how it moves across the sky', async () => {
  const [s] = await visibleNow();
  const out = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg }, depsAt(0));
  const top = out.candidates[0];
  // The app's own track a minute either side.
  const rec = LIST.find((x) => x.noradId === s.noradId).record;
  const a = engineLook(rec, OBS, DUSK - 60_000), b = engineLook(rec, OBS, DUSK + 60_000);
  const bearing = travelBearingDeg({ azDeg: a.az, elDeg: a.el }, { azDeg: b.az, elDeg: b.el });
  assert.ok(bearingDiffDeg(bearing, top.travelBearingDeg) < 1, `${bearing} vs ${top.travelBearingDeg}`);
  // Told the right way it was going, it matches; told the opposite, it does not.
  const right = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg, travel: compass(bearing) }, depsAt(0));
  assert.equal(right.candidates[0].noradId, s.noradId);
  assert.ok(right.candidates[0].travelErrorDeg <= 23);
  const wrong = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg, travel: compass(bearing + 180) }, depsAt(0));
  assert.ok(wrong.candidates.find((c) => c.noradId === s.noradId).travelErrorDeg >= 157);
});

test('identify_satellite takes a compass word and a rough elevation, within the tolerance', async () => {
  const [s] = await visibleNow();
  const out = await identifySatelliteTool({ ...AT_DUSK, direction: s.direction, elevation: s.elevationDeg + 4, tolerance: 30 }, depsAt(0));
  const hit = out.candidates.find((c) => c.noradId === s.noradId);
  assert.ok(hit, 'still found');
  assert.ok(hit.angularErrorDeg <= 30);
  assert.equal(out.sighting.direction, s.direction);
  for (const c of out.candidates) assert.ok(c.angularErrorDeg <= 30);
  // Tight tolerance around an empty part of the sky: nothing, and it says so.
  const empty = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg, tolerance: 1 }, depsAt(0, LIST.filter((x) => x.noradId !== s.noradId)));
  assert.deepEqual(empty.candidates, []);
  assert.match(empty.note, /No sunlit satellite was within 1°/);
});

test('identify_satellite: a known bright satellite beats an estimated twin at the same spot', async () => {
  const [s] = await visibleNow();
  const twin = LIST.find((x) => x.noradId === s.noradId);
  const iss = { noradId: 25544, record: { noradId: 25544, name: 'ISS (ZARYA)', omm: { ...twin.record.omm, NORAD_CAT_ID: 25544 } }, downlinks: [] };
  const out = await identifySatelliteTool({ ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg }, depsAt(0, [...LIST, iss]));
  assert.deepEqual(out.candidates.slice(0, 2).map((c) => c.noradId), [25544, s.noradId]);
  assert.equal(out.candidates[0].magnitudeEstimated, false);
});

test('identify_satellite in daylight finds nothing and says why', async () => {
  const out = await identifySatelliteTool({ ...SYDNEY, time: new Date(NOON).toISOString(), direction: 'NE', elevation: 40 }, depsAt(0));
  assert.equal(out.skyDark, false);
  assert.deepEqual(out.candidates, []);
  assert.match(out.note, /too bright/);
});

test('identify_satellite checks its inputs', async () => {
  const d = depsAt(DUSK);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, elevation: 30 }, d), /azimuth in degrees, or a direction/);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, direction: 'up-ish', elevation: 30 }, d), /unknown direction: up-ish/);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, azimuth: 40 }, d), /elevation is required/);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, azimuth: 40, elevation: 95 }, d), /elevation is required/);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, azimuth: 40, elevation: 30, time: 'last night' }, d), /time "last night" is not a time I can read\. Use ISO 8601, e\.g\. "2026-11-14T21:00:00-06:00"/);
  await assert.rejects(() => identifySatelliteTool({ ...SYDNEY, azimuth: 40, elevation: 30, travel: 'away' }, d), /unknown direction of travel/);
  // Time defaults to now.
  const now = await identifySatelliteTool({ ...SYDNEY, azimuth: 40, elevation: 30 }, d);
  assert.equal(now.time, new Date(DUSK).toISOString());
});

test('compass words, angles in the sky, and bearings', () => {
  assert.equal(parseCompass('N'), 0);
  assert.equal(parseCompass('ne'), 45);
  assert.equal(parseCompass('North-East'), 45);
  assert.equal(parseCompass(' south south west '), 202.5);
  assert.equal(parseCompass('westward'), 270);
  assert.equal(parseCompass('NNW'), 337.5);
  assert.equal(parseCompass('up'), null);
  assert.equal(parseCompass(42), null);
  assert.ok(Math.abs(angularSeparationDeg(0, 90, 180, 80) - 10) < 1e-9, 'across the zenith');
  assert.ok(Math.abs(angularSeparationDeg(350, 0, 10, 0) - 20) < 1e-9, 'across north');
  assert.equal(bearingDiffDeg(350, 10), 20);
  assert.equal(bearingDiffDeg(90, 270), 180);
  // Rising in the south-west and climbing: heading north-east.
  assert.equal(compass(travelBearingDeg({ azDeg: 225, elDeg: 20 }, { azDeg: 225, elDeg: 40 })), 'NE');
});

test('premium satellites stay out of the whole-sky tools for a free caller', async () => {
  const [s] = await visibleNow();
  const twin = LIST.find((x) => x.noradId === s.noradId);
  // A fake premium entry flying exactly where the visible one is.
  const premium = { noradId: 99001, tier: 'premium', record: { noradId: 99001, name: 'SPY SAT', omm: { ...twin.record.omm, NORAD_CAT_ID: 99001 } }, downlinks: [{ hz: 437e6, mode: 'fm', label: 'FM' }] };
  const d = depsAt(DUSK, [...LIST, premium]);
  const ids = (out) => (out.satellites ?? out.candidates).map((x) => x.noradId);
  const sighting = { ...AT_DUSK, azimuth: s.azimuthDeg, elevation: s.elevationDeg };
  for (const mode of ['visual', 'radio']) {
    assert.equal(ids(await whatsUpNowTool({ ...SYDNEY, mode, minElevation: 0, limit: 50 }, d)).includes(99001), false, mode);
    assert.equal(ids(await whatsUpNowTool({ ...SYDNEY, mode, minElevation: 0, limit: 50 }, d, 'pro')).includes(99001), true, mode);
  }
  assert.equal(ids(await identifySatelliteTool(sighting, d)).includes(99001), false);
  assert.equal(ids(await identifySatelliteTool(sighting, d, 'pro')).includes(99001), true);
});
