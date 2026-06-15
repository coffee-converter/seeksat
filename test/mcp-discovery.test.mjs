import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig } from '../lib/mcp/discovery.mjs';

test('TOOL_SUMMARIES lists the five tools in order', () => {
  assert.deepEqual(
    TOOL_SUMMARIES.map((t) => t.name),
    ['list_satellites', 'find_passes', 'get_position', 'next_visible_pass', 'get_pass_weather'],
  );
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
