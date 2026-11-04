import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sharedSettings, effectiveSettings, findSharedRow, sharedBannerText,
} from '../lib/sat/shared-view.mjs';

const MIN = 60_000;
const decoded = (over = {}) => ({
  noradId: 25544,
  observers: [
    { name: 'Chicago', latDeg: 41.88, lonDeg: -87.63 },
    { name: 'Denver', latDeg: 39.74, lonDeg: -104.99 },
    { name: 'Austin', latDeg: 30.27, lonDeg: -97.74 },
    { name: 'Boston', latDeg: 42.36, lonDeg: -71.06 },
    { name: 'Miami', latDeg: 25.76, lonDeg: -80.19 },
  ],
  passTimeMs: Date.parse('2026-11-01T20:15:00Z'),
  mode: 'radio',
  downlinkHz: 145_800_000,
  minElevDeg: 15,
  ...over,
});

test('sharedSettings: first observer is the home place, at most 3 others with obs-<n> ids', () => {
  const s = sharedSettings(decoded());
  assert.deepEqual(s.observer, { name: 'Chicago', latDeg: 41.88, lonDeg: -87.63 });
  assert.deepEqual(s.observers, [
    { id: 'obs-1', name: 'Denver', latDeg: 39.74, lonDeg: -104.99 },
    { id: 'obs-2', name: 'Austin', latDeg: 30.27, lonDeg: -97.74 },
    { id: 'obs-3', name: 'Boston', latDeg: 42.36, lonDeg: -71.06 },
  ]);
  assert.equal(s.mode, 'radio');
  assert.equal(s.minElevDeg, 15);
  assert.equal(s.passTimeMs, Date.parse('2026-11-01T20:15:00Z'));
  assert.equal(s.freqHz, 145_800_000);
});

test('sharedSettings: a single observer has no others; missing values are null', () => {
  const s = sharedSettings(decoded({
    observers: [{ name: 'Chicago', latDeg: 41.88, lonDeg: -87.63 }],
    passTimeMs: null, mode: 'visual', downlinkHz: null,
  }));
  assert.deepEqual(s.observers, []);
  assert.equal(s.passTimeMs, null);
  assert.equal(s.freqHz, null);
  assert.equal(s.mode, 'visual');
});

test('sharedSettings: null without observers or without a blob', () => {
  assert.equal(sharedSettings(decoded({ observers: [] })), null);
  assert.equal(sharedSettings(null), null);
  assert.equal(sharedSettings(undefined), null);
});

const prefs = () => ({
  location: { name: 'Home', latDeg: 10, lonDeg: 20 },
  observers: [{ id: 'a', name: 'Work', latDeg: 11, lonDeg: 21 }],
  mode: 'visual',
  minElevDeg: 10,
  following: [25544],
  custom: [],
  projection: 'equirect',
});

test('effectiveSettings: without a shared view it returns the prefs, untouched', () => {
  const p = prefs();
  const before = structuredClone(p);
  const e = effectiveSettings(p, null);
  assert.equal(e.observer, p.location);
  assert.equal(e.observers, p.observers);
  assert.equal(e.mode, 'visual');
  assert.equal(e.minElevDeg, 10);
  assert.equal(e.isShared, false);
  assert.deepEqual(p, before);
});

test('effectiveSettings: a shared view wins and leaves prefs untouched', () => {
  const p = prefs();
  const before = structuredClone(p);
  const s = sharedSettings(decoded());
  const e = effectiveSettings(p, s);
  assert.equal(e.observer, s.observer);
  assert.equal(e.observers, s.observers);
  assert.equal(e.mode, 'radio');
  assert.equal(e.minElevDeg, 15);
  assert.equal(e.isShared, true);
  assert.deepEqual(p, before);
});

const row = (startIso, minutes, extra = {}) => {
  const startMs = Date.parse(startIso);
  return { key: String(startMs), inProgress: false, pass: { startMs, endMs: startMs + minutes * MIN }, ...extra };
};
const UTC = { timeZone: 'UTC', locale: 'en-GB' };

