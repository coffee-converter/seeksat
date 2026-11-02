import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyUpNowText } from '../lib/sky/up-now-line.mjs';

test('emptyUpNowText without a next pass', () => {
  assert.equal(emptyUpNowText(null), 'Nothing you follow is up right now.');
});

test('emptyUpNowText names the next pass', () => {
  assert.equal(
    emptyUpNowText({ text: 'ISS in 4h 12m, max 37°' }),
    'Nothing you follow is up right now. Next: ISS in 4h 12m, max 37°.',
  );
});

test('emptyUpNowText does not double a full stop', () => {
  assert.ok(emptyUpNowText({ text: 'ISS now.' }).endsWith('ISS now.'));
  assert.ok(!emptyUpNowText({ text: 'ISS now.' }).endsWith('..'));
});
