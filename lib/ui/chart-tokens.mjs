// lib/ui/chart-tokens.mjs - --modal-dark-bg, the always-dark chart dialogs'
// panel, as a CSS custom property generated from the charts' own canvas colour
// (lib/pass-finder/chart-canvas.js), so the two cannot drift. Theme-independent:
// the chart dialogs are dark in every theme. app/layout.tsx inlines chartTokenCss().
import { CHART_CANVAS } from '../pass-finder/chart-canvas.js';

/** The CSS custom properties the chart modules hold. */
export function chartCssVars() {
  return { '--modal-dark-bg': CHART_CANVAS };
}

/** As CSS. Selectors match the scale-token rule in app/globals.css. */
export function chartTokenCss() {
  const body = Object.entries(chartCssVars()).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root,.theme-dark{${body}}`;
}
