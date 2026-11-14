// What people (and agents) type for a location: grid squares, coordinates
// in their many written forms, place names, and what the MCP and the
// geocoder do with each. lib/location/maidenhead.mjs is the one parser the
// site's location boxes and the MCP share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridToLatLon, latLonToGrid, parseLatLonText, parseLocationInput } from '../lib/location/maidenhead.mjs';
import { resolveLocation } from '../lib/mcp/tools.mjs';
import { geocodeOne } from '../lib/pass-finder/geocode.js';

const close = (a, b, tol = 0.002) => Math.abs(a - b) <= tol;
const at = (r, lat, lon, tol) => r && close(r.latDeg, lat, tol) && close(r.lonDeg, lon, tol);

// ---- Grid squares ----------------------------------------------------------

test('grid squares of 4, 6 and 8 characters, any case, give their centres', () => {
  const cases = [
    ['EN52', 42.5, -89],
    ['EN52ve', 42.1875, -88.2083],
    ['EN52VE', 42.1875, -88.2083],
    ['en52ve', 42.1875, -88.2083],
    ['EN52ve12', 42.1771, -88.2375],
    ['IO91wm', 51.5208, -0.125],
    ['FN31pr', 41.7292, -72.7083],
    ['QF56od', -33.8542, 151.2083],
    ['AA00aa', -89.9792, -179.9583],
    ['RR99xx', 89.9792, 179.9583],
  ];
  for (const [g, lat, lon] of cases) assert.ok(at(gridToLatLon(g), lat, lon), g);
});

test('a point and its grid square round-trip at every precision', () => {
  for (const [lat, lon] of [[41.88, -87.63], [-33.87, 151.21], [51.5, -0.13], [0, 0], [-89.9, 179.9], [64.1, -21.9]]) {
    for (const chars of [4, 6, 8]) {
      const grid = latLonToGrid(lat, lon, chars);
      assert.equal(grid.length, chars, grid);
      const c = gridToLatLon(grid);
      // The centre is within half a square of the point.
      const half = { 4: [0.5, 1], 6: [1 / 48, 1 / 24], 8: [1 / 480, 1 / 240] }[chars];
      assert.ok(Math.abs(c.latDeg - lat) <= half[0] + 1e-9 && Math.abs(c.lonDeg - lon) <= half[1] + 1e-9, `${lat},${lon} ${grid}`);
    }
  }
});

test('things that look like grids but are not', () => {
  for (const g of ['SN52', 'ES52', 'EN5', 'EN52v', 'EN52vz', 'EN52ve1', 'EN52ve1a', 'E N52', '12EN', '']) {
    assert.equal(gridToLatLon(g), null, g);
  }
});

test('parseLocationInput names a grid square in its usual case', () => {
  assert.deepEqual(parseLocationInput('en52VE'), { kind: 'grid', grid: 'EN52ve', ...gridToLatLon('EN52ve') });
  assert.equal(parseLocationInput(' EN52 ').grid, 'EN52');
  assert.equal(parseLocationInput('EN52ve12').grid, 'EN52ve12');
});

// ---- Coordinates -----------------------------------------------------------

