import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, slug } from '../lib/pass-finder/text.js';

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
