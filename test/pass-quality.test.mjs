import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passQuality, rangeBarsOff, radioQuality, radioBars } from '../lib/passes/quality.mjs';

test('passQuality rates by max elevation', () => {
  const level = (maxElevDeg) => passQuality({ maxElevDeg }).level;
  assert.equal(level(75), 'good');
  assert.equal(level(40), 'good');
  assert.equal(level(39.9), 'ok');
  assert.equal(level(20), 'ok');
  assert.equal(level(19.9), 'low');
  assert.equal(level(NaN), 'low');
  assert.deepEqual(passQuality({ maxElevDeg: 60 }), { level: 'good', label: 'Excellent', bars: 5, reason: 'High pass, well clear of the horizon.' });
  assert.deepEqual(passQuality({ maxElevDeg: 30 }), { level: 'ok', label: 'Good', bars: 3, reason: 'Medium pass.' });
  assert.deepEqual(passQuality({ maxElevDeg: 12 }), { level: 'low', label: 'Fair', bars: 2, reason: 'Low pass, close to the horizon.' });
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

test('each bar count has its own word', () => {
  const word = (maxElevDeg) => passQuality({ maxElevDeg }).label;
  assert.deepEqual([5, 15, 30, 50, 70].map(word), ['Poor', 'Fair', 'Good', 'Great', 'Excellent']);
});

test('range under 2,000 km costs no bars', () => {
  assert.equal(rangeBarsOff(400), 0);
  assert.equal(rangeBarsOff(2500), 0);
  assert.equal(rangeBarsOff(null), 0);
  assert.equal(rangeBarsOff(NaN), 0);
});

test('one bar off per full 6 dB beyond 2,000 km', () => {
  assert.equal(rangeBarsOff(4000), 1); // 6.02 dB
  assert.equal(rangeBarsOff(8000), 2); // 12.04 dB
  assert.equal(rangeBarsOff(3900), 0); // 5.8 dB
});

test('a far pass at 89 degrees rates below a near one', () => {
  assert.equal(radioQuality({ maxElevDeg: 89 }, 600).bars, 5);
  assert.deepEqual(radioQuality({ maxElevDeg: 89 }, 600), passQuality({ maxElevDeg: 89 }));
  const far = radioQuality({ maxElevDeg: 89 }, 8000);
  assert.equal(far.bars, 3);
  assert.equal(far.label, 'Good');
  assert.equal(far.level, 'ok');
  assert.match(far.reason, /8,000 km away, about 12 dB weaker than at 2,000 km\./);
});

test('range never takes a pass below one bar', () => {
  assert.equal(radioQuality({ maxElevDeg: 12 }, 40000).bars, 1);
  assert.equal(radioBars(12, 40000), 1);
  assert.equal(radioBars(89, null), 5);
});