const CHICAGO = [
  // Decimal, with every separator.
  '41.88, -87.63', '41.88,-87.63', '41.88 , -87.63', '41.88 -87.63', '41.88   -87.63', '41.88;-87.63', '41.88; -87.63',
  '41.88 | -87.63', '+41.88, -87.63', '+41.88 -87.63', '41.880000, -87.630000', ' 41.88, -87.63 ',
  // Hemisphere letters after or before, any case, longitude first when lettered.
  '41.88N 87.63W', '41.88N, 87.63W', '41.88 N 87.63 W', '41.88 N, 87.63 W', '41.88n 87.63w', 'N41.88 W87.63',
  'N 41.88, W 87.63', 'N41.88, W87.63', '87.63W 41.88N', '87.63W, 41.88N', 'W87.63 N41.88',
  // Degrees, minutes and seconds, in many hands.
  "41°52'48\"N 87°37'48\"W", "41°52'48\"N, 87°37'48\"W", "41° 52' 48\" N, 87° 37' 48\" W", '41 52 48 N 87 37 48 W',
  '41 52 48N, 87 37 48W', "N 41° 52' 48\", W 87° 37' 48\"", '41°52′48″N 87°37′48″W', '41º52\'48"N 87º37\'48"W',
  '41˚52\'48"N 87˚37\'48"W', '41°52’48”N 87°37’48”W', "41°52'48''N 87°37'48''W", '41d52m48sN 87d37m48sW',
  '41d 52m 48s N, 87d 37m 48s W',
  // Degrees and decimal minutes.
  "41°52.8'N, 87°37.8'W", "41 52.8 N 87 37.8 W", "N41 52.8 W87 37.8",
  // Degree marks and words on decimals.
  '41.88°, -87.63°', '41.88° N, 87.63° W', '41.88 deg N, 87.63 deg W', '41.88 degrees N, 87.63 degrees W',
  // Labels.
  'lat: 41.88, lon: -87.63', 'lat 41.88 lon -87.63', 'Lat 41.88 Lng -87.63', 'LAT: 41.88 LONG: -87.63',
  'latitude 41.88 longitude -87.63', 'latitude: 41.88, longitude: -87.63', 'lat=41.88 lon=-87.63',
  // Decimal commas, with a semicolon between.
  '41,88; -87,63', '41,88 ; -87,63',
  // Typographic minus signs and dashes.
  '41.88, −87.63', '41.88, –87.63', '41.88, ‐87.63',
  // Map links and geo URIs.
  'geo:41.88,-87.63', 'https://www.google.com/maps/@41.88,-87.63,12z', 'https://maps.google.com/?q=41.88,-87.63',
  'https://www.google.com/maps/search/?api=1&query=41.88%2C-87.63', 'https://maps.apple.com/?ll=41.88,-87.63',
];

test('Chicago written every common way reads as 41.88, -87.63', () => {
  for (const t of CHICAGO) {
    const r = parseLatLonText(t);
    assert.ok(at(r, 41.88, -87.63, 0.005), `${JSON.stringify(t)} -> ${JSON.stringify(r)}`);
    assert.equal(parseLocationInput(t).kind, 'coords', t);
  }
});

test('every quarter of the globe keeps its signs', () => {
  const cases = [
    ['33.87S 151.21E', -33.87, 151.21], ["33°52'S 151°12'E", -33.8667, 151.2], ['-33.87, 151.21', -33.87, 151.21],
    ['51.5N 0.13W', 51.5, -0.13], ['51.5, -0.13', 51.5, -0.13], ['22.9S 43.2W', -22.9, -43.2], ['-22.9 -43.2', -22.9, -43.2],
    ['64.15N 21.94W', 64.15, -21.94], ['1.35N 103.82E', 1.35, 103.82], ['0, 0', 0, 0], ['0N 0E', 0, 0],
    ['90N 0E', 90, 0], ['90S 180W', -90, -180], ['-0.5, -0.5', -0.5, -0.5], ['89.999, 179.999', 89.999, 179.999],
  ];
  for (const [t, lat, lon] of cases) assert.ok(at(parseLatLonText(t), lat, lon), `${t} -> ${JSON.stringify(parseLatLonText(t))}`);
});

test('seconds and minutes convert exactly', () => {
  const r = parseLatLonText("12°30'36\"N 45°15'18\"W");
  assert.ok(close(r.latDeg, 12.51, 1e-9) && close(r.lonDeg, -45.255, 1e-9));
  const m = parseLatLonText("12°30.6'S 45°15.3'E");
  assert.ok(close(m.latDeg, -12.51, 1e-9) && close(m.lonDeg, 45.255, 1e-9));
});

