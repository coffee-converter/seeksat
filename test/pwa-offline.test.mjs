import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineText } from '../lib/pwa/offline.mjs';

test('the offline banner mentions saved satellites only when they are showing', () => {
  assert.equal(offlineText(false), "You're offline.");
  assert.equal(offlineText(true), "You're offline. Showing the last saved satellites.");
});

// The banner rides out a flapping connection (a router coming back fires
// online and offline several times) instead of flashing with each change.
import { offlineStart, offlineStep, offlineView, offlineNextMs, OFFLINE_SHOW_MS, ONLINE_STABLE_MS, BACK_ONLINE_MS } from '../lib/pwa/offline.mjs';

test('a page loaded offline shows the banner at once', () => {
  assert.equal(offlineView(offlineStart(false, 0), 0), 'offline');
  assert.equal(offlineView(offlineStart(true, 0), 0), 'hidden');
});

test('an offline blip shorter than the show delay never shows the banner', () => {
  let s = offlineStep(offlineStart(true, 0), false, 1000);
  assert.equal(offlineView(s, 1000 + OFFLINE_SHOW_MS - 1), 'hidden');
  s = offlineStep(s, true, 1000 + OFFLINE_SHOW_MS - 1);
  assert.equal(offlineView(s, 1000 + OFFLINE_SHOW_MS + 10_000), 'hidden');
});

test('once shown, flapping keeps the banner up until the connection holds, then says back online', () => {
  let s = offlineStep(offlineStart(true, 0), false, 0);
  assert.equal(offlineView(s, OFFLINE_SHOW_MS), 'offline');
  let t = 60_000;
  for (let i = 0; i < 4; i++) { // up 1 s, down 1 s, four times
    s = offlineStep(s, true, t); assert.equal(offlineView(s, t + 500), 'offline');
    s = offlineStep(s, false, t + 1000); assert.equal(offlineView(s, t + 1500), 'offline');
    t += 2000;
  }
  s = offlineStep(s, true, t);
  assert.equal(offlineView(s, t + ONLINE_STABLE_MS - 1), 'offline');
  assert.equal(offlineView(s, t + ONLINE_STABLE_MS), 'back');
  assert.equal(offlineView(s, t + ONLINE_STABLE_MS + BACK_ONLINE_MS), 'hidden');
});

test('going offline again while it says back online shows offline at once', () => {
  let s = offlineStep(offlineStart(false, 0), true, 0);
  s = offlineStep(s, false, ONLINE_STABLE_MS + 100);
  assert.equal(offlineView(s, ONLINE_STABLE_MS + 100), 'offline');
});

test('offlineNextMs is the next time the view can change, or null', () => {
  const s = offlineStep(offlineStart(false, 0), true, 1000);
  assert.equal(offlineNextMs(s, 1000), 1000 + ONLINE_STABLE_MS);
  assert.equal(offlineNextMs(s, 1000 + ONLINE_STABLE_MS), 1000 + ONLINE_STABLE_MS + BACK_ONLINE_MS);
  assert.equal(offlineNextMs(s, 1000 + ONLINE_STABLE_MS + BACK_ONLINE_MS), null);
  assert.equal(offlineNextMs(offlineStep(offlineStart(true, 0), false, 0), 0), OFFLINE_SHOW_MS);
});
