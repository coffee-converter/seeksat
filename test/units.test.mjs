import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnits, distanceText, speedIn, lengthIn } from '../lib/units.mjs';

test('auto follows the device region: miles in the US, Liberia and Myanmar', () => {
  assert.equal(resolveUnits('auto', 'en-US'), 'imperial');
  assert.equal(resolveUnits('auto', 'en-GB'), 'metric');
  assert.equal(resolveUnits('auto', 'es-AR'), 'metric');
  assert.equal(resolveUnits('auto', 'my-MM'), 'imperial');
  assert.equal(resolveUnits('auto', undefined), 'metric');
  assert.equal(resolveUnits('metric', 'en-US'), 'metric');
  assert.equal(resolveUnits('imperial', 'de-DE'), 'imperial');
});

test('distances and speeds convert and format', () => {
  assert.equal(distanceText(1578.2, 'metric'), '1,578 km');
  assert.equal(distanceText(1609.344, 'imperial'), '1,000 mi');
  assert.equal(distanceText(421.44, 'metric', 1), '421.4 km');
  assert.equal(distanceText(NaN, 'metric'), '');
  assert.deepEqual(lengthIn(16.09344, 'imperial'), { value: 10.000000000000002 > 10 ? 16.09344 / 1.609344 : 10, unit: 'mi' });
  const s = speedIn(7.66, 'imperial');
  assert.equal(s.unit, 'mi/s');
  assert.ok(Math.abs(s.value - 4.76) < 0.01);
});