test('text that is not a position is left for the geocoder', () => {
  const notPositions = [
    'Chicago', 'Chicago, IL', 'St Louis, MO', 'New York', 'North East', 'South West Rocks', 'Route 66', 'I-80, Iowa',
    '10 Downing St, London', '1600 Pennsylvania Ave NW', 'Area 51', 'AB12 3CD', 'Paris, France', 'EN52ve',
    '41.88', '41.88, -87.63, 200', '41.88E 87.63E', '41.88N 87.63N', '-41.88S, 87.63W', '41.88N, -87.63W',
    '41 61 00 N, 87 00 00 W', '41 00 61 N, 87 00 00 W', 'N41.88N 87.63W', 'lat 41.88', '', '   ', 'geo:', ', ',
  ];
  for (const t of notPositions) assert.equal(parseLatLonText(t), null, JSON.stringify(t));
});

test('parseLocationInput sorts input into grid, coords, place, invalid or nothing', () => {
  assert.equal(parseLocationInput('EN52ve').kind, 'grid');
  assert.equal(parseLocationInput('41.88N 87.63W').kind, 'coords');
  assert.deepEqual(parseLocationInput('Elgin, Illinois'), { kind: 'place', query: 'Elgin, Illinois' });
  assert.deepEqual(parseLocationInput('  Tokyo  '), { kind: 'place', query: 'Tokyo' });
  assert.equal(parseLocationInput(''), null);
  assert.equal(parseLocationInput(null), null);
  // Out of range: said, not searched for (a swapped pair stays as written).
  for (const t of ['91, 0', '0, 181', '-90.5, 10', '151.2, -33.9', '200N 0E']) {
    const r = parseLocationInput(t);
    assert.equal(r.kind, 'invalid', t);
    assert.match(r.message, /Latitude runs from -90 to 90/);
  }
});

// ---- The MCP's location ----------------------------------------------------

function fakeGeocode(answer) {
  const calls = [];
  return { calls, geocode: async (q) => { calls.push(q); return typeof answer === 'function' ? answer(q) : answer; } };
}

test('MCP: lat and lon are used as given, with the time zone, and no lookup', async () => {
  const g = fakeGeocode(null);
  const r = await resolveLocation({ lat: 41.88, lon: -87.63, location: 'ignored' }, g);
  assert.deepEqual([r.latDeg, r.lonDeg, r.timeZone], [41.88, -87.63, 'America/Chicago']);
  assert.equal(g.calls.length, 0);
});

test('MCP: grid squares and written coordinates are read without a lookup', async () => {
  for (const [location, lat, lon, zone] of [
    ['EN52ve', 42.1875, -88.2083, 'America/Chicago'],
    ['QF56od', -33.8542, 151.2083, 'Australia/Sydney'],
    ["41°52'48\"N 87°37'48\"W", 41.88, -87.63, 'America/Chicago'],
    ['https://www.google.com/maps/@51.5,-0.13,12z', 51.5, -0.13, 'Europe/London'],
    ['35.68N 139.69E', 35.68, 139.69, 'Asia/Tokyo'],
  ]) {
    const g = fakeGeocode(null);
    const r = await resolveLocation({ location }, g);
    assert.ok(at(r, lat, lon), location);
    assert.equal(r.timeZone, zone, location);
    assert.equal(g.calls.length, 0, location);
  }
  const grid = await resolveLocation({ location: 'en52ve' }, fakeGeocode(null));
  assert.equal(grid.displayName, 'grid square EN52ve');
});

test('MCP: a place name is looked up, and failures say what to do', async () => {
  const found = fakeGeocode({ latDeg: 35.68, lonDeg: 139.69, displayName: 'Tokyo, Japan' });
  const r = await resolveLocation({ location: 'Tokyo' }, found);
  assert.equal(found.calls[0], 'Tokyo');
  assert.equal(r.timeZone, 'Asia/Tokyo');
  await assert.rejects(resolveLocation({ location: 'Nowhereville' }, fakeGeocode(null)), /could not find a place called "Nowhereville".*lat and lon/);
  await assert.rejects(resolveLocation({ location: 'Tokyo' }, fakeGeocode({ busy: true })), /busy.*lat and lon/);
  await assert.rejects(resolveLocation({ location: '95, 10' }, fakeGeocode(null)), /Latitude runs from -90 to 90/);
  await assert.rejects(resolveLocation({}, fakeGeocode(null)), /location is required/);
});

