import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig } from '../lib/mcp/discovery.mjs';
import { TOOL_SPECS } from '../lib/mcp/tool-specs.mjs';

test('TOOL_SUMMARIES lists every tool the server registers, each with a summary', () => {
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  assert.match(route, /for \(const spec of TOOL_SPECS\)/, 'the route registers every spec');
  // Every spec has a handler in the route.
  const block = route.slice(route.indexOf('const HANDLERS'), route.indexOf('};', route.indexOf('const HANDLERS')));
  const handled = [...block.matchAll(/^  ([a-z_]+): \(/gm)].map((m) => m[1]);
  assert.deepEqual([...handled].sort(), TOOL_SPECS.map((t) => t.name).sort());
  assert.ok(TOOL_SPECS.length >= 11);
  assert.deepEqual(TOOL_SUMMARIES.map((t) => t.name), TOOL_SPECS.map((t) => t.name));
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
  assert.match(route, /annotations: spec\.online \? ONLINE : LOCAL,/);
  for (const t of TOOL_SPECS) {
    assert.ok(t.title.length > 0, `${t.name} has a title`);
    assert.ok(t.description.length > 0, `${t.name} has a description`);
    // A place name is geocoded by an outside service.
    if ('location' in t.inputSchema) assert.equal(t.online, true, `${t.name} geocodes, so it is open-world`);
  }
});

test('inputs: NORAD ids as numbers or strings, minElevation and time everywhere they apply, old names kept', () => {
  const shape = (name) => TOOL_SPECS.find((t) => t.name === name).inputSchema;
  for (const t of TOOL_SPECS) {
    const s = t.inputSchema;
    if (s.satellite) {
      assert.equal(s.satellite.safeParse(25544).success, true, t.name);
      assert.equal(s.satellite.safeParse('iss').success, true, t.name);
    }
    assert.equal('passTime' in s && !('time' in s), false, `${t.name}: time is the name`);
    assert.equal('minElevationDeg' in s && !('minElevation' in s), false, `${t.name}: minElevation is the name`);
    if (s.windowHours) {
      assert.equal(s.windowHours.safeParse(241).success, false);
      assert.match(s.windowHours.safeParse(241).error.issues[0].message, /at most 240/);
    }
    if (s.limit) assert.match(s.limit.safeParse(999).error.issues[0].message, /limit can be at most/);
    for (const [k, v] of Object.entries(s)) assert.ok(v.description, `${t.name}.${k} is described`);
  }
  for (const name of ['find_passes', 'next_visible_pass', 'get_pass_chart', 'get_radio_pass', 'best_pass', 'whats_up_now']) assert.ok(shape(name).minElevation, name);
  assert.ok(shape('get_radio_pass').minElevationDeg && shape('get_radio_pass').passTime, 'old names still accepted');
});

test('the /mcp page shows the result notes, and no summary or note uses an em dash', async () => {
  const { RESULT_NOTES } = await import('../lib/mcp/discovery.mjs');
  const page = readFileSync(new URL('../app/mcp/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /RESULT_NOTES\.map/);
  for (const text of [...TOOL_SUMMARIES.map((t) => t.summary), ...RESULT_NOTES]) assert.equal(text.includes('\u2014'), false, text);
});
