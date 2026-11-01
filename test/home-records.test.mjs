import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecords, tracksFor } from '../lib/home/records.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, recordFrom } from './fixtures/orbits.mjs';
import { getClockSkewMs, hasClockSyncSample } from '../lib/pass-finder/clock-sync.js';

const json = (status, body) => ({ status, ok: status === 200, json: async () => body });

test('fetchRecords chunks 120 ids into 3 calls and merges', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const ids = new URL(url, 'http://x').searchParams.get('ids').split(',').map(Number);
    return json(200, {
      generatedAtMs: 1,
      objects: ids.filter((i) => i % 2).map((noradId) => ({ noradId, name: `S${noradId}` })),
      missing: ids.filter((i) => i % 2 === 0),
    });
  };
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const { records, missing } = await fetchRecords(ids, { fetchImpl });
  assert.equal(urls.length, 3);
  assert.equal(records.size, 60);
  assert.equal(missing.length, 60);
});

test('fetchRecords surfaces the error copy', async () => {
  const msg = 'The satellite catalog is not available right now.';
  await assert.rejects(fetchRecords([1], { fetchImpl: async () => json(503, { error: 'x' }) }), { message: msg });
  await assert.rejects(fetchRecords([1], { fetchImpl: async () => { throw new TypeError('offline'); } }), { message: msg });
});

test('fetchRecords samples the clock skew from the response Date header', async () => {
  assert.equal(hasClockSyncSample(), false);
  // A server clock 10 minutes ahead of this machine.
  const serverDate = new Date(Date.now() + 600_000).toUTCString();
  const fetchImpl = async () => ({
    ...json(200, { objects: [], missing: [] }),
    headers: new Headers({ date: serverDate }),
  });
  await fetchRecords([25544], { fetchImpl });
  assert.equal(hasClockSyncSample(), true);
  // toUTCString drops milliseconds, so allow a couple of seconds.
  assert.ok(Math.abs(getClockSkewMs() - 600_000) < 2000, `skew ${getClockSkewMs()}`);
});

test('tracksFor lets a pasted record override the mirror record', () => {
  const mirror = recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MIRROR');
  const tracks = tracksFor(new Map([[25485, mirror]]), [
    { noradId: 25485, name: 'PASTED', line1: MOLNIYA_LINE1, line2: MOLNIYA_LINE2 },
  ]);
  assert.equal(tracks.size, 1);
  assert.equal(tracks.get(25485).record.source, 'pasted');
  assert.equal(tracks.get(25485).name, 'PASTED');
});

test('tracksFor builds mirror tracks without custom', () => {
  const mirror = recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'MIRROR');
  const t = tracksFor(new Map([[25485, mirror]]), []).get(25485);
  assert.equal(t.record.source, 'fixture');
  assert.equal(t.orbitClass, 'heo');
});
