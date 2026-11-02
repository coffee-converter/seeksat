// OpenFreeMap basemap styles, vendored so the map has no runtime style fetch.
import positron from './styles/positron.json' with { type: 'json' };
import dark from './styles/dark.json' with { type: 'json' };

export const OPENFREEMAP = 'https://tiles.openfreemap.org';

const STYLES = { light: positron, dark };

// MapLibre mutates the style it is given, so hand out a fresh copy each time.
export function basemapStyle(theme) {
  return structuredClone(STYLES[theme] ?? STYLES.light);
}

// Accepts '#rrggbb', 'rgb(r, g, b)' or 'rgb(r g b)'; returns '#rrggbb'.
function toHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (!m) throw new Error(`unsupported basemap colour: ${color}`);
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

export function basemapColors(theme) {
  const layers = (STYLES[theme] ?? STYLES.light).layers;
  const water = layers.find((l) => l.id === 'water').paint['fill-color'];
  const land = layers.find((l) => l.id === 'background').paint['background-color'];
  return { water: toHex(water), land: toHex(land) };
}
