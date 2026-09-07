import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TX_OSC_PPM, txOscTolerance } from '../lib/pass-finder/radio-format.js';
import { wrapText, slug } from '../lib/pass-finder/text.js';

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

// ---- wrapText -----------------------------------------------------------

test('wrapText fills to the budget rather than breaking early', () => {
  assert.deepEqual(wrapText('aaa bbb ccc ddd', 7), ['aaa bbb', 'ccc ddd']);
});

test('wrapText never splits a word, even one over budget', () => {
  const out = wrapText('short supercalifragilistic end', 8);
  assert.ok(out.includes('supercalifragilistic'),
    'an over-long word must survive intact rather than be truncated');
});

test('wrapText collapses runs of whitespace', () => {
  assert.deepEqual(wrapText('a   b\n\nc', 80), ['a b c']);
});

test('wrapText returns nothing for empty input', () => {
  assert.deepEqual(wrapText('', 40), []);
  assert.deepEqual(wrapText('   ', 40), []);
});


// ---- slug ---------------------------------------------------------------

test('slug lowercases and collapses non-alphanumerics to single hyphens', () => {
  assert.equal(slug('ISS (ZARYA)'), 'iss-zarya');
  assert.equal(slug('My Location'), 'my-location');
  assert.equal(slug('NOAA-19'), 'noaa-19');
});

test('slug leaves no leading or trailing hyphen', () => {
  assert.equal(slug('  Kennedy Space Center!  '), 'kennedy-space-center');
  assert.equal(slug('---x---'), 'x');
});

test('slug falls back when nothing survives', () => {
  // Exists so a filename cannot come out as "radio--2026-09-07...".
  for (const empty of ['', '   ', '!!!', null, undefined]) {
    assert.equal(slug(empty, 'sat'), 'sat', `expected fallback for ${empty}`);
  }
});
