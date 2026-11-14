import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReader } from '../lib/mirror/reader.mjs';
import { createMemorySnapshotStore } from '../lib/mirror/snapshot-store.mjs';
import { resolveSatellite } from '../lib/catalog.mjs';
import { makeTrack } from '../lib/sat/track.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';
import {
  parseSatParam, satPath, rawElements, sourceLabel, satPageData, satMetadata, elementEpochMs,
} from '../lib/sat/page-data.mjs';

const ISS_T0 = Date.parse('2026-03-01T13:00:00Z');
const quiet = { warn() {}, error() {} };

async function served(omm, extra = {}) {
  const noradId = omm.NORAD_CAT_ID;
  const rec = {
    noradId, name: omm.OBJECT_NAME, omm, epochMs: Date.parse(omm.EPOCH + 'Z'),
    source: 'celestrak-gp', fetchedAtMs: ISS_T0, groups: ['active', 'weather'], ...extra,
  };
  const store = createMemorySnapshotStore({ version: 1, generatedAtMs: ISS_T0, objects: { [noradId]: rec } });
  const reader = createCatalogReader({ store, onDemand: { get: async () => null }, now: () => ISS_T0, log: quiet });
  return reader.getSnapshotRecord(noradId);
}

const ISS_SERVED_RECORD = await served(ISS_OMM);
const DECAYED_OMM = {
  ...ISS_OMM, MEAN_MOTION: 17.5,
  EPOCH: new Date(ISS_T0 - 400 * 86_400_000).toISOString().replace('Z', ''),
};
const DECAYED_RECORD = await served(DECAYED_OMM);

test('parseSatParam', () => {
  assert.deepEqual(parseSatParam('25544'), { id: 25544, canonical: true });
  assert.deepEqual(parseSatParam('25544-iss-zarya'), { id: 25544, canonical: false });
  assert.deepEqual(parseSatParam('025544'), { id: 25544, canonical: false });
  for (const bad of ['', 'abc', '0', '1e5', '1234567890', '-5', '25544_x']) assert.equal(parseSatParam(bad), null);
  assert.equal(satPath(25544), '/sat/25544');
});

test('a six-digit catalog number has no TLE form', () => {
  const raw = rawElements({ noradId: 270001, omm: { NORAD_CAT_ID: 270001 } }, 'NEW OBJECT');
  assert.deepEqual([raw.twoLine, raw.threeLine, raw.tooBigForTle], [null, null, true]);
  assert.match(raw.omm, /270001/);
});

test('ISS page data', () => {
  const d = satPageData(ISS_SERVED_RECORD, resolveSatellite(25544), ISS_T0);
  assert.equal(d.name, 'ISS (ZARYA)');
  assert.equal(d.intlDesignator, '1998-067A');
  assert.ok(d.live.altitudeKm > 380);
  assert.match(d.raw.threeLine, /^ISS \(ZARYA\)\n1 25544U/);
  assert.ok(d.downlinks.length > 0);
  assert.doesNotThrow(() => JSON.stringify(d));
});

test('page data for elements that will not propagate', () => {
  const track = makeTrack(DECAYED_RECORD, null);
  assert.equal(track.stateAt(new Date(ISS_T0)), null);
  const d = satPageData(DECAYED_RECORD, null, ISS_T0);
  assert.equal(d.live, null);
  assert.ok(d.raw.omm);
});

test('page data never throws on a record with no elements', () => {
  const d = satPageData({ noradId: 7, omm: {}, epochMs: ISS_T0, source: 'x', groups: [] }, null, ISS_T0);
  assert.equal(d.elements, null);
  assert.equal(d.live, null);
  assert.equal(d.name, 'NORAD 7');
});

test('page data with no epoch anywhere says the age is unknown, never fresh', () => {
  const d = satPageData({ noradId: 7, omm: {}, source: 'x', groups: [] }, null, ISS_T0);
  assert.equal(d.epochMs, null);
  assert.equal(d.elementEpochMs, null);
  assert.deepEqual(d.age, { ageDays: null, level: 'stale', text: 'Element age unknown' });
});

test('page data age falls back to the epoch inside the elements', () => {
  const { epochMs, ...noEpoch } = ISS_SERVED_RECORD;
  const d = satPageData(noEpoch, resolveSatellite(25544), epochMs + 2 * 86_400_000);
  assert.equal(d.epochMs, null);
  assert.equal(d.elementEpochMs, epochMs);
  assert.equal(d.age.text, 'Elements are 2.0 days old');
});

