import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passQuality } from '../lib/passes/quality.mjs';

test('passQuality rates by max elevation', () => {
  const level = (maxElevDeg) => passQuality({ maxElevDeg }).level;
  assert.equal(level(75), 'good');
  assert.equal(level(40), 'good');
  assert.equal(level(39.9), 'ok');
  assert.equal(level(20), 'ok');
  assert.equal(level(19.9), 'low');
  assert.equal(level(NaN), 'low');
  assert.deepEqual(passQuality({ maxElevDeg: 60 }), { level: 'good', label: 'Good', bars: 5, reason: 'High pass, well clear of the horizon.' });
  assert.deepEqual(passQuality({ maxElevDeg: 30 }), { level: 'ok', label: 'OK', bars: 3, reason: 'Medium pass.' });
  assert.deepEqual(passQuality({ maxElevDeg: 12 }), { level: 'low', label: 'Low', bars: 2, reason: 'Low pass, close to the horizon.' });
});

test('passQuality gives 1 to 5 bars by max elevation, inside its level', () => {
  const bars = (maxElevDeg) => passQuality({ maxElevDeg }).bars;
  assert.equal(bars(4), 1);
  assert.equal(bars(9.9), 1);
  assert.equal(bars(10), 2);
  assert.equal(bars(19.9), 2);
  assert.equal(bars(20), 3);
  assert.equal(bars(39.9), 3);
  assert.equal(bars(40), 4);
  assert.equal(bars(59.9), 4);
  assert.equal(bars(60), 5);
  assert.equal(bars(NaN), 1);
});
