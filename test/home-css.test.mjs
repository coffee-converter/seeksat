import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('.flat-map declares vh before the svh override', () => {
  const css = read('app/home.css');
  const block = css.match(/\.flat-map\s*\{([^}]*)\}/)[1];
  const vh = block.indexOf('height: max(220px, 50vh);');
  const svh = block.indexOf('height: max(220px, 50svh);');
  assert.ok(vh >= 0 && svh > vh);
});
test('coarse pointers get 16px chart inputs in both stylesheets', () => {
  const re = (sel) => new RegExp(`@media \\(pointer: coarse\\)\\s*\\{\\s*${sel}\\s*\\{\\s*font-size: 16px;\\s*\\}\\s*\\}`);
  assert.match(read('app/home.css'), re('\\.radio-freq-select, \\.radio-freq-input'));
  assert.match(read('app/pass-finder.css'), re('\\.radio-freq-select, \\.radio-freq-input, \\.radio-elev-input'));
});