test('elementEpochMs prefers the record epoch, then the track epoch', () => {
  assert.equal(elementEpochMs(5, { epochMs: 9 }), 5);
  assert.equal(elementEpochMs(null, { epochMs: 9 }), 9);
  assert.equal(elementEpochMs(null, null), null);
  assert.equal(elementEpochMs(null, { epochMs: NaN }), null);
});

test('sourceLabel', () => {
  assert.equal(sourceLabel(ISS_SERVED_RECORD), 'CelesTrak GP data (groups: active, weather)');
  assert.equal(sourceLabel({ source: 'celestrak-catnr' }), 'CelesTrak, looked up by catalog number');
  assert.equal(sourceLabel({ source: 'other' }), 'other');
});

test('satMetadata', () => {
  const m = satMetadata(satPageData(ISS_SERVED_RECORD, resolveSatellite(25544), ISS_T0));
  assert.equal(m.title, 'ISS (ZARYA), NORAD 25544: live position and passes');
  assert.equal(m.alternates.canonical, '/sat/25544');
  assert.match(m.description, /^Live position, speed and passes for ISS \(ZARYA\), NORAD 25544\. Orbit \d+ by \d+ km, period \d+\.\d min, inclination 51\.6°\.$/);
  assert.ok(!m.description.includes('—'));
  const alt = `${m.openGraph.images[0].alt}`;
  assert.match(alt, / on a globe: where it is now, with its orbit track$/);
  assert.deepEqual(m.openGraph.images, [{ url: '/api/og/sat/25544', width: 1200, height: 630, alt }]);
  assert.deepEqual(m.twitter, { card: 'summary_large_image', title: m.title, description: m.description, images: [{ url: '/api/og/sat/25544', alt }] });
  assert.equal(m.openGraph.title, m.title);
  assert.equal(m.openGraph.description, m.description);
  assert.equal(m.openGraph.url, '/sat/25544');
  assert.equal(m.openGraph.type, 'website');
  assert.equal(m.openGraph.siteName, 'SeekSat');
  const none = satMetadata({ ...satPageData(ISS_SERVED_RECORD, null, ISS_T0), elements: null });
  assert.equal(none.description, 'Live position and passes for ISS (ZARYA), NORAD 25544.');
});

test('lookupSat', async () => {
  const { lookupSat } = await import('../lib/sat/page-data.mjs');
  const mk = (snapshot) => createCatalogReader({
    store: createMemorySnapshotStore(snapshot), onDemand: { get: async () => null }, now: () => ISS_T0, log: quiet,
  });
  const good = mk({ version: 1, generatedAtMs: ISS_T0, objects: { 25544: ISS_SERVED_RECORD } });
  assert.deepEqual(await lookupSat(good, 'abc'), { kind: 'not-found' });
  assert.deepEqual(await lookupSat(good, '25544-iss'), { kind: 'redirect', path: '/sat/25544' });
  assert.equal((await lookupSat(good, '99999')).kind, 'not-found');
  const ok = await lookupSat(good, '25544');
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.record.noradId, 25544);
  await assert.rejects(lookupSat(mk(null), '25544'), /not available/);
});

test('lookupSat throws, never a cacheable not-found, when the on-demand result is unknown', async () => {
  const { lookupSat } = await import('../lib/sat/page-data.mjs');
  const reader = createCatalogReader({
    store: createMemorySnapshotStore({ version: 1, generatedAtMs: ISS_T0, objects: {} }),
    onDemand: { get: async () => undefined }, now: () => ISS_T0, log: quiet,
  });
  await assert.rejects(lookupSat(reader, '99999'), /not available/);
});

test('a satellite page carries a breadcrumb trail for search results', async () => {
  const { satJsonLd } = await import('../lib/sat/json-ld.mjs');
  const ld = satJsonLd({ noradId: 25544, name: 'ISS (ZARYA)' }, 'https://seeksat.com');
  assert.equal(ld['@type'], 'BreadcrumbList');
  assert.deepEqual(ld.itemListElement.map((i) => i.item), ['https://seeksat.com/', 'https://seeksat.com/sat/25544']);
  assert.equal(ld.itemListElement[1].name, 'ISS (ZARYA)');
});
