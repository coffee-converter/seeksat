import test from 'node:test';
import assert from 'node:assert/strict';
import { placesLine } from '../lib/sat/places-line.mjs';

test('placesLine', () => {
  assert.equal(placesLine(['Chicago']), null);
  assert.equal(placesLine(['Chicago', 'Tokyo']), 'Showing passes Chicago and Tokyo can both see');
  assert.equal(placesLine(['Chicago', 'Tokyo', 'Paris']), 'Showing passes Chicago, Tokyo and Paris can all see');
  assert.equal(placesLine(['', 'Tokyo']), 'Showing passes Your location and Tokyo can both see');
  assert.equal(placesLine(['  ', 'Tokyo']), 'Showing passes Your location and Tokyo can both see');
});
