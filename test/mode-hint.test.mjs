import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE_HINT_KEY, dismissModeHint, modeHintWanted } from '../lib/home/mode-hint.mjs';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the hint shows until dismissed, then never again', () => {
  const s = memory();
  assert.equal(modeHintWanted(s), true);
  dismissModeHint(s);
  assert.equal(s.getItem(MODE_HINT_KEY), '1');
  assert.equal(modeHintWanted(s), false);
});

test('blocked storage hides the hint and never throws', () => {
  assert.equal(modeHintWanted(broken), false);
  assert.doesNotThrow(() => dismissModeHint(broken));
});
