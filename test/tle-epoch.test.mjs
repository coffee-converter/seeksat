import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTleEpoch } from '../lib/pass-finder/tle.js';

// Sample TLE line 1 — fields 19-32 hold "YYDDD.dddddddd".
// Year 26 → 2026, day 141.81013265 → May 21 2026 19:26:35 UTC.
const REAL_LINE1 =
  "1 25544U 98067A   26141.81013265  .00006598  00000+0  12646-3 0  9999";

const DAY_MS = 86_400_000;

test('parseTleEpoch: known TLE → 2026-05-21 ~19:26 UTC', () => {
  const ms = parseTleEpoch(REAL_LINE1);
  const d = new Date(ms);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 4); // May
  assert.equal(d.getUTCDate(), 21);
  assert.equal(d.getUTCHours(), 19);
  // Allow ±1 minute of float fuzz from the decimal-day parse.
  assert.ok(Math.abs(d.getUTCMinutes() - 26) <= 1, `minutes=${d.getUTCMinutes()}`);
});

test('parseTleEpoch: 2-digit year < 57 → 2000s', () => {
  // Synthesize a line with year=00, day=001.0 → 2000-01-01 00:00 UTC.
  // Cols 0-17 just need to be filler; we pad to 32 chars.
  const line = "1 12345U 23456A   00001.00000000".padEnd(69, " ");
  const ms = parseTleEpoch(line);
  assert.equal(ms, Date.UTC(2000, 0, 1));
});

test('parseTleEpoch: 2-digit year >= 57 → 1900s', () => {
  const line = "1 12345U 23456A   57001.00000000".padEnd(69, " ");
  const ms = parseTleEpoch(line);
  assert.equal(ms, Date.UTC(1957, 0, 1));
});

test('parseTleEpoch: fractional day translates to fractional time', () => {
  const line = "1 12345U 23456A   25001.50000000".padEnd(69, " ");
  // Day 1.5 of 2025 = Jan 1, 2025 at 12:00 UTC.
  const ms = parseTleEpoch(line);
  assert.equal(ms, Date.UTC(2025, 0, 1, 12, 0, 0));
});

test('parseTleEpoch: day 365 → Dec 31', () => {
  const line = "1 12345U 23456A   25365.00000000".padEnd(69, " ");
  // Day 365 of 2025 = Dec 31 00:00 UTC. (2025 isn't a leap year.)
  const ms = parseTleEpoch(line);
  assert.equal(ms, Date.UTC(2025, 11, 31));
});

test('parseTleEpoch: leap-year day 366 → Dec 31', () => {
  const line = "1 12345U 23456A   24366.00000000".padEnd(69, " ");
  // 2024 IS a leap year, so day 366 = Dec 31 00:00 UTC.
  const ms = parseTleEpoch(line);
  assert.equal(ms, Date.UTC(2024, 11, 31));
});

test('parseTleEpoch: short or non-string input → NaN', () => {
  assert.ok(Number.isNaN(parseTleEpoch("")));
  assert.ok(Number.isNaN(parseTleEpoch("too short")));
  assert.ok(Number.isNaN(parseTleEpoch(null)));
  assert.ok(Number.isNaN(parseTleEpoch(undefined)));
  assert.ok(Number.isNaN(parseTleEpoch(12345)));
});

test('parseTleEpoch: garbage epoch field → NaN', () => {
  // Cols 18-32 set to a string that won't parseFloat.
  const line = "1 12345U 23456A   xxxxxxxxxxxxxx".padEnd(69, " ");
  assert.ok(Number.isNaN(parseTleEpoch(line)));
});

test('parseTleEpoch: monotonic — later epoch produces larger ms', () => {
  const earlier = "1 12345U 23456A   25001.00000000".padEnd(69, " ");
  const later   = "1 12345U 23456A   25002.00000000".padEnd(69, " ");
  assert.ok(parseTleEpoch(later) - parseTleEpoch(earlier) === DAY_MS);
});
