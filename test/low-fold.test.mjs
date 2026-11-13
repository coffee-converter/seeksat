import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLowRows, lowFoldLabel, LOW_FOLD_DEG } from '../lib/ui/low-fold.mjs';

const NOW = 1_000_000;
const row = (key, maxElevDeg, startMs = NOW + 60_000, endMs = startMs + 300_000) => ({ key, pass: { maxElevDeg, startMs, endMs } });

test('folds passes under 5 degrees, keeping order', () => {
  const rows = [row('a', 3), row('b', 40), row('c', 4.9), row('d', 12)];
  const { shown, folded } = splitLowRows(rows, NOW);
  assert.deepEqual(shown.map((r) => r.key), ['b', 'd']);
  assert.deepEqual(folded.map((r) => r.key), ['a', 'c']);
});

test('a pass at exactly 5 degrees stays shown', () => {
  assert.equal(LOW_FOLD_DEG, 5);
  assert.equal(splitLowRows([row('a', 5)], NOW).folded.length, 0);
});

test('a pass under way is never folded', () => {
  const up = row('now', 2, NOW - 60_000, NOW + 60_000);
  const { shown, folded } = splitLowRows([up, row('later', 2)], NOW);
  assert.deepEqual(shown.map((r) => r.key), ['now']);
  assert.deepEqual(folded.map((r) => r.key), ['later']);
});

test('all low, none low, and empty', () => {
  assert.equal(splitLowRows([row('a', 1), row('b', 2)], NOW).shown.length, 0);
  assert.equal(splitLowRows([row('a', 30)], NOW).folded.length, 0);
  assert.deepEqual(splitLowRows([], NOW), { shown: [], folded: [] });
});

test('label is singular or plural', () => {
  assert.equal(lowFoldLabel(1), '1 low pass (under 5°)');
  assert.equal(lowFoldLabel(3), '3 low passes (under 5°)');
});
