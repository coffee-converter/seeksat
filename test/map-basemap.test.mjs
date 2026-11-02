import test from 'node:test';
import assert from 'node:assert/strict';
import { basemapStyle, basemapColors, OPENFREEMAP } from '../lib/map/basemap.mjs';

const THEMES = ['light', 'dark'];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const theme of THEMES) {
  test(`basemap styles load only from OpenFreeMap (${theme})`, () => {
    const urls = strings(basemapStyle(theme)).filter((s) => /^https?:/.test(s));
    assert.ok(urls.length > 0);
    for (const u of urls) assert.ok(u.startsWith(`${OPENFREEMAP}/`), u);
  });

  test(`basemap styles keep the layers the map relies on (${theme})`, () => {
    const style = basemapStyle(theme);
    const ids = style.layers.map((l) => l.id);
    assert.ok(ids.includes('background'));
    assert.ok(ids.includes('water'));
    assert.ok(style.glyphs);
    assert.ok(style.sprite);
  });

  test(`basemapColors reads water and land (${theme})`, () => {
    const { water, land } = basemapColors(theme);
    assert.match(water, /^#[0-9a-f]{6}$/i);
    assert.match(land, /^#[0-9a-f]{6}$/i);
  });

  test(`basemapStyle returns a fresh copy (${theme})`, () => {
    const a = basemapStyle(theme);
    a.layers.length = 0;
    a.glyphs = 'x';
    const b = basemapStyle(theme);
    assert.ok(b.layers.length > 0);
    assert.notEqual(b.glyphs, 'x');
  });
}

test('dark water is darker than dark land', () => {
  const { water, land } = basemapColors('dark');
  assert.ok(luminance(water) < luminance(land));
});

test('the dark style has no Natural Earth raster', () => {
  const style = basemapStyle('dark');
  assert.equal(style.sources.ne2_shaded, undefined);
  assert.ok(!style.layers.some((l) => l.source === 'ne2_shaded'));
});
