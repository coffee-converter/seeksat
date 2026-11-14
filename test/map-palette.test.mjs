import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAT_PALETTE, SAT_PALETTES, SAT_CASING, SAT_LABEL_INK, SAT_LABEL_HALO, labelInkOf, emphasisOf } from '../lib/map/palette.mjs';
import { basemapColors } from '../lib/map/basemap.mjs';
import { PASS_COLOR } from '../lib/og/globe-card.mjs';

test('one palette of ten, led by the SeekSat orange the share images use', () => {
  assert.equal(SAT_PALETTE.length, 10);
  assert.equal(SAT_PALETTE[0], '#ff9b54');
  assert.equal(PASS_COLOR, SAT_PALETTE[0]);
  assert.equal(new Set(SAT_PALETTE).size, 10);
  assert.equal(SAT_PALETTES.dark, SAT_PALETTE);
  assert.equal(SAT_PALETTES.light, SAT_PALETTE);
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

for (const theme of ['dark', 'light']) {
  test(`every satellite colour has 3:1 contrast on the ${theme} casing, which stands out from the ${theme} basemap`, () => {
    const casing = SAT_CASING[theme];
    for (const c of SAT_PALETTE) assert.ok(ratio(c, casing) >= 3, `${c} on ${casing} is ${ratio(c, casing).toFixed(2)}`);
    // The casing is the dark map's water; on the light map it is a dark edge on pale land and water.
    if (theme === 'dark') assert.equal(casing, basemapColors('dark').water);
    else for (const bg of [basemapColors('light').water, basemapColors('light').land]) assert.ok(ratio(casing, bg) >= 3, `${casing} on ${bg}`);
  });
}

test('no two satellite colours are close, in normal vision or simulated deuteranopia or protanopia', () => {
  // OKLab distance x100, the same measure the palette was picked with.
  const lin = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  // Machado et al. (2009) at full severity, applied in linear RGB.
  const CVD = {
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  };
  const see = (h, m) => { const v = lin(h); return m ? CVD[m].map((r) => Math.min(1, Math.max(0, r[0] * v[0] + r[1] * v[1] + r[2] * v[2]))) : v; };
  const labOf = ([r, g, b]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const pal = SAT_PALETTE;
  for (const mode of [null, 'deutan', 'protan']) {
    for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) {
      const [a, b] = [labOf(see(pal[i], mode)), labOf(see(pal[j], mode))];
      const d = 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(d >= 10, `${mode ?? 'normal'} ${pal[i]} vs ${pal[j]}: ${d.toFixed(1)}`);
      // Not told apart by lightness alone: hue or saturation differs too.
      if (!mode) assert.ok(100 * Math.hypot(a[1] - b[1], a[2] - b[2]) >= 8, `${pal[i]} vs ${pal[j]} differ only in lightness`);
    }
  }
  // Fewer satellites get wider spacing: the first three are far apart.
  const first = pal.slice(0, 3).map((h) => labOf(see(h)));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(100 * Math.hypot(...first[i].map((x, k) => x - first[j][k])) >= 20);
});

test('emphasisOf defaults to focus when selected, else normal', () => {
  assert.equal(emphasisOf({ selected: true }), 'focus');
  assert.equal(emphasisOf({}), 'normal');
  assert.equal(emphasisOf({ selected: true, emphasis: 'ghost' }), 'ghost');
});

test('light-map label inks: one per colour, in order, each 4.5:1 on the label halo', () => {
  assert.equal(SAT_LABEL_INK.length, SAT_PALETTE.length);
  for (const ink of SAT_LABEL_INK) assert.ok(ratio(ink, SAT_LABEL_HALO.light) >= 4.5, `${ink}: ${ratio(ink, SAT_LABEL_HALO.light).toFixed(2)}`);
  assert.equal(labelInkOf(SAT_PALETTE[0].toUpperCase()), SAT_LABEL_INK[0]);
  assert.equal(labelInkOf('#123456'), '#123456');
  assert.equal(SAT_LABEL_HALO.dark, SAT_CASING.dark);
});
