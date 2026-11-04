import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  followedTracks, nextCardChangeMs, shouldRefreshCards, passTimesLabel, passMetaLabel, elementTags, savedAgeText, savedAgeNotice, stepMinElev,
  MIN_ELEV_STEP, MIN_ELEV_MAX,
} from '../lib/home/view.mjs';

test('followedTracks keeps following order and drops ids with no track', () => {
  const tracks = new Map([[1, 'a'], [2, 'b'], [3, 'c']]);
  const out = followedTracks(tracks, [3, 9, 1]);
  assert.deepEqual([...out.entries()], [[3, 'c'], [1, 'a']]);
});

test('stepMinElev moves in 5° steps within 0 to 45', () => {
  assert.equal(MIN_ELEV_STEP, 5);
  assert.equal(MIN_ELEV_MAX, 45);
  assert.equal(stepMinElev(10, 1), 15);
  assert.equal(stepMinElev(10, -1), 5);
  assert.equal(stepMinElev(0, -1), 0);
  assert.equal(stepMinElev(45, 1), 45);
});

test('stepMinElev snaps an off-step value to the next step in that direction', () => {
  assert.equal(stepMinElev(12, 1), 15);
  assert.equal(stepMinElev(12, -1), 10);
});

test('nextCardChangeMs is the earliest start of an upcoming pass or end of a pass in progress', () => {
  const cards = [
    { kind: 'pass', pass: { startMs: 500, endMs: 900, inProgress: false } },
    { kind: 'pass', pass: { startMs: 100, endMs: 300, inProgress: true } },
    { kind: 'none' },
  ];
  assert.equal(nextCardChangeMs(cards), 300);
  assert.equal(nextCardChangeMs([{ kind: 'pass', pass: { startMs: 500, endMs: 900, inProgress: false } }]), 500);
  assert.equal(nextCardChangeMs([{ kind: 'stationary' }]), Infinity);
});

const fmt = { locale: 'en-GB', timeZone: 'UTC' };

test('passTimesLabel: a pass later today shows times only', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  const label = passTimesLabel(Date.parse('2026-11-01T14:02:00Z'), Date.parse('2026-11-01T14:12:00Z'), now, fmt);
  assert.equal(label, '14:02–14:12');
});

test('passTimesLabel: a pass on another day leads with the weekday', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  const label = passTimesLabel(Date.parse('2026-11-02T14:02:00Z'), Date.parse('2026-11-02T14:12:00Z'), now, fmt);
  assert.equal(label, 'Mon 14:02–14:12');
});

test('passTimesLabel: a pass over midnight names the end day', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  const label = passTimesLabel(Date.parse('2026-11-01T23:55:00Z'), Date.parse('2026-11-02T00:05:00Z'), now, fmt);
  assert.equal(label, '23:55–Mon 00:05');
});

test('passMetaLabel: an upcoming pass shows its times and duration', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  const pass = {
    startMs: Date.parse('2026-11-01T14:02:00Z'), endMs: Date.parse('2026-11-01T14:12:00Z'),
    durationMs: 600_000, inProgress: false,
  };
  assert.equal(passMetaLabel(pass, now, fmt), '14:02–14:12 · 10m00s');
});

test('passMetaLabel: a pass in progress shows when it sets, not a rise time', () => {
  const now = Date.parse('2026-11-01T14:05:00Z');
  // The engine clamps an in-progress pass to start now.
  const pass = { startMs: now, endMs: Date.parse('2026-11-01T14:12:30Z'), durationMs: 450_000, inProgress: true };
  assert.equal(passMetaLabel(pass, now, fmt), 'Up now, until 14:12 (7 min left)');
});

test('elementTags flags pasted elements and elements older than a week', () => {
  assert.deepEqual(elementTags({ record: { source: 'pasted' } }), ['pasted']);
  assert.deepEqual(elementTags({ record: { tleAgeHours: 168 } }), []);
  assert.deepEqual(elementTags({ record: { tleAgeHours: 169 } }), ['elements 7 days old']);
  assert.deepEqual(elementTags({ record: { tleAgeHours: 24 * 30 + 5 } }), ['elements 30 days old']);
  assert.deepEqual(elementTags({ record: { tleAgeHours: null } }), []);
  assert.deepEqual(elementTags({ record: {} }), []);
});

