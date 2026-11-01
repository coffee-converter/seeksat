import { test } from 'node:test';
import assert from 'node:assert/strict';
import places from '../lib/map/places.json' with { type: 'json' };
import { REGIONS } from '../lib/map/regions.mjs';

test('places.json is a ranked list of valid entries', () => {
  assert.ok(Array.isArray(places));
  assert.ok(places.length >= 800, `only ${places.length} entries`);
  for (const e of places) {
    assert.equal(e.length, 4);
    const [name, lat, lon, rank] = e;
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0);
    assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, name);
    assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180, name);
    assert.ok(Number.isInteger(rank) && rank >= 0 && rank <= 7, name);
  }
});

test('big cities are present with a high rank', () => {
  for (const n of ['London', 'Tokyo', 'Chicago', 'Sydney']) {
    const best = Math.min(...places.filter((e) => e[0] === n).map((e) => e[3]));
    assert.ok(best <= 2, `${n} rank ${best}`);
  }
});

test('places are sorted by rank ascending', () => {
  for (let i = 1; i < places.length; i++) assert.ok(places[i][3] >= places[i - 1][3]);
});

test('REGIONS has 7 continents, 5 oceans and in-range points', () => {
  assert.equal(REGIONS.filter((r) => r.kind === 'continent').length, 7);
  assert.equal(REGIONS.filter((r) => r.kind === 'ocean').length, 5);
  assert.ok(REGIONS.filter((r) => r.kind === 'sea').length >= 14);
  for (const r of REGIONS) {
    assert.ok(r.name && Number.isInteger(r.rank), r.name);
    assert.ok(r.points.length >= 1, r.name);
    for (const [lon, lat] of r.points) {
      assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, r.name);
    }
  }
});
