import test from 'node:test';
import assert from 'node:assert/strict';
import { RATING_WORDS, ratingWords } from '../lib/passes/rating-words.mjs';

test('each mode has its own plain sentences, no em dashes', () => {
  assert.equal(ratingWords('visual'), RATING_WORDS.visual);
  assert.equal(ratingWords('radio'), RATING_WORDS.radio);
  assert.notEqual(RATING_WORDS.visual, RATING_WORDS.radio);
  for (const s of Object.values(RATING_WORDS)) assert.ok(!/—|–/.test(s));
});

test('the sentences name only what the rating code reads', () => {
  assert.match(RATING_WORDS.visual, /bright/);
  assert.match(RATING_WORDS.visual, /cloud/);
  assert.match(RATING_WORDS.radio, /high/);
  // Radio never looks at duration or the sky.
  assert.doesNotMatch(RATING_WORDS.radio, /cloud|dark|bright/);
});
