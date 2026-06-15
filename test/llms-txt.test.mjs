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
