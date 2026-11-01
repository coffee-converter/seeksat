import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReader } from '../../lib/mirror/reader.mjs';
import { createMemorySnapshotStore } from '../../lib/mirror/snapshot-store.mjs';
import { ISS_OMM } from '../fixtures/omm-iss.mjs';
import { buildSatCardSvg } from '../../lib/og/sat-card.mjs';
import { satOgResponse } from '../../lib/og/sat-og.mjs';

const T0 = Date.parse('2026-03-01T13:00:00Z');
const quiet = { warn() {}, error() {} };
const elements = { perigeeAltKm: 410.4, apogeeAltKm: 418.6, periodMin: 92.87, inclinationDeg: 51.64 };

function reader(objects) {
  return createCatalogReader({
    store: createMemorySnapshotStore({ version: 1, generatedAtMs: T0, objects }),
    onDemand: { get: async () => null }, now: () => T0, log: quiet,
  });
}

test('card escapes & and < in names', () => {
  const svg = buildSatCardSvg({ name: 'A&B <x>', noradId: 1, intlDesignator: '98067A', elements, ageText: '2 hours old' });
  assert.ok(svg.includes('A&amp;B &lt;x&gt;'));
  assert.ok(!svg.includes('A&B'));
  const s2 = buildSatCardSvg({ name: 'X', noradId: 1, intlDesignator: '9<8', elements: null, ageText: 'a<b & c' });
  assert.ok(s2.includes('9&lt;8') && s2.includes('a&lt;b &amp; c'));
  assert.ok(!s2.includes('9<8') && !s2.includes('a<b'));
});

test('card has no em dash, has orbit line and age', () => {
  const svg = buildSatCardSvg({ name: 'ISS', noradId: 25544, intlDesignator: '98067A', elements, ageText: '2 hours old' });
  assert.ok(!svg.includes('—'));
  assert.ok(svg.includes('NORAD 25544 · 98067A'));
  assert.ok(svg.includes('Orbit 410 by 419 km · 92.9 min · 51.6°'));
  assert.ok(svg.includes('2 hours old'));
  assert.ok(svg.includes('width="1200"') && svg.includes('height="630"'));
});

test('card omits orbit line without elements', () => {
  const svg = buildSatCardSvg({ name: 'ISS', noradId: 1, intlDesignator: null, elements: null, ageText: 'x' });
  assert.ok(!svg.includes('Orbit '));
});

test('long names wrap to two lines with ellipsis', () => {
  const name = 'VERY LONG SATELLITE NAME NUMBER ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE';
  const svg = buildSatCardSvg({ name, noradId: 1, intlDesignator: null, elements: null, ageText: 'x' });
  assert.equal((svg.match(/data-name-line=/g) || []).length, 2);
  assert.ok(svg.includes('...<'));
  const short = buildSatCardSvg({ name: 'LONG NAME FOR WRAPPING TEST ONLY', noradId: 1, intlDesignator: null, elements: null, ageText: 'x' });
  assert.equal((short.match(/data-name-line=/g) || []).length, 2);
  assert.ok(!short.includes('...'));
});

test('satOgResponse 404s for invalid and missing ids', async () => {
  const r = reader({});
  for (const p of ['abc', '99999']) {
    const res = await satOgResponse(p, { reader: r, nowMs: T0 });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'public, s-maxage=600');
  }
});

test('satOgResponse returns a PNG for the ISS', async () => {
  const rec = {
    noradId: 25544, name: ISS_OMM.OBJECT_NAME, omm: ISS_OMM, epochMs: Date.parse(ISS_OMM.EPOCH + 'Z'),
    source: 'celestrak-gp', fetchedAtMs: T0, groups: ['active'],
  };
  const res = await satOgResponse('25544', { reader: reader({ 25544: rec }), nowMs: T0 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(buf.readUInt32BE(16), 1200);
});
