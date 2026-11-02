import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudBadge } from '../lib/sky/cloud-badge.mjs';
import { roundCoord } from '../lib/sky/round-coords.mjs';

test('cloudBadge thresholds', () => {
  assert.equal(cloudBadge(10, 0.5).level, 'clear');
  assert.equal(cloudBadge(10, 0.5).label, 'Clear');
  assert.equal(cloudBadge(50, 0.5).level, 'some');
  assert.equal(cloudBadge(50, 0.5).label, 'Some cloud');
  assert.equal(cloudBadge(90, 0.5).level, 'cloudy');
  assert.equal(cloudBadge(90, 0.5).label, 'Cloudy');
});

test('cloudBadge appends (forecast) from 3 days out', () => {
  assert.match(cloudBadge(10, 4).label, / \(forecast\)$/);
  assert.doesNotMatch(cloudBadge(10, 2.9).label, /forecast/);
});

test('cloudBadge is null without data or beyond 7 days', () => {
  assert.equal(cloudBadge(null, 1), null);
  assert.equal(cloudBadge(undefined, 1), null);
  assert.equal(cloudBadge(10, 8), null);
});

test('cloudBadge title gives percent and age', () => {
  assert.equal(cloudBadge(42.4, 0.5).title, '42% cloud forecast, today');
  assert.equal(cloudBadge(42.4, 2).title, '42% cloud forecast, 2 days ahead');
});

test('roundCoord rounds to 1 decimal', () => {
  assert.equal(roundCoord(41.8781), 41.9);
  assert.equal(roundCoord(-87.6298), -87.6);
});
