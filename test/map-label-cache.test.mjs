import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLabelCache, labelKey, satsKey } from '../lib/map/label-cache.mjs';

test('the same key costs one pick, a changed key costs one more', () => {
  let n = 0;
  const cache = createLabelCache(() => ({ n: ++n }));
  for (let i = 0; i < 10; i++) cache.get('a', []);
  assert.equal(n, 1);
  cache.get('b', []);
  assert.equal(n, 2);
  assert.equal(cache.get('b', []).n, 2);
});

test('array args are spread into pick', () => {
  const cache = createLabelCache((a, b) => a + b);
  assert.equal(cache.get('k', [1, 2]), 3);
});

const base = {
  projectionId: 'equirectangular', width: 900, height: 450, zoom: 1, pan: [0, 0],
  observer: { latDeg: 43.1, lonDeg: -89.3 }, sub: { latDeg: 10, lonDeg: 20 },
};

test('labelKey ignores the subpoint except in the satellite view', () => {
  const moved = { ...base, sub: { latDeg: 12.3, lonDeg: 55 } };
  assert.equal(labelKey(base), labelKey(moved));
  const s = { ...base, projectionId: 'satellite' };
  assert.notEqual(labelKey(s), labelKey({ ...s, sub: moved.sub }));
});

test('labelKey rounds the subpoint to 0.5 degrees and pan to whole pixels', () => {
  const s = { ...base, projectionId: 'satellite' };
  assert.equal(labelKey(s), labelKey({ ...s, sub: { latDeg: 10.1, lonDeg: 20.2 } }));
  assert.equal(labelKey(base), labelKey({ ...base, pan: [0.3, -0.2] }));
  assert.notEqual(labelKey(base), labelKey({ ...base, pan: [5, 0] }));
  assert.notEqual(labelKey(base), labelKey({ ...base, zoom: 2 }));
  assert.notEqual(labelKey(base), labelKey({ ...base, width: 901 }));
  assert.notEqual(labelKey(base), labelKey({ ...base, observer: null }));
});

test('labelKey changes once a satellite moves 2 degrees, not on every tick', () => {
  const sat = (lonDeg, latDeg, emphasis = 'normal') => [{ noradId: 25544, name: 'ISS', position: { lonDeg, latDeg }, emphasis }];
  const k = (sats) => labelKey({ ...base, sats });
  assert.equal(k(sat(10.2, 20.1)), k(sat(10.6, 20.4)));
  assert.notEqual(k(sat(10.2, 20.1)), k(sat(12.4, 20.1)));
  assert.notEqual(k(sat(10, 20)), k(sat(10, 20, 'ghost')));
  assert.equal(k(sat(10, 20, 'hidden')), k([]));
  assert.equal(satsKey(null), '-');
});

test('labelKey changes with the rotation, rounded to 0.5 degrees', () => {
  assert.equal(labelKey({ ...base, rotLon: 10.1 }), labelKey({ ...base, rotLon: 10.2 }));
  assert.notEqual(labelKey({ ...base, rotLon: 10 }), labelKey({ ...base, rotLon: 11 }));
  assert.notEqual(labelKey(base), labelKey({ ...base, rotLon: 30 }));
});
