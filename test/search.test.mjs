import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWindowsFromPredicate } from '../pass-finder/search.js';

test('returns empty when predicate is always false', () => {
  const out = findWindowsFromPredicate(() => false, 0, 1_000_000, 60_000);
  assert.deepEqual(out, []);
});

test('returns single window when predicate true over a known span', () => {
  // True between t=200_000 and t=500_000 ms.
  const pred = (ms) => ms >= 200_000 && ms <= 500_000;
  const out = findWindowsFromPredicate(pred, 0, 1_000_000, 10_000);
  assert.equal(out.length, 1);
  // Bisection edges should be within ~1 second of the truth.
  assert.ok(Math.abs(out[0].startMs - 200_000) < 1500, `start=${out[0].startMs}`);
  assert.ok(Math.abs(out[0].endMs - 500_000) < 1500, `end=${out[0].endMs}`);
});

test('returns two separate windows for two non-overlapping spans', () => {
  const pred = (ms) =>
    (ms >= 100_000 && ms <= 200_000) ||
    (ms >= 600_000 && ms <= 700_000);
  const out = findWindowsFromPredicate(pred, 0, 1_000_000, 5000);
  assert.equal(out.length, 2);
});

test('handles window that starts before search range', () => {
  // True from t=-100 to t=100_000. Search starts at t=0, so the window
  // is open at the start.
  const pred = (ms) => ms <= 100_000;
  const out = findWindowsFromPredicate(pred, 0, 1_000_000, 5000);
  assert.equal(out.length, 1);
  assert.equal(out[0].startMs, 0);
  assert.ok(Math.abs(out[0].endMs - 100_000) < 1500);
});

test('handles window that ends after search range', () => {
  const pred = (ms) => ms >= 900_000;
  const out = findWindowsFromPredicate(pred, 0, 1_000_000, 5000);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].startMs - 900_000) < 1500);
  assert.equal(out[0].endMs, 1_000_000);
});