// ---- The geocoder ----------------------------------------------------------

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push({ url, at: Date.now() });
    return handler(url);
  };
  return { calls, fetchImpl };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (n) => ({ ok: false, status: n, json: async () => ({}) });
const place = [{ lat: '35.68', lon: '139.69', display_name: 'Tokyo, Japan', address: { city: 'Tokyo', country: 'Japan' } }];
let n = 0;
const unique = (s) => `${s} ${++n} ${Math.random().toString(36).slice(2)}`;

test('geocoder: an answer is cached, so a repeat makes no request', async () => {
  const f = fakeFetch(() => ok(place));
  const q = unique('Tokyo');
  const a = await geocodeOne(q, { fetchImpl: f.fetchImpl, gapMs: 0 });
  const b = await geocodeOne(q.toUpperCase(), { fetchImpl: f.fetchImpl, gapMs: 0 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual([a.latDeg, a.lonDeg], [35.68, 139.69]);
  assert.deepEqual(b, a);
});

test('geocoder: lookups are spaced at least the gap apart', async () => {
  const f = fakeFetch(() => ok(place));
  await Promise.all([1, 2, 3].map(() => geocodeOne(unique('Spaced'), { fetchImpl: f.fetchImpl, gapMs: 60 })));
  assert.equal(f.calls.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(f.calls[i].at - f.calls[i - 1].at >= 50, `gap ${f.calls[i].at - f.calls[i - 1].at}`);
});

test('geocoder: a refusal is busy, not "no such place", and is not cached', async () => {
  for (const code of [429, 403, 503]) {
    let first = true;
    const f = fakeFetch(() => (first ? ((first = false), status(code)) : ok(place)));
    const q = unique('Busy');
    assert.deepEqual(await geocodeOne(q, { fetchImpl: f.fetchImpl, gapMs: 0 }), { busy: true }, String(code));
    const again = await geocodeOne(q, { fetchImpl: f.fetchImpl, gapMs: 0 });
    assert.equal(again.latDeg, 35.68, String(code));
  }
});

test('geocoder: no match is null; a failed request is null and tried again next time', async () => {
  const none = fakeFetch(() => ok([]));
  assert.equal(await geocodeOne(unique('Nothing'), { fetchImpl: none.fetchImpl, gapMs: 0 }), null);
  let fail = true;
  const flaky = fakeFetch(() => (fail ? ((fail = false), status(500)) : ok(place)));
  const q = unique('Flaky');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await geocodeOne(q, { fetchImpl: flaky.fetchImpl, gapMs: 0 }), null);
  } finally {
    console.warn = warn;
  }
  assert.equal((await geocodeOne(q, { fetchImpl: flaky.fetchImpl, gapMs: 0 })).latDeg, 35.68);
  assert.equal(await geocodeOne('   ', { fetchImpl: flaky.fetchImpl, gapMs: 0 }), null);
});

test('long or hostile text is cheap to reject', () => {
  const hostile = [
    'N1 '.repeat(66), '1 '.repeat(100), 'N'.repeat(199) + '1', ('1'.repeat(30) + ' ').repeat(6), "1°1'1\"".repeat(30),
    'a'.repeat(5000), `${'1 '.repeat(3000)}N`,
  ];
  const t0 = performance.now();
  for (const t of hostile) {
    parseLatLonText(t);
    parseLocationInput(t);
  }
  assert.ok(performance.now() - t0 < 200, `took ${performance.now() - t0} ms`);
  assert.equal(parseLatLonText('1'.repeat(201)), null);
  assert.equal(parseLocationInput('x'.repeat(201)).kind, 'invalid');
});

test('geocoder: a long queue says busy at once instead of waiting', async () => {
  const f = fakeFetch(() => ok(place));
  const answers = await Promise.all([1, 2, 3, 4, 5, 6].map(() => geocodeOne(unique('Flood'), { fetchImpl: f.fetchImpl, gapMs: 1000 })));
  assert.ok(answers.some((a) => a && a.busy), 'some callers are told busy');
  assert.ok(f.calls.length <= 5);
});
