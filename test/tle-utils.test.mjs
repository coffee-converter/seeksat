import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleHasContent, pickTleLines } from '../lib/tle-utils.ts';

// ---- tleHasContent -------------------------------------------------------

test('tleHasContent: empty Tle returns false', () => {
  assert.equal(tleHasContent({ name: '', line1: '', line2: '' }), false);
});

test('tleHasContent: whitespace-only fields return false', () => {
  assert.equal(
    tleHasContent({ name: '   ', line1: '\n', line2: '\t  ' }),
    false,
  );
});

test('tleHasContent: any non-empty field returns true', () => {
  assert.equal(tleHasContent({ name: 'ISS', line1: '', line2: '' }), true);
  assert.equal(tleHasContent({ name: '', line1: '1 …', line2: '' }), true);
  assert.equal(tleHasContent({ name: '', line1: '', line2: '2 …' }), true);
});

// ---- pickTleLines: handles either 3-line (name + l1 + l2) or 2-line --------

test('pickTleLines: returns null when neither line starts with "1 " / "2 "', () => {
  assert.equal(pickTleLines({ name: '', line1: '', line2: '' }), null);
  assert.equal(
    pickTleLines({ name: 'ISS', line1: 'junk', line2: 'more junk' }),
    null,
  );
});

test('pickTleLines: 3-line form (name + line1 + line2)', () => {
  const tle = {
    name: 'ISS (ZARYA)',
    line1: '1 25544U 98067A   24001.50000000  .00012000  00000-0  22000-3 0  9991',
    line2: '2 25544  51.6400 100.0000 0001234 100.0000 200.0000 15.49000000000005',
  };
  const out = pickTleLines(tle);
  assert.deepEqual(out, [tle.line1, tle.line2]);
});

test('pickTleLines: 2-line form (lines pasted into name + line1, line2 empty)', () => {
  // User paste-edge case: TLE without a name line gets pasted into the
  // first two textareas. pickTleLines should recognize that shape too.
  const tle = {
    name: '1 25544U 98067A   24001.50000000  .00012000  00000-0  22000-3 0  9991',
    line1: '2 25544  51.6400 100.0000 0001234 100.0000 200.0000 15.49000000000005',
    line2: '',
  };
  const out = pickTleLines(tle);
  assert.deepEqual(out, [tle.name, tle.line1]);
});

test('pickTleLines: trims whitespace before pattern check', () => {
  // Lines pasted from a terminal often carry trailing CR/LF and
  // sometimes leading spaces; the trim must run BEFORE the "1 " /
  // "2 " prefix check.
  const tle = {
    name: '',
    line1: '   1 25544U 98067A …\n',
    line2: '\r\n  2 25544 …\r\n',
  };
  const out = pickTleLines(tle);
  assert.equal(out?.[0], '1 25544U 98067A …');
  assert.equal(out?.[1], '2 25544 …');
});

test('pickTleLines: 3-line form is preferred when both shapes could match', () => {
  // Edge case: name field carries "1 …" while line1 also has "1 …".
  // (E.g. the user typed both.) The function should prefer the
  // canonical (line1/line2) match if both shapes are valid.
  const tle = {
    name: '1 wrong',
    line1: '1 25544U …',
    line2: '2 25544 …',
  };
  const out = pickTleLines(tle);
  // Canonical shape: line1 starts with "1 " and line2 starts with
  // "2 " — that branch wins because it's tested first.
  assert.deepEqual(out, [tle.line1, tle.line2]);
});

test('pickTleLines: returns null if line2 is missing the "2 " prefix in 3-line form', () => {
  // Defensive — corrupted data shouldn't accidentally match the
  // 2-line shape (which would feed garbage to SGP4).
  const tle = {
    name: 'ISS',
    line1: '1 25544U …',
    line2: 'oops',
  };
  assert.equal(pickTleLines(tle), null);
});
