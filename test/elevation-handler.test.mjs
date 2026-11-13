import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevationHandler } from '../lib/sky/elevation-handler.mjs';

const q = (o) => new URLSearchParams(o);

test('elevation: the ground height, rounded, cached long', async () => {
  let asked = '';
  const r = await elevationHandler(q({ lat: '39.7392', lon: '-104.9903' }), {
    fetchImpl: async (url) => { asked = url; return { ok: true, json: async () => ({ elevation: [1609.4] }) }; },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { elevM: 1609 });
  assert.match(asked, /latitude=39\.739&longitude=-104\.99\b/);
  assert.match(r.headers['Cache-Control'], /s-maxage/);
});

test('elevation: sea or a failed lookup', async () => {
  const sea = await elevationHandler(q({ lat: '0', lon: '-140' }), { fetchImpl: async () => ({ ok: true, json: async () => ({ elevation: [-12] }) }) });
  assert.deepEqual(sea.body, { elevM: 0 });
  const down = await elevationHandler(q({ lat: '1', lon: '2' }), { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(down.body, { elevM: null });
  assert.equal(down.headers['Cache-Control'], 'no-store');
  const bad = await elevationHandler(q({ lat: 'x', lon: '2' }));
  assert.equal(bad.status, 400);
});
