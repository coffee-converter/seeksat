// test/mcp-tle-fetch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceUrls, fetchTleForId } from '../lib/mcp/tle-fetch.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0000000   0.0000   0.0000 15.50000000000000';

test('buildSourceUrls injects the NORAD id into every source', () => {
  const urls = buildSourceUrls(20580).map(s => s.url);
  assert.ok(urls.some(u => u.includes('20580')));
  assert.ok(urls.every(u => u.includes('20580')));
});

test('fetchTleForId returns the first source that parses', async () => {
  const fakeFetch = async (url) => {
    assert.ok(url.includes('25544'));
    return { ok: true, headers: new Map(), json: async () => ({ header: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 }) };
  };
  const r = await fetchTleForId(25544, { fetchImpl: fakeFetch });
  assert.equal(r.line1, LINE1);
  assert.equal(r.source, 'wheretheiss');
  assert.ok(Number.isFinite(r.epochMs));
});

test('fetchTleForId falls through to the next source on failure', async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (url.includes('wheretheiss')) return { ok: false, status: 508 };
    return { ok: true, headers: new Map(), json: async () => ({ name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 }) };
  };
  const r = await fetchTleForId(25544, { fetchImpl: fakeFetch });
  assert.equal(r.source, 'ivanstanojevic');
  assert.ok(calls >= 2);
});

test('fetchTleForId returns null when all sources fail', async () => {
  const r = await fetchTleForId(25544, { fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r, null);
});
