import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, walk, reachable } from './helpers/import-graph.mjs';

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

const PLACE_DATA = ['lib/map/places.json', 'lib/map/regions.mjs'];

test('no entry reaches the place data statically', () => {
  const entries = [
    ...appEntries(path.join(ROOT, 'app')),
    path.join(ROOT, 'components/home/HomeApp.tsx'),
    path.join(ROOT, 'components/sat/SatApp.tsx'),
  ];
  for (const entry of entries) {
    const { files } = walk(entry);
    const hit = PLACE_DATA.filter((f) => files.has ? files.has(f) : [...files].includes(f));
    assert.deepEqual(hit, [], `${path.relative(ROOT, entry)} reaches: ${hit.join(', ')}`);
  }
});

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
