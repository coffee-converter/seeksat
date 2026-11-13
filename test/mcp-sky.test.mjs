// test/mcp-sky.test.mjs - whole-sky MCP tools (whats_up_now and
// identify_satellite) over a synthetic catalog built from the ISS fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsUpNowTool } from '../lib/mcp/tools.mjs';
import { prepareSky } from '../lib/mcp/sky.mjs';
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
  assert.equal(out.scannedSatellites, 300);
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
