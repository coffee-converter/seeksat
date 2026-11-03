import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, walk } from './helpers/import-graph.mjs';
import { buildCsp } from '../lib/site/csp.mjs';

const ROOTS = [
  'components/home/HomeApp.tsx',
  'components/sat/SatApp.tsx',
  'components/map/MapLayoutShell.tsx',
  'app/mcp/page.tsx',
];

// Origins that appear in client source only as links or text, never fetched.
const NOT_FETCHED = new Set([
  'https://aaronhanson.dev', // footer credit link
  'https://seeksat.com', // canonical site URL in copy and links
  'https://claude.ai', // MCP docs: link to connect the server
  'https://api.open-meteo.com', // server-only, via the MCP route
  'https://api.met.no', // server-only, via the MCP route
  'https://seeksat.app', // User-Agent string in weather.js, never fetched
]);

test('production CSP drops the globe-era origins and eval', () => {
  const csp = buildCsp();
  for (const bad of ['cesium.com', 'arcgisonline', 'cartodb', 'tile.openstreetmap', 'celestrak.org', "'unsafe-eval'"]) {
    assert.ok(!csp.includes(bad), `unexpected ${bad}`);
  }
});

test('dev CSP allows eval for the Next dev server', () => {
  assert.ok(buildCsp({ dev: true }).includes("'unsafe-eval'"));
  assert.ok(!buildCsp().includes("'unsafe-eval'"));
});

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"\\])\/\/.*$/gm, '$1');
}

test('every https origin in client-reachable source is allowed or link-only', () => {
  const connect = buildCsp().split('; ').find((d) => d.startsWith('connect-src')).split(' ');
  const found = new Map();
  for (const r of ROOTS) {
    const { files } = walk(path.join(ROOT, r), { lazy: true });
    for (const f of files) {
      const src = stripComments(readFileSync(path.join(ROOT, f), 'utf8'));
      for (const m of src.matchAll(/https:\/\/[A-Za-z0-9.-]+/g)) {
        if (!found.has(m[0])) found.set(m[0], f);
      }
    }
  }
  const missing = [...found].filter(([o]) => !connect.includes(o) && !NOT_FETCHED.has(o));
  assert.deepEqual(missing, [], `origins not in connect-src or NOT_FETCHED: ${missing.map(([o, f]) => `${o} (${f})`).join(', ')}`);
});

test('CSP allows OpenFreeMap tiles', () => {
  const dirs = buildCsp().split('; ');
  for (const name of ['connect-src', 'img-src']) {
    const d = dirs.find((x) => x.startsWith(name));
    assert.ok(d.split(' ').includes('https://tiles.openfreemap.org'), name);
  }
});
