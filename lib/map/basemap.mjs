// OpenFreeMap's Positron basemap, vendored so the map has no runtime style
// fetch. The dark map is Positron recoloured (darkFrom below), so both themes
// show the same labels at the same zooms.
import positron from './styles/positron.json' with { type: 'json' };

export const OPENFREEMAP = 'https://tiles.openfreemap.org';

// The dark map's land and water. The --map-land and --map-ocean tokens in
// app/globals.css match these (test/map-basemap.test.mjs).
const DARK_LAND = '#1b1e24';
const DARK_WATER = '#0e1116';

/** The dark colour for one paint colour of a Positron layer, by its role. */
function darkRole(id, prop) {
  if (prop.endsWith('halo-color')) return DARK_WATER;
  if (prop === 'text-color') {
    if (id.startsWith('water')) return '#5d6d8e';
    return /^label_(city|country|state|town|village|other)/.test(id) ? '#8a919b' : '#6b717b';
  }
  if (id === 'background' || id === 'road_area_pier' || id === 'road_pier') return DARK_LAND;
  if (id === 'water') return DARK_WATER;
  if (id === 'waterway') return '#141821';
  if (id.startsWith('boundary')) return '#3a3f48';
  if (id === 'building') return prop === 'fill-outline-color' ? DARK_WATER : '#171a1f';
  if (id.startsWith('landcover') || id.startsWith('landuse') || id === 'park') return '#1f2329';
  if (id.includes('casing')) return '#23272e';
  // Roads, rail and runways: a little lighter than the land.
  return '#2a2e35';
}

const COLOR_RE = /^(#[0-9a-f]{3,8}$|rgba?\(|hsla?\()/i;

/** The alpha of a CSS colour string (1 when it has none). */
function alphaOf(color) {
  const m = /^(?:rgba|hsla)\((.*)\)$/i.exec(color);
  if (!m) return 1;
  const a = Number(m[1].split(/[\s,/]+/).filter(Boolean)[3]);
  return Number.isFinite(a) ? a : 1;
}

/** Replace every colour in a paint value (a plain value or an expression). */
function recolor(value, id, prop) {
  if (typeof value === 'string' && COLOR_RE.test(value)) {
    const hex = darkRole(id, prop);
    const a = alphaOf(value);
    if (a >= 1) return hex;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (Array.isArray(value)) return value.map((v) => recolor(v, id, prop));
  return value;
}

/** Positron with every paint colour swapped for its dark role, and without
 *  the Natural Earth raster (Positron does not draw it either). */
function darkFrom(light) {
  const style = structuredClone(light);
  delete style.sources.ne2_shaded;
  style.name = 'SeekSat dark (from Positron)';
  for (const layer of style.layers) {
    if (!layer.paint) continue;
    for (const [prop, v] of Object.entries(layer.paint)) layer.paint[prop] = recolor(v, layer.id, prop);
  }
  return style;
}

const STYLES = { light: positron, dark: darkFrom(positron) };

// MapLibre mutates the style it is given, so hand out a fresh copy each time.
// view is 'flat', 'globe' or 'satview' (lib/map/view.mjs). The style names its
// projection: without one MapLibre loads it as Mercator and clamps the camera to
// Mercator's limits (a globe at the pole jumps to the equator).
export function basemapStyle(theme, view = 'flat') {
  const style = structuredClone(STYLES[theme] ?? STYLES.light);
  const projection = { globe: 'globe', satview: 'vertical-perspective' }[view] ?? 'mercator';
  style.projection = { type: projection };
  return style;
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');

/** '#rgb', '#rrggbb', 'rgb()', 'rgba()', 'hsl()' or 'hsla()' as '#rrggbb' (alpha dropped). */
export function basemapHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => hex2(Number(n))).join('')}`;
  const hsl = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(color);
  if (hsl) {
    const [h, sat, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return `#${[f(0), f(8), f(4)].map((v) => hex2(v * 255)).join('')}`;
  }
  throw new Error(`unsupported basemap colour: ${color}`);
}
const toHex = basemapHex;

export function basemapColors(theme) {
  const layers = (STYLES[theme] ?? STYLES.light).layers;
  const water = layers.find((l) => l.id === 'water').paint['fill-color'];
  const land = layers.find((l) => l.id === 'background').paint['background-color'];
  return { water: toHex(water), land: toHex(land) };
}
