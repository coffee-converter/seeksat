import test from 'node:test';
import assert from 'node:assert/strict';
import { markFromList, fromList, clearFromList, closeTargetFor } from '../lib/home/list-origin.mjs';

test('the list origin flag is set and cleared', () => {
  clearFromList();
  assert.equal(fromList(), false);
  markFromList();
  assert.equal(fromList(), true);
  clearFromList();
  assert.equal(fromList(), false);
});

test('closeTargetFor reads the list origin from history state', () => {
  assert.equal(closeTargetFor(null), 'home');
  assert.equal(closeTargetFor({}), 'home');
  assert.equal(closeTargetFor({ seeksatFromList: true }), 'back');
  assert.equal(closeTargetFor({ seeksatFromList: 'yes' }), 'home');
});
