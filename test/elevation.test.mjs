import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupElev, lookupElevResult } from '../lib/elevation.js';

// Swaps global fetch for the duration of `fn`, then restores it - even if
// `fn` throws. Each test below uses a distinct (lat, lon) pair so the
// module's internal cache (keyed by rounded coordinates) never serves a
// stale promise from an earlier test's mock.
async function withMockFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('lookupElevResult: successful lookup resolves { elevM, ok: true }', async () => {
  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ results: [{ elevation: 123.4 }] }) }),
    async () => {
      const out = await lookupElevResult(10.001, 20.001);
      assert.deepEqual(out, { elevM: 123.4, ok: true });
    },
  );
});

test('lookupElevResult: a genuine sea-level (0 m) site is still ok: true', () => withMockFetch(
  async () => ({ ok: true, json: async () => ({ results: [{ elevation: 0 }] }) }),
  async () => {
    // This is exactly the ambiguity lookupElev can't resolve: a real 0 m
    // result and a failed lookup both look like 0 through that API -
    // lookupElevResult must keep them distinguishable via `ok`.
    const out = await lookupElevResult(10.002, 20.002);
    assert.deepEqual(out, { elevM: 0, ok: true });
  },
));

test('lookupElevResult: HTTP failure resolves { elevM: 0, ok: false }', () => withMockFetch(
  async () => ({ ok: false, status: 500 }),
  async () => {
    const out = await lookupElevResult(10.003, 20.003);
    assert.deepEqual(out, { elevM: 0, ok: false });
  },
));

test('lookupElevResult: network rejection resolves { elevM: 0, ok: false }', () => withMockFetch(
  async () => { throw new Error('network down'); },
  async () => {
    const out = await lookupElevResult(10.004, 20.004);
    assert.deepEqual(out, { elevM: 0, ok: false });
  },
));

test('lookupElev: delegates to lookupElevResult, returning just elevM', () => withMockFetch(
  async () => ({ ok: true, json: async () => ({ results: [{ elevation: 55 }] }) }),
  async () => {
    const out = await lookupElev(10.005, 20.005);
    assert.equal(out, 55);
  },
));

test('lookupElev: still falls back to 0 on failure (existing contract preserved)', () => withMockFetch(
  async () => ({ ok: false, status: 500 }),
  async () => {
    const out = await lookupElev(10.006, 20.006);
    assert.equal(out, 0);
  },
));
