import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnDemandFetcher } from '../lib/mirror/on-demand.mjs';
import { ISS_OMM } from './fixtures/omm-iss.mjs';

const T0 = Date.parse('2026-03-02T00:00:00Z');
const HOUR = 3_600_000;

function setup(impl, opts = {}) {
  const clock = { t: T0 };
  const calls = [];
  const fetchByCatnr = async (id) => { calls.push(id); return impl(id); };
  const f = createOnDemandFetcher({ fetchByCatnr, now: () => clock.t, ...opts });
  return { f, calls, clock };
}

test('hit is cached within hitTtlMs and tagged as catnr', async () => {
  const { f, calls, clock } = setup(async () => ISS_OMM);
  const r = await f.get(25544);
  assert.equal(r.source, 'celestrak-catnr');
  assert.deepEqual(r.groups, []);
  assert.equal(r.noradId, 25544);
  assert.equal(r.name, 'ISS (ZARYA)');
  assert.equal(r.fetchedAtMs, T0);
  assert.ok(Number.isFinite(r.epochMs));
  clock.t += 3 * HOUR;
  await f.get(25544);
  assert.equal(calls.length, 1);
  clock.t += 2 * HOUR;
  await f.get(25544);
  assert.equal(calls.length, 2);
});

test('miss is cached for missTtlMs then refetched', async () => {
  const { f, calls, clock } = setup(async () => null);
  assert.equal(await f.get(1), null);
  clock.t += HOUR - 1;
  assert.equal(await f.get(1), null);
  assert.equal(calls.length, 1);
  clock.t += 2;
  await f.get(1);
  assert.equal(calls.length, 2);
});

test('61 distinct unknown ids in one hour make exactly 60 fetches', async () => {
  const { f, calls, clock } = setup(async () => null);
  for (let i = 1; i <= 61; i++) assert.equal(await f.get(i), null);
  assert.equal(calls.length, 60);
  clock.t += HOUR;
  await f.get(61);
  assert.equal(calls.length, 61);
});

test('cached hits and misses do not spend budget', async () => {
  const { f, calls } = setup(async () => null, { maxPerHour: 2 });
  await f.get(1); await f.get(2);
  for (let i = 0; i < 5; i++) { await f.get(1); await f.get(2); }
  assert.equal(calls.length, 2);
});

test('a rejected fetch returns null and is retried next call', async () => {
  let fail = true;
  const { f, calls } = setup(async () => { if (fail) throw new Error('down'); return ISS_OMM; });
  assert.equal(await f.get(25544), null);
  fail = false;
  const r = await f.get(25544);
  assert.equal(r.noradId, 25544);
  assert.equal(calls.length, 2);
});
