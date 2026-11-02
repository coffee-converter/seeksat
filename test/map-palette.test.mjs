import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAT_PALETTE, SAT_PALETTES, emphasisOf } from '../lib/map/palette.mjs';
// Ocean colours stay in draw.mjs until the basemap replaces it.
import { MAP_PALETTES } from '../lib/map/draw.mjs';

test('SAT_PALETTE has the scene colours', () => {
  assert.equal(SAT_PALETTE.length, 8);
  assert.equal(SAT_PALETTE[0], '#ff9b54');
});

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('every light satellite colour has 3:1 contrast on the light ocean', () => {
  for (const c of SAT_PALETTES.light) {
    assert.ok(ratio(c, MAP_PALETTES.light.ocean) >= 3, `${c} is ${ratio(c, MAP_PALETTES.light.ocean).toFixed(2)}`);
  }
});

test('no two satellite colours are close, in either theme', () => {
  // OKLab distance x100, the same measure the palette was picked with.
  const lin = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lab = (h) => {
    const [r, g, b] = lin(h);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  for (const [theme, pal] of Object.entries(SAT_PALETTES)) {
    assert.equal(pal.length, 8);
    for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) {
      const [a, b] = [lab(pal[i]), lab(pal[j])];
      const d = 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(d >= 12.5, `${theme} ${pal[i]} vs ${pal[j]}: ${d.toFixed(1)}`);
    }
  }
});

test('emphasisOf defaults to focus when selected, else normal', () => {
  assert.equal(emphasisOf({ selected: true }), 'focus');
  assert.equal(emphasisOf({}), 'normal');
  assert.equal(emphasisOf({ selected: true, emphasis: 'ghost' }), 'ghost');
});
