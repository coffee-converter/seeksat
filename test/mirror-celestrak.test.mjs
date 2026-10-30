import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGroup, fetchByCatnr, groupUrl, catnrUrl, MIRROR_GROUPS } from '../lib/mirror/celestrak.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body, status = 200) => new Response(body, { status });

test('urls and groups', () => {
  assert.deepEqual([...MIRROR_GROUPS], ['active', 'last-30-days']);
  assert.equal(groupUrl('active'), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');
  assert.equal(catnrUrl(25544), 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json');
});

test('fetchGroup sends User-Agent and returns normalized array', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return json([ISS_OMM]); };
  const out = await fetchGroup('active', { fetchImpl });
  assert.equal(out.length, 1);
  assert.equal(out[0].NORAD_CAT_ID, 25544);
  assert.equal(seen.url, groupUrl('active'));
  assert.equal(seen.opts.headers['User-Agent'], 'seeksat/1.0 (https://seeksat.app)');
});

test('fetchGroup drops malformed elements', async () => {
  const out = await fetchGroup('active', { fetchImpl: async () => json([ISS_OMM, { bogus: true }]) });
  assert.equal(out.length, 1);
});

test('fetchGroup rejects on HTTP 403 and on HTML', async () => {
  await assert.rejects(fetchGroup('active', { fetchImpl: async () => text('no', 403) }), /403/);
  await assert.rejects(fetchGroup('active', { fetchImpl: async () => text('<html></html>') }), /not JSON/);
});

test('fetchByCatnr returns null when absent', async () => {
  assert.equal(await fetchByCatnr(1, { fetchImpl: async () => text('No GP data found') }), null);
  assert.equal(await fetchByCatnr(1, { fetchImpl: async () => json([]) }), null);
});

test('fetchByCatnr returns the record, rejects on HTTP 500', async () => {
  const r = await fetchByCatnr(25544, { fetchImpl: async () => json([ISS_OMM]) });
  assert.equal(r.NORAD_CAT_ID, 25544);
  await assert.rejects(fetchByCatnr(1, { fetchImpl: async () => text('x', 500) }), /500/);
});
