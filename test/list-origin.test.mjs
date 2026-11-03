import test from 'node:test';
import assert from 'node:assert/strict';
import { markFromList, fromList, clearFromList, closeTarget } from '../lib/home/list-origin.mjs';

test('Close goes back only when the page was opened from the list', () => {
  clearFromList();
  assert.equal(fromList(), false);
  assert.equal(closeTarget(fromList()), 'home');
  markFromList();
  assert.equal(closeTarget(fromList()), 'back');
  clearFromList();
  assert.equal(fromList(), false);
});
