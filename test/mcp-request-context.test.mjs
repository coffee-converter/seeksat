import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithRequestContext, getRequestContext } from '../lib/mcp/request-context.mjs';

test('getRequestContext defaults to free/anonymous outside any scope', () => {
  assert.deepEqual(getRequestContext(), { tier: 'free', keyId: null });
});

test('context is visible to callees, including across await', async () => {
  await runWithRequestContext({ tier: 'pro', keyId: 'key_abc123' }, async () => {
    assert.equal(getRequestContext().tier, 'pro');
    await Promise.resolve();
    assert.equal(getRequestContext().keyId, 'key_abc123');
  });
  assert.equal(getRequestContext().tier, 'free');
});
