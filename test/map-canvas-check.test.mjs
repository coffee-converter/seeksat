import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasMismatch } from '../lib/map/canvas-check.mjs';

const ok = { boxW: 393, boxH: 262, cssW: 393, cssH: 262, bufW: 1179, bufH: 786, drawW: 1179, drawH: 786 };

test('a canvas the size and shape of its box passes', () => {
  assert.equal(canvasMismatch(ok), null);
  assert.equal(canvasMismatch({ ...ok, cssH: 263.5 }), null, 'within 2 px and 2%');
  assert.equal(canvasMismatch({ ...ok, drawW: null, drawH: null }), null);
});

test('hidden or not yet drawn is not a mismatch', () => {
  assert.equal(canvasMismatch({ ...ok, boxH: 0 }), null);
  assert.equal(canvasMismatch({ ...ok, bufW: undefined }), null);
});

test('a canvas left at the old box size is caught', () => {
  const m = canvasMismatch({ ...ok, cssH: 393, bufH: 1179, drawH: 1179 });
  assert.match(m, /^Map canvas size:/);
  assert.match(m, /box 393x262, shown 393x393, pixels 1179x1179, drawn 1179x1179/);
});

test('pixels stretched to a different shape are caught', () => {
  assert.match(canvasMismatch({ ...ok, bufH: 1179, drawH: 1179 }), /^Map canvas aspect:/);
});

test('a drawing buffer clamped to another shape is caught', () => {
  assert.match(canvasMismatch({ ...ok, drawH: 600 }), /^Map canvas buffer:/);
  assert.equal(canvasMismatch({ ...ok, drawW: 590, drawH: 393 }), null, 'scaled down evenly is fine');
});
