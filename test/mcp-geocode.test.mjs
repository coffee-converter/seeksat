// test/mcp-geocode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeOne } from '../lib/pass-finder/geocode.js';

test('geocodeOne forwards a custom User-Agent header to fetch', async () => {
  let seenHeaders = null;
  const fakeFetch = async (_url, init) => {
    seenHeaders = init.headers;
    return { ok: true, json: async () => ([{ lat: '35.6', lon: '139.7', display_name: 'Tokyo' }]) };
  };
  const r = await geocodeOne('Tokyo', { fetchImpl: fakeFetch, headers: { 'User-Agent': 'seeksat-mcp/1.0' } });
  assert.equal(seenHeaders['User-Agent'], 'seeksat-mcp/1.0');
  assert.equal(r.displayName, 'Tokyo');
  assert.equal(r.latDeg, 35.6);
});

test('a failed lookup is not "no such place": it says busy and failed, and is not cached', async () => {
  let calls = 0;
  const down = async () => { calls++; throw new Error('timeout'); };
  const q = `Nowhere-${Math.random()}`;
  assert.deepEqual(await geocodeOne(q, { fetchImpl: down, gapMs: 0 }), { busy: true, failed: true });
  await geocodeOne(q, { fetchImpl: down, gapMs: 0 });
  assert.equal(calls, 2);
  // An empty answer is still "no such place".
  assert.equal(await geocodeOne(`Empty-${Math.random()}`, { fetchImpl: async () => ({ ok: true, json: async () => [] }), gapMs: 0 }), null);
});
