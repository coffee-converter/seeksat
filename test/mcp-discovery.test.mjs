import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig } from '../lib/mcp/discovery.mjs';

test('TOOL_SUMMARIES lists every tool the server registers, each with a summary', () => {
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  const registered = [...route.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(registered.length >= 9, registered.join());
  assert.deepEqual([...TOOL_SUMMARIES.map((t) => t.name)].sort(), [...registered].sort());
  for (const t of TOOL_SUMMARIES) assert.ok(t.summary.length > 0, `${t.name} has a summary`);
});

test('mcpUrl + claudeAddCommand build from an origin', () => {
  assert.equal(mcpUrl('https://seeksat.com'), 'https://seeksat.com/api/mcp');
  assert.equal(
    claudeAddCommand('https://seeksat.com'),
    'claude mcp add --transport http seeksat https://seeksat.com/api/mcp',
  );
});

test('mcpJsonConfig parses back to the expected object', () => {
  const cfg = JSON.parse(mcpJsonConfig('https://seeksat.com'));
  assert.equal(cfg.mcpServers.seeksat.url, 'https://seeksat.com/api/mcp');
});
