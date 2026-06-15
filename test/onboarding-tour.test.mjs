import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, TOUR_STEPS, shouldShowTour, markTourDone } from '../lib/onboarding/tour.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('shouldShowTour: usable storage with key unset -> true', () => {
  assert.equal(shouldShowTour(fakeStorage()), true);
});

test('shouldShowTour: key set -> false', () => {
  assert.equal(shouldShowTour(fakeStorage({ [STORAGE_KEY]: '1' })), false);
});

test('shouldShowTour: null (unusable) storage -> false', () => {
  assert.equal(shouldShowTour(null), false);
});

test('markTourDone sets the key, so shouldShowTour then returns false', () => {
  const s = fakeStorage();
  markTourDone(s);
  assert.equal(s.getItem(STORAGE_KEY), '1');
  assert.equal(shouldShowTour(s), false);
});

test('markTourDone swallows storage errors', () => {
  const throwing = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.doesNotThrow(() => markTourDone(throwing));
});

test('TOUR_STEPS: first is the unanchored welcome; all have title + description', () => {
  assert.ok(TOUR_STEPS.length >= 5);
  assert.equal(TOUR_STEPS[0].element, undefined);
  for (const s of TOUR_STEPS) {
    assert.ok(s.title && s.title.length > 0, 'title');
    assert.ok(s.description && s.description.length > 0, 'description');
    if (s.element !== undefined) {
      assert.ok(typeof s.element === 'string' && s.element.length > 0, 'element selector');
    }
  }
});
