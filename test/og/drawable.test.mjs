import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDrawable, placeName, coordsText } from '../../lib/og/drawable.mjs';
import { passLines } from '../../lib/og/globe-scene.mjs';
import { viewImageAlt } from '../../lib/og/view-alt.mjs';

test('Latin place names, accents included, are drawn as written', () => {
  for (const n of ['Chicago', 'São Paulo', 'Łódź', 'Zürich', 'İstanbul', 'Kraków', "Coeur d'Alene"]) assert.ok(isDrawable(n), n);
});

test('names the bundled fonts cannot draw become coordinates, not empty boxes', () => {
  for (const n of ['Москва', '東京', '서울', 'Αθήνα']) assert.ok(!isDrawable(n), n);
  assert.equal(placeName({ name: '東京', latDeg: 35.68, lonDeg: 139.77 }), '35.7°N, 139.8°E');
  assert.equal(placeName({ name: 'São Paulo', latDeg: -23.55, lonDeg: -46.63 }), 'São Paulo');
  assert.equal(placeName({ name: '', latDeg: 1, lonDeg: 2 }), null);
  assert.equal(coordsText(-33.87, -70.5), '33.9°S, 70.5°W');
});

test("a shared pass's lines name a non-Latin place by its coordinates", () => {
  const sel = { observer: { name: 'Москва', latDeg: 55.76, lonDeg: 37.62 }, win: { startMs: Date.parse('2026-03-01T18:00:00Z'), endMs: Date.parse('2026-03-01T18:06:00Z') }, maxAlt: 40 };
  const [first] = passLines({ ecefAt: () => null, sel });
  assert.match(first, / from 55\.8°N, 37\.6°E$/);
});

test('a shared map image is described by how many satellites it shows', () => {
  assert.match(viewImageAlt('?map=globe&sats=25544,48274,20580'), /3 satellites/);
  assert.match(viewImageAlt('?map=globe&sats=25544'), /one satellite/);
});

test('a shared pass from "My location" says where: its place, else coordinates', async () => {
  const { fromText } = await import('../../lib/og/drawable.mjs');
  const { shareNameOf, cleanLocation } = await import('../../lib/home/places.mjs');
  const at = { latDeg: 41.88, lonDeg: -87.63 };
  assert.equal(fromText({ ...at, name: 'My location' }), ' from 41.9°N, 87.6°W');
  assert.equal(fromText({ ...at, name: '' }), ' from 41.9°N, 87.6°W');
  assert.equal(fromText({ ...at, name: 'Chicago' }), ' from Chicago');
  const gps = cleanLocation({ name: 'My location', ...at, source: 'gps', place: 'Chicago, Illinois' });
  assert.equal(gps.place, 'Chicago, Illinois');
  assert.equal(shareNameOf(gps), 'Chicago, Illinois');
  assert.equal(shareNameOf({ ...gps, place: undefined }), '');
  assert.equal(shareNameOf({ name: 'Paris', ...at, source: 'place' }), 'Paris');
});

test('a shared map is described by the satellites it shows', async () => {
  const { viewDescription } = await import('../../lib/og/view-alt.mjs');
  assert.match(viewDescription('?map=globe&sats=25544,48274'), /^ISS and Tiangong on a live SeekSat map: where they are now/);
  assert.match(viewDescription('?map=globe&sats=25544'), /^ISS on a live SeekSat map: where it is now and its orbit track\.$/);
  assert.equal(viewDescription('?nothing=1'), null);
});
