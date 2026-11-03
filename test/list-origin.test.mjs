import test from 'node:test';
import assert from 'node:assert/strict';
import { markFromList, fromList, clearFromList, closeTarget, closeTargetFor } from '../lib/home/list-origin.mjs';

test('Close goes back only when the page was opened from the list', () => {
  clearFromList();
  assert.equal(fromList(), false);
  assert.equal(closeTarget(fromList()), 'home');
  markFromList();
  assert.equal(closeTarget(fromList()), 'back');
  clearFromList();
  assert.equal(fromList(), false);
});

test('closeTargetFor reads the list origin from history state', () => {
  assert.equal(closeTargetFor(null), 'home');
  assert.equal(closeTargetFor({}), 'home');
  assert.equal(closeTargetFor({ seeksatFromList: true }), 'back');
  assert.equal(closeTargetFor({ seeksatFromList: 'yes' }), 'home');
});
