import test from 'node:test';
import assert from 'node:assert/strict';
import { basemapStyle, basemapColors, basemapHex, OPENFREEMAP } from '../lib/map/basemap.mjs';
// The icon names in the OpenFreeMap sprite the styles name (sprites/ofm_f384/ofm.json).
import SPRITE_NAMES from './fixtures/ofm-sprite-names.json' with { type: 'json' };

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

  test(`basemap icons are all in the sprite (${theme})`, () => {
    // Literal icon names in icon-image; concat builds names from feature data.
    const names = (expr, out) => {
      if (typeof expr === 'string') { if (expr) out.add(expr); return out; }
      if (Array.isArray(expr) && !['concat', 'get', 'zoom'].includes(expr[0])) expr.slice(1).forEach((e) => names(e, out));
      return out;
    };
    const used = new Set();
    for (const layer of basemapStyle(theme).layers) {
      const icon = layer.layout?.['icon-image'];
      if (typeof icon === 'string') used.add(icon);
      else if (icon) names(icon, used);
    }
    assert.ok(used.size > 0);
    for (const name of used) assert.ok(SPRITE_NAMES.includes(name), `${name} is not in the sprite`);
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

  // A style with no projection loads as Mercator and clamps the camera to
  // Mercator's limits before the map can switch back to the globe.
  test(`basemapStyle carries the view's projection (${theme})`, () => {
    assert.deepEqual(basemapStyle(theme, 'globe').projection, { type: 'globe' });
    assert.deepEqual(basemapStyle(theme, 'flat').projection, { type: 'mercator' });
    assert.deepEqual(basemapStyle(theme).projection, { type: 'mercator' });
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

test('the --map-ocean and --map-land tokens match the basemap', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf('}', at));
  };
  const token = (body, name) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1].toLowerCase();
  for (const [theme, selector] of [['dark', ":root, :root[data-theme='dark']"], ['light', ":root[data-theme='light']"]]) {
    const body = block(selector);
    const { water, land } = basemapColors(theme);
    assert.equal(token(body, '--map-ocean'), water, `${theme} --map-ocean`);
    assert.equal(token(body, '--map-land'), land, `${theme} --map-land`);
  }
});

// The dark map is the light map recoloured, so both show the same labels at
// the same zooms (the old dark style labelled every city from zoom 0).
test('the dark map has the light map\'s layers, labels and zooms', () => {
  const light = basemapStyle('light');
  const dark = basemapStyle('dark');
  assert.deepEqual(dark.layers.map((l) => l.id), light.layers.map((l) => l.id));
  dark.layers.forEach((d, i) => {
    const l = light.layers[i];
    assert.deepEqual(
      { type: d.type, layout: d.layout, filter: d.filter, minzoom: d.minzoom, maxzoom: d.maxzoom, source: d.source },
      { type: l.type, layout: l.layout, filter: l.filter, minzoom: l.minzoom, maxzoom: l.maxzoom, source: l.source },
      d.id,
    );
  });
});

test('dark map labels are light text on dark halos', () => {
  const hex = (c) => basemapHex(c);
  for (const layer of basemapStyle('dark').layers) {
    if (layer.type !== 'symbol') continue;
    const { 'text-color': text, 'text-halo-color': halo } = layer.paint ?? {};
    if (typeof text === 'string') assert.ok(luminance(hex(text)) > 0.12, `${layer.id} text ${text}`);
    if (typeof halo === 'string') assert.ok(luminance(hex(halo)) < 0.02, `${layer.id} halo ${halo}`);
  }
});

test('every dark map fill and line is dark', () => {
  for (const layer of basemapStyle('dark').layers) {
    for (const prop of ['fill-color', 'line-color', 'background-color', 'fill-outline-color']) {
      const c = layer.paint?.[prop];
      if (typeof c === 'string') assert.ok(luminance(basemapHex(c)) < 0.06, `${layer.id} ${prop} ${c}`);
    }
  }
});

test('no view draws a sky or atmosphere', () => {
  for (const theme of ['dark', 'light']) {
    for (const view of ['flat', 'globe']) assert.equal(basemapStyle(theme, view).sky, undefined, `${theme} ${view}`);
  }
});
