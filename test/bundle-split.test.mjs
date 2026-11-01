import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs'];

function resolveSpec(spec, fromFile) {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  for (const e of EXTS) candidates.push(base + e);
  for (const e of EXTS.slice(1)) candidates.push(path.join(base, 'index' + e));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

// Static module specifiers: import ... from, side-effect imports, export ... from.
// `import type` lines and import() expressions are skipped.
function staticSpecs(src) {
  const specs = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === 'import' && m[2]) continue;
    if (m[1] === 'export' && m[2]) continue;
    // `export const x = ...` has no quoted spec directly; the regex only matches `from '...'` forms.
    specs.push(m[3]);
  }
  return specs;
}

// Local files reachable from entry, plus every package specifier they import.
function walk(entry) {
  const seen = new Set();
  const packages = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of staticSpecs(src)) {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) { packages.add(spec); continue; }
      const r = resolveSpec(spec, file);
      if (r) stack.push(r);
    }
  }
  return { files: new Set([...seen].map((f) => path.relative(ROOT, f))), packages };
}

function reachable(entry) {
  return walk(entry).files;
}

const CHART_MODULES = [
  'lib/passes/charts.js',
  'lib/pass-finder/radio-chart.js',
  'lib/pass-finder/constellations.js',
  'lib/pass-finder/star-catalog.js',
  'components/passes/RadioChartModalView.tsx',
];

for (const [label, entry] of [
  ['the home page', 'components/home/HomeApp.tsx'],
  ['the satellite page', 'components/sat/SatApp.tsx'],
]) {
  test(`${label} does not statically reach the chart painters`, () => {
    const set = reachable(path.join(ROOT, entry));
    const hit = CHART_MODULES.filter((b) => set.has(b));
    assert.deepEqual(hit, [], `reachable chart modules: ${hit.join(', ')}`);
  });

  test(`${label} does not statically reach Cesium`, () => {
    const { files, packages } = walk(path.join(ROOT, entry));
    const hit = [...files, ...packages].filter((p) => /cesium/i.test(p));
    assert.deepEqual(hit, [], `reachable Cesium modules: ${hit.join(', ')}`);
  });
}

test('the card painter does not reach charts.js', () => {
  const set = reachable(path.join(ROOT, 'lib/passes/card-chart.js'));
  assert.ok(!set.has('lib/passes/charts.js'));
});

function appEntries(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...appEntries(p));
    else if (/^(page|layout|route)\.(tsx|ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('no page, layout or route under app/ reaches the scene, Cesium or CesiumLoader', () => {
  const entries = appEntries(path.join(ROOT, 'app'));
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const { files, packages } = walk(entry);
    const hit = [...files, ...packages].filter((p) =>
      p === 'lib/pass-finder-scene.js' || /cesium/i.test(p) || p === 'components/CesiumLoader.tsx');
    assert.deepEqual(hit, [], `${path.relative(ROOT, entry)} reaches: ${hit.join(', ')}`);
  }
});
