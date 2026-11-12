import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('.flat-map declares vh before the svh override', () => {
  const css = read('app/home.css');
  const block = css.match(/\.flat-map\s*\{([^}]*)\}/)[1];
  const vh = block.indexOf('height: max(220px, 50vh);');
  const svh = block.indexOf('height: max(220px, 50svh);');
  assert.ok(vh >= 0 && svh > vh);
});
test('the radio chart inputs are library fields, 16px on touch so phones do not zoom', () => {
  const src = read('components/passes/RadioChartModalView.tsx');
  assert.match(src, /<Field label="Downlink frequency" hideLabel>\s*<select\b/);
  assert.match(src, /<Field label="Custom downlink frequency in MHz" hideLabel>\s*<input\b/);
  assert.match(read('app/ui.css'), /@media \(pointer: coarse\) \{\s*\.field__control \{[^}]*font-size: var\(--fs-input\);/);
  assert.match(read('app/globals.css'), /--fs-input: 16px;/);
});

test('dialogs escape the phone panel: Modal portals into <body>, the panel makes no stacking context', () => {
  const modal = read('components/ui/Modal.tsx');
  assert.match(modal, /createPortal\(/);
  assert.match(modal, /document\.body,?\s*\)/);
  const panel = read('app/home.css').match(/\.map-shell:not\(\.sat\) \.map-shell__panel\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(panel, /z-index/);
});
