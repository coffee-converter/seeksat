import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHomePath, shellClassFor } from '../lib/map/shell-route.mjs';

test('isHomePath is the home page only', () => {
  assert.equal(isHomePath('/'), true);
  assert.equal(isHomePath('/sat/25544'), false);
  assert.equal(isHomePath('/sat/25544/share/abc'), false);
});

test('shellClassFor marks satellite pages and adds the page class', () => {
  assert.equal(shellClassFor('/'), undefined);
  assert.equal(shellClassFor('/', 'home-first-visit'), 'home-first-visit');
  assert.equal(shellClassFor('/sat/25544'), 'sat');
  assert.equal(shellClassFor('/sat/25544/share/abc', null), 'sat');
  assert.equal(shellClassFor('/sat/1', 'x'), 'sat x');
});
