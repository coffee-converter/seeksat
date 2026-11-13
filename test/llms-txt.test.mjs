import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmsTxt } from '../lib/mcp/llms-txt.mjs';

test('buildLlmsTxt includes endpoint, add-command, every tool, and the /mcp link', () => {
  const txt = buildLlmsTxt('https://seeksat.com');
  assert.ok(txt.includes('https://seeksat.com/api/mcp'), 'endpoint');
  assert.ok(txt.includes('claude mcp add'), 'add command');
  assert.ok(txt.includes('list_satellites'), 'first tool');
  assert.ok(txt.includes('get_pass_weather'), 'last tool');
  assert.ok(txt.includes('https://seeksat.com/mcp'), 'docs link');
  assert.ok(txt.startsWith('# SeekSat'), 'llms.txt heading');
});

test('buildLlmsTxt lists the newer tools and what results include', async () => {
  const { TOOL_SUMMARIES, RESULT_NOTES } = await import('../lib/mcp/discovery.mjs');
  const txt = buildLlmsTxt('https://seeksat.com');
  for (const t of TOOL_SUMMARIES) assert.ok(txt.includes(`- ${t.name}: `), t.name);
  for (const name of ['whats_up_now', 'identify_satellite']) assert.ok(txt.includes(name), name);
  assert.ok(txt.includes('## Results'));
  for (const n of RESULT_NOTES) assert.ok(txt.includes(n));
  for (const field of ['url', 'visibleFrom', 'entersShadow', 'peakMagnitudeEstimated', 'readOnlyHint']) assert.ok(txt.includes(field), field);
  // Plain text for people too: no em dashes.
  assert.equal(txt.includes('\u2014'), false);
});
