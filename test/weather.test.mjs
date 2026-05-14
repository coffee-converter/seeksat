import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudAt } from '../pass-finder/weather.js';

test('cloudAt: null forecast returns null', () => {
  assert.equal(cloudAt(null, 0), null);
});

test('cloudAt: out-of-range (before start) returns null', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 999_999), null);
});

test('cloudAt: out-of-range (after last hour) returns null', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 1_000_000 + 3 * 3_600_000), null);
});

test('cloudAt: returns first hour value for ms inside first hour', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 1_000_000), 50);
  assert.equal(cloudAt(f, 1_000_000 + 30 * 60_000), 50); // 30 min in
});

test('cloudAt: crosses hour boundary to next bucket', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 1_000_000 + 1 * 3_600_000), 60);
  assert.equal(cloudAt(f, 1_000_000 + 2 * 3_600_000), 70);
});

test('UTC parse trap: "YYYY-MM-DDTHH:MM" alone parses as local; "+Z" forces UTC', () => {
  // Demonstrates why weather.js appends "Z" to Open-Meteo time strings.
  const noZ = new Date("2026-05-14T00:00").getTime();
  const withZ = new Date("2026-05-14T00:00Z").getTime();
  const expectedUtc = Date.UTC(2026, 4, 14, 0, 0, 0);
  // The +Z form is timezone-stable and matches Date.UTC exactly.
  assert.equal(withZ, expectedUtc);
  // The no-Z form depends on the runner's local TZ; only assert it differs
  // from UTC when the local TZ isn't UTC. Either way, +Z is the correct one.
  if (new Date().getTimezoneOffset() !== 0) {
    assert.notEqual(noZ, expectedUtc, "no-Z parsed as local, not UTC");
  }
});
