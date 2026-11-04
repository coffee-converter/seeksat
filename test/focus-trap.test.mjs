import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFocusIndex } from '../lib/a11y/focus-trap.mjs';

test('Tab from the last control wraps to the first', () => {
  assert.equal(nextFocusIndex(3, 2, false), 0);
});
test('Shift+Tab from the first control wraps to the last', () => {
  assert.equal(nextFocusIndex(3, 0, true), 2);
});
test('focus outside the dialog enters at the first or last control', () => {
  assert.equal(nextFocusIndex(3, -1, false), 0);
  assert.equal(nextFocusIndex(3, -1, true), 2);
});
test('a dialog with no controls gives -1', () => {
  assert.equal(nextFocusIndex(0, -1, false), -1);
});
