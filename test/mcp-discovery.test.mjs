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

test('the error notes describe validation failures as the SDK returns them: a tool result with isError', async () => {
  const { ERROR_NOTES } = await import('../lib/mcp/discovery.mjs');
  const text = ERROR_NOTES.join(' ');
  assert.match(text, /isError: true \(not a JSON-RPC error\)/);
  assert.match(text, /"MCP error -32602: Input validation error"/);
  const md = readFileSync(new URL('../docs/seeksat-mcp.md', import.meta.url), 'utf8');
  assert.match(md, /not a JSON-RPC error/);
  assert.equal(/as JSON-RPC error -32602/.test(text + md), false);
});

test('schemas are strict: an unknown parameter is refused, naming the ones the tool takes; old names work everywhere', async () => {
  const { inputObject, ALIASES } = await import('../lib/mcp/tool-specs.mjs');
  const { toolParams } = await import('../lib/mcp/discovery.mjs');
  for (const t of TOOL_SPECS) {
    const schema = inputObject(t);
    const r = schema.safeParse({ notAParameter: 1 });
    assert.equal(r.success, false, t.name);
    const msg = r.error.issues.map((i) => i.message).join(' ');
    assert.match(msg, new RegExp(`unknown parameter "notAParameter" for ${t.name}\\. It takes`), t.name);
    for (const [name, old] of Object.entries(ALIASES)) {
      const optional = t.inputSchema[name]?.safeParse(undefined).success;
      for (const alias of old) {
        assert.equal(alias in t.inputSchema, Boolean(optional), `${t.name}.${alias}`);
        if (optional) assert.match(msg, new RegExp(`${alias} for ${name}`));
      }
    }
    // The docs tables list each parameter once, under its current name.
    for (const p of toolParams(t)) assert.ok(!(p.name in (t.aliases ?? {})), `${t.name}.${p.name}`);
  }
  const fp = inputObject(TOOL_SPECS.find((t) => t.name === 'find_passes'));
  assert.equal(fp.safeParse({ satellite: 25544, lat: 1, lon: 2, minElevationDeg: 60 }).success, true);
  assert.equal(fp.safeParse({ satellite: 25544, lat: 1, lon: 2, minElev: 95 }).success, false, 'an old name is range-checked too');
  const err = fp.safeParse({ satellite: 25544, lat: 1, lon: 2, minElevationDegrees: 60 }).error.issues[0].message;
  assert.match(err, /It takes satellite, lat, lon, location, windowHours, minElevation, mode, skyType \(old names still accepted: minElevationDeg for minElevation, minElev for minElevation\)/);
  // list_satellites takes nothing.
  assert.match(inputObject(TOOL_SPECS[0]).safeParse({ x: 1 }).error.issues[0].message, /takes no parameters/);
  // The route registers the strict schema.
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  assert.match(route, /inputSchema: inputObject\(spec\),/);
});

test('the /mcp page shows the result notes, and no summary or note uses an em dash', async () => {
  const { RESULT_NOTES } = await import('../lib/mcp/discovery.mjs');
  const page = readFileSync(new URL('../app/mcp/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /RESULT_NOTES\.map/);
  for (const text of [...TOOL_SUMMARIES.map((t) => t.summary), ...RESULT_NOTES]) assert.equal(text.includes('\u2014'), false, text);
  for (const t of TOOL_SPECS) assert.equal(t.description.includes('\u2014'), false, t.name);
});

test('client setup: Claude Code JSON says type http, Claude Desktop bridges with mcp-remote, Cursor takes a url', async () => {
  const d = await import('../lib/mcp/discovery.mjs');
  const o = 'https://seeksat.com';
  assert.deepEqual(JSON.parse(d.claudeCodeJsonConfig(o)), { mcpServers: { seeksat: { type: 'http', url: 'https://seeksat.com/api/mcp' } } });
  assert.deepEqual(JSON.parse(d.claudeDesktopBridgeConfig(o)).mcpServers.seeksat, { command: 'npx', args: ['-y', 'mcp-remote', 'https://seeksat.com/api/mcp'] });
  assert.deepEqual(JSON.parse(d.cursorJsonConfig(o, { withKey: true })).mcpServers.seeksat.headers, { Authorization: 'Bearer YOUR_KEY' });
  assert.match(d.claudeDesktopSteps(o), /Settings > Connectors > Add custom connector/);
  assert.match(d.claudeAddCommandWithKey(o), /--header "Authorization: Bearer YOUR_KEY"$/);
  assert.equal(d.TRANSPORT, 'Streamable HTTP');
  assert.match(d.RATE_LIMIT_NOTE, /120 requests per 60 seconds per IP address/);
  // The header names the route reads.
  const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
  assert.match(route, /headers\.get\('authorization'\)/);
  assert.match(route, /headers\.get\('x-api-key'\)/);
  assert.deepEqual(d.API_KEY_HEADERS, ['Authorization: Bearer <key>', 'X-API-Key: <key>']);
  assert.match(route, /instructions: SERVER_INSTRUCTIONS/);
});

test('toolDocs gives every parameter with its type, range and default from the schema', async () => {
  const { toolDocs } = await import('../lib/mcp/discovery.mjs');
  const docs = toolDocs();
  assert.deepEqual(docs.map((t) => t.name), TOOL_SPECS.map((t) => t.name));
  const fp = docs.find((t) => t.name === 'find_passes').params;
  const by = Object.fromEntries(fp.map((p) => [p.name, p]));
  assert.deepEqual(by.satellite, { ...by.satellite, type: 'string or whole number', required: true });
  assert.equal(by.windowHours.range, 'above 0, up to 240');
  assert.match(by.windowHours.description, /Default 48/);
  assert.equal(by.minElevation.range, '0 to 90');
  assert.equal(by.mode.type, '"visual" | "radio"');
  const bp = Object.fromEntries(docs.find((t) => t.name === 'best_pass').params.map((p) => [p.name, p]));
  assert.equal(bp.limit.range, '1 to 20');
  assert.equal(bp.satellite.required, false);
});

test('the written docs and the skill name every tool and the endpoint, with no em dashes', () => {
  for (const file of ['../docs/seeksat-mcp.md', '../skills/seeksat/SKILL.md', '../README.md']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(text.includes('https://seeksat.com/api/mcp'), file);
    assert.ok(text.includes('claude mcp add --transport http seeksat https://seeksat.com/api/mcp'), file);
    if (file === '../README.md') continue;
    for (const t of TOOL_SPECS) assert.ok(text.includes(`\`${t.name}\``), `${file} names ${t.name}`);
    assert.equal(text.includes('\u2014'), false, file);
  }
  const page = readFileSync(new URL('../app/mcp/page.tsx', import.meta.url), 'utf8');
  for (const fn of ['claudeCodeJsonConfig', 'claudeDesktopSteps', 'claudeDesktopBridgeConfig', 'cursorJsonConfig', 'toolDocs', 'RATE_LIMIT_NOTE', 'ERROR_NOTES']) assert.ok(page.includes(fn), fn);
});
