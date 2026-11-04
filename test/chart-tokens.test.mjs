import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHART_CANVAS } from '../lib/pass-finder/chart-canvas.js';
import { chartCssVars, chartTokenCss } from '../lib/ui/chart-tokens.mjs';
import { MODAL_SVG_STYLE } from '../lib/pass-finder/polar-modal-frame.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The always-dark chart dialogs sit on the painted charts' own canvas colour.
// One constant feeds the sky chart, the radio chart and --modal-dark-bg.

test('--modal-dark-bg is generated from the chart canvas constant', () => {
  assert.equal(chartCssVars()['--modal-dark-bg'], CHART_CANVAS);
  assert.match(chartTokenCss(), /^:root,\.theme-dark\{--modal-dark-bg:#[0-9a-f]{6}\}$/);
  const css = read('app/globals.css');
  assert.doesNotMatch(css, /--modal-dark-bg\s*:/, '--modal-dark-bg is defined only in lib/ui/chart-tokens.mjs');
  assert.match(read('app/layout.tsx'), /chartTokenCss\(\)/);
});

test('both chart painters fill their canvas with CHART_CANVAS', () => {
  assert.match(MODAL_SVG_STYLE, new RegExp(`\\.bg \\{ fill: ${CHART_CANVAS}; \\}`));
  assert.match(read('lib/pass-finder/radio-chart.js'), /\.rc-canvas \{ fill: \$\{CHART_CANVAS\}; \}/);
  for (const f of ['lib/pass-finder/polar-modal-frame.js', 'lib/pass-finder/radio-chart.js']) {
    assert.ok(!read(f).toLowerCase().includes(CHART_CANVAS.toLowerCase()), `${f} has no literal copy of the canvas colour`);
  }
});
