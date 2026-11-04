import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapCssVars, mapTokenCss } from '../lib/ui/map-tokens.mjs';
import { basemapColors } from '../lib/map/basemap.mjs';
import { overlayColors } from '../lib/map/overlays.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOKENS_BEGIN = '/* theme-tokens:begin */';
const TOKENS_END = '/* theme-tokens:end */';

test('map colours in CSS come from the map modules', () => {
  for (const t of ['dark', 'light']) {
    assert.equal(mapCssVars(t)['--map-ocean'], basemapColors(t).water);
    assert.equal(mapCssVars(t)['--map-land'], basemapColors(t).land);
    assert.equal(mapCssVars(t)['--map-night'], overlayColors(t).night);
    assert.equal(mapCssVars(t)['--map-observer'], overlayColors(t).observer);
  }
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf(TOKENS_BEGIN), css.indexOf(TOKENS_END));
  for (const k of Object.keys(mapCssVars('dark'))) assert.ok(!new RegExp(`${k}:`).test(block), `${k} is defined only in lib/ui/map-tokens.mjs`);
});

test('mapTokenCss uses the theme-token selectors', () => {
  const css = mapTokenCss();
  assert.ok(css.startsWith(":root,:root[data-theme='dark'],.theme-dark{"));
  assert.ok(css.includes(":root[data-theme='light']{"));
  assert.ok(css.includes(`--map-night:${overlayColors('light').night}`));
});

test('the legend draws the observer in the map\'s own observer colour', () => {
  const css = read('app/home.css');
  assert.match(css, /\.map-legend__swatch--observer\s*\{[^}]*color:\s*var\(--map-observer\)/);
});

test('no stylesheet token claims to keep in step with a JS copy', () => {
  assert.doesNotMatch(read('app/globals.css'), /keep in step/i);
});