test('findSharedRow: the row whose pass contains the shared time', () => {
  const rows = [row('2026-11-01T18:00:00Z', 8), row('2026-11-01T20:10:00Z', 10), row('2026-11-01T21:45:00Z', 6)];
  const t = Date.parse('2026-11-01T20:15:00Z');
  assert.deepEqual(findSharedRow(rows, t, Date.parse('2026-11-01T12:00:00Z'), UTC), { kind: 'row', key: rows[1].key });
  // Pass edges count.
  assert.deepEqual(findSharedRow(rows, rows[2].pass.startMs, 0, UTC), { kind: 'row', key: rows[2].key });
  assert.deepEqual(findSharedRow(rows, rows[0].pass.endMs, 0, UTC), { kind: 'row', key: rows[0].key });
});

test('findSharedRow: a pass already up matches the shared start before its clamped start', () => {
  // The engine clamps an in-progress pass's start to the search time, so the
  // sender's start time sits a little before the row's start.
  const now = Date.parse('2026-11-01T20:14:00Z');
  const rows = [row('2026-11-01T20:13:30Z', 6, { inProgress: true }), row('2026-11-01T21:45:00Z', 6)];
  const t = Date.parse('2026-11-01T20:09:00Z');
  assert.deepEqual(findSharedRow(rows, t, now, UTC), { kind: 'row', key: rows[0].key });
});

test('findSharedRow: a past pass that is no longer listed gives the past text', () => {
  const rows = [row('2026-11-02T18:00:00Z', 8)];
  const t = Date.parse('2026-11-01T07:05:00Z');
  assert.deepEqual(findSharedRow(rows, t, Date.parse('2026-11-01T12:00:00Z'), UTC), {
    kind: 'past',
    text: 'The shared pass on Sun 1 Nov at 07:05 has already happened.',
  });
  // Also with no rows at all.
  assert.equal(findSharedRow([], t, Date.parse('2026-11-01T12:00:00Z'), UTC).kind, 'past');
});

test('findSharedRow: the past text uses the given time zone', () => {
  const t = Date.parse('2026-11-01T23:30:00Z');
  const r = findSharedRow([], t, Date.parse('2026-11-03T00:00:00Z'), { timeZone: 'Asia/Tokyo', locale: 'en-GB' });
  assert.equal(r.text, 'The shared pass on Mon 2 Nov at 08:30 has already happened.');
});

test('findSharedRow: a future pass that is not listed, or no shared time, gives null', () => {
  const rows = [row('2026-11-01T18:00:00Z', 8)];
  assert.equal(findSharedRow(rows, Date.parse('2026-11-05T18:00:00Z'), Date.parse('2026-11-01T12:00:00Z'), UTC), null);
  assert.equal(findSharedRow(rows, null, Date.parse('2026-11-01T12:00:00Z'), UTC), null);
  assert.equal(findSharedRow(null, null, 0, UTC), null);
});

test('sharedBannerText: names the sender and counts the other places', () => {
  const one = sharedSettings(decoded({ observers: decoded().observers.slice(0, 1) }));
  const two = sharedSettings(decoded({ observers: decoded().observers.slice(0, 2) }));
  const many = sharedSettings(decoded());
  assert.equal(sharedBannerText(one), "You're looking at a shared view from Chicago.");
  assert.equal(sharedBannerText(two), "You're looking at a shared view from Chicago and 1 other place.");
  assert.equal(sharedBannerText(many), "You're looking at a shared view from Chicago and 3 other places.");
});

test('sharedSettings clamps minElevDeg to the stepper range', () => {
  assert.equal(sharedSettings(decoded({ minElevDeg: 60 })).minElevDeg, 45);
  assert.equal(sharedSettings(decoded({ minElevDeg: -5 })).minElevDeg, 0);
  assert.equal(sharedSettings(decoded({ minElevDeg: undefined })).minElevDeg, 0);
});
