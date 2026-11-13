import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptScrollTop, toggleOpen } from '../lib/ui/open-row.mjs';

test('toggleOpen: one row open at a time', () => {
  assert.equal(toggleOpen(null, 'a'), 'a');
  assert.equal(toggleOpen('a', 'b'), 'b');
  assert.equal(toggleOpen('b', 'b'), null);
});

test('keptScrollTop: a row that rose by the closed height scrolls back by it', () => {
  // A 300 px row above closed: the tapped row moved from 500 to 200 on screen.
  assert.equal(keptScrollTop({ beforeTop: 500, afterTop: 200, scrollTop: 900, maxScrollTop: 2000 }), 600);
});

test('keptScrollTop: nothing moved, nothing scrolls', () => {
  assert.equal(keptScrollTop({ beforeTop: 120, afterTop: 120, scrollTop: 400, maxScrollTop: 2000 }), 400);
});

test('keptScrollTop: stays within the scroller', () => {
  assert.equal(keptScrollTop({ beforeTop: 500, afterTop: 100, scrollTop: 250, maxScrollTop: 2000 }), 0);
  assert.equal(keptScrollTop({ beforeTop: 100, afterTop: 500, scrollTop: 900, maxScrollTop: 1000 }), 1000);
  assert.equal(keptScrollTop({ beforeTop: 100, afterTop: 500, scrollTop: 0, maxScrollTop: -5 }), 0);
});
