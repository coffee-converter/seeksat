import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADIO_WORDS, downlinkHasWord } from '../lib/radio/modes.mjs';

test('downlinkHasWord matches the mode, or a whole word of the label', () => {
  assert.equal(downlinkHasWord({ mode: 'fm', label: 'Repeater' }, 'fm'), true);
  assert.equal(downlinkHasWord({ mode: 'sstv', label: 'Voice / SSTV' }, 'voice'), true);
  assert.equal(downlinkHasWord({ mode: 'gmsk', label: 'GMSK 9k6 telemetry' }, 'TELEMETRY'), true);
  // Part of a word is not the word.
  assert.equal(downlinkHasWord({ mode: 'afsk', label: 'AFSK beacon' }, 'fsk'), false);
  assert.equal(downlinkHasWord({ mode: null, label: null }, 'cw'), false);
  assert.equal(downlinkHasWord(null, 'cw'), false);
});

test('RADIO_WORDS are lower case and unique', () => {
  assert.equal(new Set(RADIO_WORDS).size, RADIO_WORDS.length);
  for (const w of RADIO_WORDS) assert.equal(w, w.toLowerCase());
});
