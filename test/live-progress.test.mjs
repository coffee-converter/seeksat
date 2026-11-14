import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barStart, barPositions } from '../lib/live/progress.mjs';

test('barStart: a pass found before it rose starts at its first sample', () => {
  assert.deepEqual(barStart({ inProgress: false }, 1000), { label: 'Rise', ms: 1000 });
});

test('barStart: a pass already up uses riseMs, else Up with no time', () => {
  assert.deepEqual(barStart({ inProgress: true, riseMs: 500 }, 1000), { label: 'Rise', ms: 500 });
  assert.deepEqual(barStart({ inProgress: true, riseUnknown: true }, 1000), { label: 'Up', ms: null });
});

test('barPositions: now and peak as fractions of the pass', () => {
  const p = barPositions({ startMs: 0, peakMs: 300, endMs: 600, nowMs: 150 });
  assert.equal(p.nowFrac, 0.25);
  assert.equal(p.peakFrac, 0.5);
  assert.equal(p.peakLabelFrac, 0.5);
});

test('barPositions: now clamps to the ends before rise and after set', () => {
  assert.equal(barPositions({ startMs: 0, peakMs: 300, endMs: 600, nowMs: -50 }).nowFrac, 0);
  assert.equal(barPositions({ startMs: 0, peakMs: 300, endMs: 600, nowMs: 900 }).nowFrac, 1);
});

test('barPositions: the peak label keeps clear of the end labels', () => {
  assert.equal(barPositions({ startMs: 0, peakMs: 60, endMs: 600, nowMs: 0 }).peakLabelFrac, 0.22);
  assert.equal(barPositions({ startMs: 0, peakMs: 540, endMs: 600, nowMs: 0 }).peakLabelFrac, 0.78);
  // A peak at an end (a pass found past its peak) gets no label.
  assert.equal(barPositions({ startMs: 0, peakMs: 0, endMs: 600, nowMs: 0 }).peakLabelFrac, null);
  assert.equal(barPositions({ startMs: 0, peakMs: null, endMs: 600, nowMs: 0 }).peakFrac, null);
});

test('barPositions: a zero-length pass does not divide by zero', () => {
  const p = barPositions({ startMs: 5, peakMs: 5, endMs: 5, nowMs: 5 });
  assert.equal(p.nowFrac, 0);
});
