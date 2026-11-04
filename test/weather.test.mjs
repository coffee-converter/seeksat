import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudAt } from '../lib/pass-finder/weather.js';

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

test('cloudAt: returns exact hour value at hour timestamps', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 1_000_000), 50);
  assert.equal(cloudAt(f, 1_000_000 + 1 * 3_600_000), 60);
});

test('cloudAt: linearly interpolates between adjacent hour samples', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  // 30 min into hour 0: halfway between 50 and 60 → 55
  assert.equal(cloudAt(f, 1_000_000 + 30 * 60_000), 55);
  // 15 min into hour 1: 25% of the way from 60 to 70 → 62.5
  assert.equal(cloudAt(f, 1_000_000 + 75 * 60_000), 62.5);
});

test('cloudAt: inside last hour returns last-hour value (no next sample to interp)', () => {
  const f = { startMs: 1_000_000, hours: [50, 60, 70] };
  assert.equal(cloudAt(f, 1_000_000 + 2 * 3_600_000), 70);
  assert.equal(cloudAt(f, 1_000_000 + 2.5 * 3_600_000), 70);
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

// ---- upstream hardening (fetch is stubbed; no real network) ----

import { fetchCloudForecast } from '../lib/pass-finder/weather.js';

async function withStubFetch(impl, fn) {
  const orig = globalThis.fetch;
  const origWarn = console.warn;
  globalThis.fetch = impl;
  console.warn = () => {};
  try { return await fn(); } finally { globalThis.fetch = orig; console.warn = origWarn; }
}

test('fetchCloudForecast: upstream calls carry User-Agent and a timeout signal', async () => {
  const calls = [];
  await withStubFetch(async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: false, status: 500 };
  }, () => fetchCloudForecast(10.01, 20.01));
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.opts.headers['User-Agent'], 'seeksat/1.0 (https://seeksat.com)');
    assert.ok(c.opts.signal instanceof AbortSignal);
  }
});

test('fetchCloudForecast: cache holds at most 200 entries, oldest evicted first', async () => {
  let count = 0;
  const okOpenMeteo = async (url) => {
    count++;
    if (String(url).includes('open-meteo')) {
      return { ok: true, json: async () => ({ hourly: {
        time: ['2026-11-02T00:00'], cloud_cover_low: [10], cloud_cover_mid: [0], cloud_cover_high: [0] } }) };
    }
    return { ok: false, status: 500 };
  };
  await withStubFetch(okOpenMeteo, async () => {
    for (let i = 0; i < 201; i++) await fetchCloudForecast(-60 + i * 0.5, 100.5);
    const after = count;
    await fetchCloudForecast(-60 + 200 * 0.5, 100.5); // newest: still cached
    assert.equal(count, after);
    await fetchCloudForecast(-60, 100.5); // first key: evicted, refetches
    assert.equal(count, after + 2);
  });
});
