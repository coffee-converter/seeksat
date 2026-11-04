import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridSteps, labelSteps, stepFor, viewGrid, GRID_VIEW_ZOOM, STATIC_STEP } from '../lib/map/grid.mjs';

test('globe level uses the static 30 degree grid', () => {
  const view = { zoom: GRID_VIEW_ZOOM - 0.1, west: -180, east: 180, south: -85, north: 85 };
  assert.equal(gridSteps(view), null);
  assert.deepEqual(labelSteps(view), { lat: 30, lon: 30 });
});

test('just past globe level, a near-world view is no sparser than the static grid', () => {
  // On the globe at zoom 3 the bounds still span most of the world.
  const view = { zoom: GRID_VIEW_ZOOM, west: -180, east: 180, south: -85, north: 85 };
  assert.equal(stepFor(360), 90); // what the view alone would ask for
  assert.deepEqual(gridSteps(view), { lat: STATIC_STEP, lon: STATIC_STEP });
  const meridians = viewGrid(view).data.features.filter((f) => f.properties.kind === 'meridian');
  assert.equal(meridians.length, 12);
});

test('zooming in only makes the grid finer', () => {
  let prev = STATIC_STEP;
  for (const span of [300, 160, 90, 45, 20, 8, 3, 1, 0.3]) {
    const s = gridSteps({ zoom: 5, west: 0, east: span, south: 0, north: Math.min(80, span) });
    assert.ok(s.lon <= prev, `span ${span}: ${s.lon} after ${prev}`);
    prev = s.lon;
  }
});
