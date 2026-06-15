import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logUsage } from '../lib/mcp/usage.mjs';

test('logUsage returns the structured record', () => {
  const r = logUsage({ tool: 'find_passes', tier: 'free', keyId: null, satellite: 'iss' });
  assert.equal(r.evt, 'mcp_tool');
  assert.equal(r.tool, 'find_passes');
  assert.equal(r.tier, 'free');
  assert.equal(r.satellite, 'iss');
  assert.equal(typeof r.ts, 'number');
});

test('logUsage defaults keyId and satellite to null', () => {
  const r = logUsage({ tool: 'list_satellites', tier: 'pro' });
  assert.equal(r.keyId, null);
  assert.equal(r.satellite, null);
});
