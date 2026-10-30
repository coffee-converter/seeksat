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

test('default cap: 16 distinct unknown ids in one hour make exactly 15 fetches', async () => {
  const { f, calls, clock } = setup(async () => null);
  for (let i = 1; i <= 16; i++) assert.equal(await f.get(i), null);
  assert.equal(calls.length, 15);
  clock.t += HOUR;
  await f.get(16);
  assert.equal(calls.length, 16);
});

test('maxPerHour + 1 distinct ids make maxPerHour fetches', async () => {
  const { f, calls } = setup(async () => null, { maxPerHour: 4 });
  for (let i = 1; i <= 5; i++) await f.get(i);
  assert.equal(calls.length, 4);
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

test('parallel gets for one cold id share one fetch and one budget slot', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { f, calls } = setup(async (id) => { await gate; return id === 25544 ? ISS_OMM : null; });
  const ps = [f.get(25544), f.get(25544), f.get(25544)];
  release();
  const out = await Promise.all(ps);
  assert.equal(calls.length, 1);
  assert.equal(out[0], out[1]);
  assert.equal(out[1], out[2]);
  assert.equal(out[0].noradId, 25544);
  for (let i = 1; i <= 14; i++) await f.get(i);
  assert.equal(calls.length, 15);
  await f.get(1000);
  assert.equal(calls.length, 15);
});
