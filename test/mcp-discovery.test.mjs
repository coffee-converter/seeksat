import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig } from '../lib/mcp/discovery.mjs';

test('TOOL_SUMMARIES lists every tool the server registers, each with a summary', () => {
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  const registered = [...route.matchAll(/server\.registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
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

test('every tool has a title and read-only hints; tools that geocode or fetch are open-world', () => {
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  assert.match(route, /const LOCAL = \{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false \};/);
  assert.match(route, /const ONLINE = \{ \.\.\.LOCAL, openWorldHint: true \};/);
  assert.equal(/server\.tool\(/.test(route), false, 'no tool registered without annotations');
  const blocks = route.split(/server\.registerTool\(/).slice(1);
  assert.ok(blocks.length >= 9);
  for (const b of blocks) {
    const name = b.match(/'([a-z_]+)'/)[1];
    assert.match(b, /\n {8}title: '[^']+',/, `${name} has a title`);
    const ann = b.match(/annotations: (LOCAL|ONLINE),/);
    assert.ok(ann, `${name} has annotations`);
    // A place name is geocoded by an outside service.
    if (/\n {10}location: z\./.test(b)) assert.equal(ann[1], 'ONLINE', `${name} geocodes, so it is open-world`);
  }
});

test('the /mcp page shows the result notes, and no summary or note uses an em dash', async () => {
  const { RESULT_NOTES } = await import('../lib/mcp/discovery.mjs');
  const page = readFileSync(new URL('../app/mcp/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /RESULT_NOTES\.map/);
  for (const text of [...TOOL_SUMMARIES.map((t) => t.summary), ...RESULT_NOTES]) assert.equal(text.includes('\u2014'), false, text);
});
