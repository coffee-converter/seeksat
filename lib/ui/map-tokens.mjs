// lib/ui/map-tokens.mjs - the --map-* colours the map modules also hold, as CSS
// custom properties. The map draws from lib/map/*.mjs; the legend and chrome
// read these, so the two cannot drift. app/layout.tsx inlines mapTokenCss().
import { basemapColors } from '../map/basemap.mjs';
import { overlayColors } from '../map/overlays.mjs';

/** The CSS custom properties for one theme. */
export function mapCssVars(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  const { water, land } = basemapColors(t);
  const { night, observer, casing } = overlayColors(t);
  // --sat-casing: the outline under satellite marks (lib/map/palette.mjs SAT_CASING).
  return { '--map-ocean': water, '--map-land': land, '--map-night': night, '--map-observer': observer, '--sat-casing': casing };
}

const block = (theme) => Object.entries(mapCssVars(theme)).map(([k, v]) => `${k}:${v}`).join(';');

/** Both themes as CSS. Selectors match the theme-token block in app/globals.css. */
export function mapTokenCss() {
  return `:root,:root[data-theme='dark'],.theme-dark{${block('dark')}}:root[data-theme='light']{${block('light')}}`;
}
