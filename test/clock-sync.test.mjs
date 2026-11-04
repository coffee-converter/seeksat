import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncFromResponse, getClockSkewMs } from '../lib/pass-finder/clock-sync.js';

const res = (headers) => ({ headers: new Headers(headers) });

test('a fresh response sets the skew from its Date header', () => {
  syncFromResponse(res({ date: new Date(Date.now() - 120_000).toUTCString() }));
  assert.ok(Math.abs(getClockSkewMs() + 120_000) < 2_000);
});

test('a CDN-cached response is corrected by its Age header', () => {
  // Cached 7 minutes ago: Date is 7 min old, Age says 420 s.
  syncFromResponse(res({ date: new Date(Date.now() - 420_000).toUTCString(), age: '420' }));
  assert.ok(Math.abs(getClockSkewMs()) < 2_000);
});

test('a missing or junk Age header is ignored', () => {
  syncFromResponse(res({ date: new Date().toUTCString(), age: 'soon' }));
  assert.ok(Math.abs(getClockSkewMs()) < 2_000);
});

test('a service-worker saved copy never sets the skew', () => {
  const now = Date.now();
  syncFromResponse({ headers: new Headers({ date: new Date(now).toUTCString() }) });
  const before = getClockSkewMs();
  // Saved three days ago: its Date says nothing about this clock.
  syncFromResponse({ headers: new Headers({ date: new Date(now - 3 * 86_400_000).toUTCString(), 'x-seeksat-cache': '1' }) });
  assert.equal(getClockSkewMs(), before);
});
