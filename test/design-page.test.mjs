import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/import-graph.mjs';

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
  assert.match(read('app/design-27b284ec240e9ac9/page.tsx'), /theme-tokens:begin/);
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
