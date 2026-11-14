// test/reception-satnogs-network.test.mjs - sweeping SatNOGS Network
// observations, on two recorded (trimmed) pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepObservations, slimObservation, SATNOGS_NETWORK_OBSERVATIONS_URL, MAX_PAGES, PAGE_GAP_MS } from '../lib/reception/satnogs-network.mjs';

const page = (n) => JSON.parse(readFileSync(new URL(`./fixtures/satnogs-observations-page${n}.json`, import.meta.url), 'utf8'));
const NEXT = 'https://network.satnogs.org/api/observations/?cursor=cD0yMDI2LTExLTEzKzAwJTNBMzUlM0E0OCUyQjAwJTNBMDA%3D&end=2026-11-13T01%3A00%3A00Z&format=json&start=2026-11-13T00%3A00%3A00Z&status=good';
const ARGS = { status: 'good', startIso: '2026-11-13T00:00:00Z', endIso: '2026-11-13T01:00:00Z' };

const json = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fetch that answers from a list of responses in order, recording calls. */
function scripted(responses) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return typeof next === 'function' ? next() : next;
  };
  return { calls, fetchImpl };
}
const sleeper = () => {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
};

test('follows next links to the end', async () => {
  const { calls, fetchImpl } = scripted([json(page(1), { headers: { link: `<${NEXT}>; rel="next"` } }), json(page(2))]);
  const { waits, sleep } = sleeper();
  const r = await sweepObservations({ ...ARGS, fetchImpl, sleep });
  assert.equal(r.complete, true);
  assert.equal(r.truncated, false);
  assert.equal(r.pages, 2);
  assert.equal(r.observations.length, 6);
  assert.equal(calls[0].url, `${SATNOGS_NETWORK_OBSERVATIONS_URL}?format=json&status=good&start=2026-11-13T00%3A00%3A00Z&end=2026-11-13T01%3A00%3A00Z`);
  assert.equal(calls[1].url, NEXT);
  assert.deepEqual(waits, [PAGE_GAP_MS]);
  const first = r.observations[0];
  assert.deepEqual(first, { uuid: 'dfNhMzVxVwCRU27ZKGYXPR', noradId: 59774, endMs: Date.parse('2026-11-13T00:56:32Z'), lowHz: 401_005_000, highHz: 401_005_000 });
});

test('stops at the page cap', async () => {
  assert.equal(MAX_PAGES, 300);
  const { fetchImpl } = scripted([json(page(1), { headers: { link: `<${NEXT}>; rel="next"` } })]);
  const r = await sweepObservations({ ...ARGS, fetchImpl, sleep: async () => {}, maxPages: 1 });
  assert.equal(r.truncated, true);
  assert.equal(r.complete, false);
  assert.equal(r.observations.length, 3);
  assert.equal(r.error, undefined);
});

test('retries 429 with Retry-After', async () => {
  const { fetchImpl } = scripted([json({}, { status: 429, headers: { 'retry-after': '5' } }), json(page(2))]);
  const { waits, sleep } = sleeper();
  const r = await sweepObservations({ ...ARGS, fetchImpl, sleep });
  assert.ok(waits.includes(5000));
  assert.equal(r.complete, true);
  assert.equal(r.observations.length, 3);
});

test('gives up after three 5xx retries', async () => {
  const { fetchImpl } = scripted([json({}, { status: 503 }), json({}, { status: 502 }), json({}, { status: 500 }), json({}, { status: 503 })]);
  const { waits, sleep } = sleeper();
  const r = await sweepObservations({ ...ARGS, fetchImpl, sleep });
  assert.equal(r.complete, false);
  assert.equal(r.truncated, false);
  assert.match(r.error, /503/);
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test('a network error, a 404 or a body that is not a list gives up without throwing', async () => {
  for (const bad of [() => { throw new Error('ECONNRESET'); }, json({}, { status: 404 }), json({ detail: 'x' })]) {
    const { fetchImpl } = scripted([bad]);
    const r = await sweepObservations({ ...ARGS, fetchImpl, sleep: async () => {} });
    assert.equal(r.complete, false);
    assert.ok(r.error);
  }
});

test('passing the deadline gives up', async () => {
  let t = 0;
  const { fetchImpl } = scripted([json(page(1), { headers: { link: `<${NEXT}>; rel="next"` } }), json(page(2))]);
  const r = await sweepObservations({ ...ARGS, fetchImpl, sleep: async () => { t += 1000; }, now: () => t, deadlineMs: 500 });
  assert.equal(r.complete, false);
  assert.match(r.error, /deadline/);
});

test('sends the identifying User-Agent', async () => {
  const { calls, fetchImpl } = scripted([json(page(2))]);
  await sweepObservations({ ...ARGS, fetchImpl, sleep: async () => {} });
  assert.match(calls[0].opts.headers['User-Agent'], /^seeksat\/1\.0 \(https?:\/\//);
});

test('slimObservation drops rows without a transmitter, satellite or end', () => {
  const ok = page(1)[0];
  assert.ok(slimObservation(ok));
  assert.equal(slimObservation({ ...ok, transmitter_uuid: null }), null);
  assert.equal(slimObservation({ ...ok, norad_cat_id: 'x' }), null);
  assert.equal(slimObservation({ ...ok, end: 'never' }), null);
  assert.equal(slimObservation(null), null);
  // No high edge: the low one.
  assert.equal(slimObservation({ ...ok, transmitter_downlink_high: null }).highHz, 401_005_000);
});

test('a next link off SatNOGS Network observations stops the sweep', async () => {
  for (const next of ['https://evil.example/api/observations/?cursor=x', 'http://network.satnogs.org/api/observations/?cursor=x', 'https://network.satnogs.org/admin/?cursor=x']) {
    const { calls, fetchImpl } = scripted([json(page(1), { headers: { link: `<${next}>; rel="next"` } }), json(page(2))]);
    const r = await sweepObservations({ ...ARGS, fetchImpl, sleep: async () => {} });
    assert.equal(calls.length, 1, next);
    assert.equal(r.complete, false);
    assert.match(r.error, /next link/);
  }
});
