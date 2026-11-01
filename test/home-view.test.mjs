import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  followedTracks, nextCardChangeMs, passTimesLabel, stepMinElev, MIN_ELEV_STEP, MIN_ELEV_MAX,
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