test('elementTags ages elements from their epoch on the live clock, so a cached record cannot look fresh', () => {
  const now = Date.UTC(2026, 10, 1);
  const day = 86_400_000;
  // The server said 1 day old when it answered, but that answer is 9 days old now.
  assert.deepEqual(elementTags({ epochMs: now - 10 * day, record: { tleAgeHours: 24 } }, now), ['elements 10 days old']);
  assert.deepEqual(elementTags({ epochMs: now - 6 * day, record: { tleAgeHours: 24 * 30 } }, now), []);
  // Without an epoch or a clock it falls back to the server's figure.
  assert.deepEqual(elementTags({ record: { tleAgeHours: 24 * 8 } }, now), ['elements 8 days old']);
  assert.deepEqual(elementTags({ epochMs: now - 10 * day, record: { tleAgeHours: 24 } }), []);
});

test('shouldRefreshCards: in flight never, stale yes, backoff holds', () => {
  const cards = [{ kind: 'pass', pass: { startMs: 5000, endMs: 9000, inProgress: false } }];
  const cardState = { cards, at: 1000 };
  const base = { cardState, inFlight: false, retryAtMs: null, refreshMs: 600 };
  assert.equal(shouldRefreshCards({ ...base, nowMs: 1100 }), false);
  assert.equal(shouldRefreshCards({ ...base, nowMs: 1600 }), true);
  assert.equal(shouldRefreshCards({ ...base, nowMs: 5000, refreshMs: 1e9 }), true);
  assert.equal(shouldRefreshCards({ ...base, nowMs: 1600, inFlight: true }), false);
  assert.equal(shouldRefreshCards({ ...base, nowMs: 1600, retryAtMs: 2000 }), false);
  assert.equal(shouldRefreshCards({ ...base, nowMs: 2000, retryAtMs: 2000 }), true);
  assert.equal(shouldRefreshCards({ ...base, cardState: null, nowMs: 2000 }), false);
  assert.equal(shouldRefreshCards({ ...base, cardState: null, nowMs: 1999, retryAtMs: 2000 }), false);
  assert.equal(shouldRefreshCards({ ...base, cardState: null, nowMs: 2000, retryAtMs: 2000 }), true);
});

test('savedAgeText says how long ago satellites were saved, in plain units', () => {
  const now = Date.UTC(2026, 10, 1, 12);
  const min = 60_000;
  assert.equal(savedAgeText(now - 20_000, now), 'less than a minute');
  assert.equal(savedAgeText(now - min, now), '1 min');
  assert.equal(savedAgeText(now - 12 * min, now), '12 min');
  assert.equal(savedAgeText(now - 59 * min, now), '59 min');
  assert.equal(savedAgeText(now - 60 * min, now), '1 h');
  assert.equal(savedAgeText(now - 3 * 60 * min - 5 * min, now), '3 h');
  assert.equal(savedAgeText(now - 24 * 60 * min, now), '1 day');
  assert.equal(savedAgeText(now - 2 * 24 * 60 * min - 7 * 60 * min, now), '2 days');
  // A clock behind the save time never reads as a negative age.
  assert.equal(savedAgeText(now + 5 * min, now), 'less than a minute');
  assert.equal(savedAgeText(null, now), null);
  assert.equal(savedAgeText(Number.NaN, now), null);
});

test('savedAgeNotice says how old the saved satellite data is', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const min = 60_000;
  assert.equal(savedAgeNotice(now - 12 * min, now), 'Satellite data is 12 min old.');
  assert.equal(savedAgeNotice(now - 20_000, now), 'Satellite data is less than a minute old.');
  assert.equal(savedAgeNotice(now - 2 * 24 * 60 * min, now), 'Satellite data is 2 days old.');
  assert.equal(savedAgeNotice(null, now), null);
});
