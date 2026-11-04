import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudsHandler } from '../lib/sky/clouds-handler.mjs';

async function withStubFetch(impl, fn) {
  const orig = globalThis.fetch;
  const origWarn = console.warn;
  globalThis.fetch = impl;
  console.warn = () => {};
  try { return await fn(); } finally { globalThis.fetch = orig; console.warn = origWarn; }
}
const q = (s) => new URLSearchParams(s);

test('clouds handler: bad input gives 400', async () => {
  for (const s of ['', 'lat=1', 'lat=abc&lon=1', 'lat=91&lon=0', 'lat=0&lon=181', 'lat=Infinity&lon=0']) {
    const r = await cloudsHandler(q(s));
    assert.equal(r.status, 400, s);
    assert.ok(r.body.error);
  }
});

test('clouds handler: good input gives 200 with cache header and rounded upstream coords', async () => {
  const urls = [];
  const r = await withStubFetch(async (url) => {
    urls.push(String(url));
    if (String(url).includes('open-meteo')) {
      return { ok: true, json: async () => ({ hourly: {
        time: ['2026-11-02T00:00', '2026-11-02T01:00'],
        cloud_cover_low: [50, 50], cloud_cover_mid: [0, 0], cloud_cover_high: [0, 0] } }) };
    }
    return { ok: false, status: 500 };
  }, () => cloudsHandler(q('lat=41.8781&lon=-87.6298')));
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'public, s-maxage=1800, stale-while-revalidate=3600');
  assert.equal(r.body.startMs, Date.UTC(2026, 10, 2));
  assert.deepEqual(r.body.hours, [50, 50]);
  assert.ok(urls.some((u) => u.includes('latitude=41.9&longitude=-87.6')));
});

test('clouds handler: upstream failure gives hours null', async () => {
  const r = await withStubFetch(async () => { throw new Error('boom'); },
    () => cloudsHandler(q('lat=-33.3&lon=151.2')));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { startMs: null, hours: null });
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
