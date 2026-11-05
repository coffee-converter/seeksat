import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { FIRST_VISIT_SCRIPT } from '../lib/home/first-visit.mjs';
import { PREFS_KEY } from '../lib/home/prefs.mjs';
import { LS_STATE_KEY } from '../lib/pass-finder/state-blob.js';

function run(path, items, { throws = false } = {}) {
  const dataset = {};
  const localStorage = { getItem: (k) => { if (throws) throw new Error('blocked'); return items[k] ?? null; } };
  vm.runInNewContext(FIRST_VISIT_SCRIPT, { location: { pathname: path }, localStorage, document: { documentElement: { dataset } }, JSON });
  return dataset.firstVisit === '1';
}

test('nothing saved on the home page is a first visit', () => {
  assert.equal(run('/', {}), true);
  assert.equal(run('/', { [PREFS_KEY]: JSON.stringify({ location: null, following: [] }) }), true);
});

test('a saved location, or classic state to bring over, is not', () => {
  assert.equal(run('/', { [PREFS_KEY]: JSON.stringify({ location: { latDeg: 1, lonDeg: 2 } }) }), false);
  assert.equal(run('/', { [LS_STATE_KEY]: 'x' }), false);
});

test('other pages, unreadable prefs and blocked storage are not marked', () => {
  assert.equal(run('/sat/25544', {}), false);
  assert.equal(run('/', { [PREFS_KEY]: '{bad' }), false);
  assert.equal(run('/', {}, { throws: true }), false);
});
