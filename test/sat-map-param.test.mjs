import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAllHref, isMapAll } from '../lib/sat/map-param.mjs';

// The satellite page's Show all lives in ?map=all, so a refresh or a copied
// URL keeps every followed satellite on the map.

test('isMapAll reads ?map=all only', () => {
  assert.equal(isMapAll('?map=all'), true);
  assert.equal(isMapAll('?s=abc&map=all'), true);
  assert.equal(isMapAll(''), false);
  assert.equal(isMapAll('?map=focus'), false);
});

test('mapAllHref sets and clears map=all, keeping other params', () => {
  assert.equal(mapAllHref('/sat/25544', '', true), '/sat/25544?map=all');
  assert.equal(mapAllHref('/sat/25544', '?map=all', false), '/sat/25544');
  assert.equal(mapAllHref('/sat/25544', '?s=abc', true), '/sat/25544?s=abc&map=all');
  assert.equal(mapAllHref('/sat/25544', '?s=abc&map=all', false), '/sat/25544?s=abc');
});
