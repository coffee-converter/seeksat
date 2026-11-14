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
