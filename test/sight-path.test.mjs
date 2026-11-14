import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sightPathD } from '../lib/map/sight-path.mjs';

test('a sight path joins the projected points', () => {
  assert.equal(sightPathD([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }]), 'M0.0 0.0L10.0 0.0L20.0 5.0');
});

test('the first trimPx is left off, starting inside a segment', () => {
  assert.equal(sightPathD([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 20, y: 0 }], 8), 'M8.0 0.0L20.0 0.0');
});

test('hidden points (behind the globe) break the path', () => {
  const d = sightPathD([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0, hidden: true }, { x: 12, y: 0 }, { x: 15, y: 0 }]);
  assert.equal(d, 'M0.0 0.0L5.0 0.0M12.0 0.0L15.0 0.0');
});

test('nothing to draw gives an empty path', () => {
  assert.equal(sightPathD([]), '');
  assert.equal(sightPathD([{ x: 0, y: 0 }, { x: 3, y: 0 }], 10), '');
});
