import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineText } from '../lib/pwa/offline.mjs';

test('the offline banner mentions saved satellites only when they are showing', () => {
  assert.equal(offlineText(false), "You're offline.");
  assert.equal(offlineText(true), "You're offline. Showing the last saved satellites.");
});
