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
  assert.deepEqual(passQuality({ maxElevDeg: 60 }), { level: 'good', label: 'Good', reason: 'High pass, well clear of the horizon.' });
  assert.deepEqual(passQuality({ maxElevDeg: 30 }), { level: 'ok', label: 'OK', reason: 'Medium pass.' });
  assert.deepEqual(passQuality({ maxElevDeg: 12 }), { level: 'low', label: 'Low', reason: 'Low pass, close to the horizon.' });
});
