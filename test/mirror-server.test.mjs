import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onDemandFor } from '../lib/mirror/server.mjs';

test('outside production, on-demand lookups never reach the network', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('no network'); });
  for (const env of [undefined, 'development', 'preview']) {
    assert.equal(await onDemandFor(env).get(25544), null);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('production gets a real on-demand fetcher', () => {
  assert.notEqual(onDemandFor('production'), onDemandFor('preview'));
  assert.equal(typeof onDemandFor('production').get, 'function');
});
