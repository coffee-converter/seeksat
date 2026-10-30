import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInitialSatelliteTles, HOME_SEED_TIMEOUT_MS } from '../lib/mirror/seed.mjs';
import { ISS_OMM, ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';

const CAT = [{ noradId: 25544 }, { noradId: 20580 }];
const ISS = { noradId: 25544, name: 'ISS (ZARYA)', omm: ISS_OMM, line1: ISS_LINE1, line2: ISS_LINE2 };

test('seeds from snapshot records only, never the on-demand path', async () => {
  const asked = [];
  const reader = {
    getSnapshotRecord: async (id) => { asked.push(id); return id === 25544 ? ISS : null; },
    getRecord: async () => { throw new Error('must not call getRecord'); },
  };
  const out = await readInitialSatelliteTles({ reader, catalog: CAT });
  assert.deepEqual(asked, [25544, 20580]);
  assert.deepEqual(out, { 25544: { name: 'ISS (ZARYA)', line1: ISS_LINE1, line2: ISS_LINE2 } });
});

test('falls back to {} when the reader is slower than the timeout', { timeout: 2000 }, async () => {
  const reader = { getSnapshotRecord: () => new Promise(() => {}) };
  assert.deepEqual(await readInitialSatelliteTles({ reader, catalog: CAT, timeoutMs: 10 }), {});
});

test('falls back to {} when the reader throws', async () => {
  const reader = { getSnapshotRecord: async () => { throw new Error('boom'); } };
  assert.deepEqual(await readInitialSatelliteTles({ reader, catalog: CAT }), {});
});

test('default timeout is 1500 ms and the timer is cleared on success', async () => {
  assert.equal(HOME_SEED_TIMEOUT_MS, 1500);
  const set = [];
  const cleared = [];
  const reader = { getSnapshotRecord: async () => ISS };
  await readInitialSatelliteTles({
    reader, catalog: [{ noradId: 25544 }],
    setTimeoutImpl: (fn, ms) => { set.push(ms); return 'h'; },
    clearTimeoutImpl: (h) => cleared.push(h),
  });
  assert.deepEqual(set, [1500]);
  assert.deepEqual(cleared, ['h']);
});
