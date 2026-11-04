import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/import-graph.mjs';
import { readTokenBlock, declarations, REQUIRED } from '../lib/ui/token-block.mjs';

// The design bible reference page: unlisted, noindex, and built from the real
// token block rather than a copy of it.
const ROUTE = '/design-27b284ec240e9ac9';
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The Next config file, whatever its extension. */
function nextConfigPath() {
  const found = ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) => existsSync(path.join(ROOT, f)));
  assert.ok(found, 'a next.config file exists');
  return found;
}

const TEXT = /\.(tsx?|jsx?|mjs|cjs|css|json|txt|md|html|xml|webmanifest)$/;

function walk(dir) {
  const out = [];
  if (!existsSync(path.join(ROOT, dir))) return out;
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (TEXT.test(name)) out.push(rel);
  }
  return out;
}

/** Shipped source files (pages, components, libraries, public files) that mention `href`. */
function filesLinkingTo(href) {
  return ['app', 'components', 'lib', 'public'].flatMap(walk).filter((f) => read(f).includes(href));
}

test('the design page is unlisted and noindex', async () => {
  const page = read('app/design-27b284ec240e9ac9/page.tsx');
  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.doesNotMatch(read('app/sitemap.ts'), /design-/);
  assert.doesNotMatch(read('app/robots.ts'), /design-/);
  assert.match(read(nextConfigPath()), /design-27b284ec240e9ac9[\s\S]*X-Robots-Tag[\s\S]*noindex, nofollow/);
  assert.deepEqual(filesLinkingTo(ROUTE).filter((f) => !f.startsWith('app/design-')), []);
});

test('the design page renders tokens from globals.css, not a copy', () => {
  // The page names the region it reads; lib/ui/token-block.mjs does the reading.
  const page = read('app/design-27b284ec240e9ac9/page.tsx');
  assert.match(page, /theme-tokens:begin/);
  assert.match(page, /readTokenBlock\(readFileSync\([^;]*app\/globals\.css/);
  assert.match(read('lib/ui/token-block.mjs'), /theme-tokens:begin/);
});

test('the token block of the real app/globals.css parses into full sets', () => {
  const sets = readTokenBlock(read('app/globals.css'));
  for (const set of ['dark', 'light', 'scale', 'reducedMotion', 'night']) assert.ok(sets[set].length, `${set} is not empty`);
  for (const [set, keys] of Object.entries(REQUIRED)) {
    const names = sets[set].map(([n]) => n);
    for (const k of keys) assert.ok(names.includes(k), `${set} has ${k}`);
  }
  const dark = Object.fromEntries(sets.dark);
  assert.equal(dark['--bg'], '#11151c');
  assert.equal(Object.fromEntries(sets.light)['--bg'], '#f3f5f8');
  assert.equal(Object.fromEntries(sets.scale)['--fs-md'], '13px');
  assert.ok(Object.fromEntries(sets.night)['--night-filter']);
  // Every colour token in the stylesheet's dark block is found (none dropped).
  const region = read('app/globals.css').split('/* theme-tokens:begin */')[1].split('/* theme-tokens:end */')[0];
  const darkRule = region.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.theme-dark\s*\{([^}]*)\}/)[1];
  assert.equal(sets.dark.length, (darkRule.match(/--[\w-]+\s*:/g) || []).length);
});

test('the token reader takes other formatting and fails loudly on a broken block', () => {
  assert.deepEqual(declarations(' --a: 1px; --b: rgba(0, 0, 0, 0.5) '), [['--a', '1px'], ['--b', 'rgba(0, 0, 0, 0.5)']]);
  const scale = ':root { --font-sans: x; --fs-md: 13px; --fw-regular: 400; --sp-8: 8px; --radius-md: 6px; --dur-fast: 120ms; --ease: linear }\n:root, .theme-dark { --line-subtle: 1px solid var(--border) }';
  const theme = '--bg: #000; --panel: #111; --text: #eee; --muted: #999; --accent: #00f; --border: #222';
  const css = `/* theme-tokens:begin */\n:root, :root[data-theme="dark"], .theme-dark { ${theme} }\n:root[data-theme="light"] { ${theme} }\n${scale}\n/* theme-tokens:end */`;
  const sets = readTokenBlock(css);
  assert.equal(sets.dark.length, 6);
  assert.equal(sets.light.length, 6);
  assert.equal(Object.fromEntries(sets.scale)['--ease'], 'linear');
  assert.throws(() => readTokenBlock('body {}'), /theme-tokens/);
  assert.throws(() => readTokenBlock(css.replace(/data-theme="light"/, 'data-mode="light"')), /light is empty/);
  assert.throws(() => readTokenBlock(css.replace('--fs-md: 13px; ', '')), /scale misses --fs-md/);
});

test('the link scan sees shipped files', () => {
  const files = ['app', 'components', 'lib', 'public'].flatMap(walk);
  assert.ok(files.includes('components/home/HomeApp.tsx'));
  assert.ok(files.includes('app/layout.tsx'));
});

test('middleware does not catch the design page', () => {
  const m = read('middleware.ts').match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(m, 'middleware has a matcher');
  for (const p of m[1].match(/'[^']*'/g).map((s) => s.slice(1, -1))) {
    const re = new RegExp(`^${p.replace(/:path\*/g, '.*')}$`);
    assert.ok(!re.test(ROUTE), `${p} matches ${ROUTE}`);
  }
});

test('the design page has one h1 and reuses the site theme control state', () => {
  const src = read('app/design-27b284ec240e9ac9/DesignBible.tsx');
  assert.equal((src.match(/<h1\b/g) || []).length, 1);
  assert.match(src, /useThemeMode\(\)/);
  assert.doesNotMatch(src, /writeMode|applyMode/, 'theme saving lives in ThemeToggle');
});
