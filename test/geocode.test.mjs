import { test } from 'node:test';
import assert from 'node:assert/strict';
test('placeNameOf: town and region, or whichever there is', async () => {
  const { placeNameOf } = await import('../lib/pass-finder/geocode.js');
  assert.equal(placeNameOf({ city: 'Chicago', state: 'Illinois', country: 'United States' }), 'Chicago, Illinois');
  assert.equal(placeNameOf({ village: 'Uspallata', state: 'Mendoza' }), 'Uspallata, Mendoza');
  assert.equal(placeNameOf({ country: 'Chile' }), 'Chile');
  assert.equal(placeNameOf({}), null);
  assert.equal(placeNameOf(null), null);
});

test('reverseGeocodeName: a failed or empty lookup gives null', async () => {
  const { reverseGeocodeName } = await import('../lib/pass-finder/geocode.js');
  assert.equal(await reverseGeocodeName(0, -140, { fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'Unable to geocode' }) }) }), null);
  assert.equal(await reverseGeocodeName(1, 2, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await reverseGeocodeName(41.9, -87.6, { fetchImpl: async () => ({ ok: true, json: async () => ({ address: { city: 'Chicago', state: 'Illinois' } }) }) }), 'Chicago, Illinois');
});

test('reverseGeocodeName asks once per place, a "no place" answer included', async () => {
  const { reverseGeocodeName } = await import('../lib/pass-finder/geocode.js');
  let asked = 0;
  const sea = async () => { asked++; return { ok: true, json: async () => ({ error: 'Unable to geocode' }) }; };
  const lat = 10 + Math.random(), lon = -140 + Math.random();
  assert.equal(await reverseGeocodeName(lat, lon, { fetchImpl: sea }), null);
  assert.equal(await reverseGeocodeName(lat, lon, { fetchImpl: sea }), null);
  assert.equal(asked, 1);
});
