import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TX_OSC_PPM, txOscTolerance } from '../lib/pass-finder/radio-format.js';

// ---- txOscTolerance -----------------------------------------------------

test('the tolerance scales with the carrier', () => {
  // The whole reason this is computed rather than written down: a hardcoded
  // UHF figure was three times too pessimistic on 2 m.
  assert.equal(txOscTolerance(437.8e6), '1.09 kHz');
  assert.equal(txOscTolerance(145.8e6), '365 Hz');
  assert.equal(txOscTolerance(137.1e6), '343 Hz');
});

test('the tolerance switches units at 1 kHz, not at a round frequency', () => {
  // 400 MHz * 2.5 ppm = exactly 1000 Hz.
  assert.equal(txOscTolerance(400e6), '1.00 kHz');
  assert.equal(txOscTolerance(399e6), '998 Hz');
});

test('the tolerance is null without a usable frequency', () => {
  for (const bad of [null, undefined, 0, NaN, Infinity]) {
    assert.equal(txOscTolerance(bad), null, `expected null for ${bad}`);
  }
});

test('the tolerance carries no sign prefix, so callers pick their charset', () => {
  // The CSV is ASCII ("+/-"), the chart uses "±". Baking either in here
  // would force one of them to strip it back out.
  const t = txOscTolerance(437.8e6);
  assert.ok(!t.includes('+'), t);
  assert.ok(!t.includes('±'), t);
});

test('the assumed ppm figure is exported so both consumers can state it', () => {
  assert.equal(TX_OSC_PPM, 2.5);
});
