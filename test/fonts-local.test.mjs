import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// Atkinson Hyperlegible Next ships from the repo (app/fonts/, OFL) through
// next/font/local: no build-time fetch, no font drift. Latin is preloaded;
// latin-ext loads only when a page uses one of its characters.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const COMMIT = /COMMIT = "([0-9a-f]{40})"/;

/** The localFont({...}) call that sets `variable`, as source text. */
function callFor(src, variable) {
  const at = src.indexOf(`variable: "${variable}"`);
  assert.ok(at > 0, `a localFont call sets ${variable}`);
  const start = src.lastIndexOf('localFont(', at);
  const end = src.indexOf('});', at);
  return src.slice(start, end);
}

/** The RANGES dict of the build script, as { subset: "U+..., ..." }. */
function scriptRanges() {
  const py = read('scripts/build-atkinson-web.py');
  const out = {};
  for (const m of py.matchAll(/"(latin(?:-ext)?)": ((?:"[^"]*"\s*)+)/g)) out[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('');
  return out;
}

test('the root layout loads Atkinson through next/font/local, not Google', () => {
  const src = read('app/layout.tsx');
  assert.match(src, /import localFont from "next\/font\/local"/);
  assert.doesNotMatch(src, /next\/font\/google|fonts\.googleapis\.com/);
  assert.match(src, /className=\{`\$\{atkinson\.variable\} \$\{atkinsonExt\.variable\}`\}/);
});

test('latin is preloaded, latin-ext is not and has no fallback face of its own', () => {
  const src = read('app/layout.tsx');
  const latin = callFor(src, '--font-atkinson');
  const ext = callFor(src, '--font-atkinson-ext');
  assert.match(latin, /src: "\.\/fonts\/AtkinsonHyperlegibleNext-latin\.woff2"/);
  assert.doesNotMatch(latin, /preload: false/);
  assert.match(ext, /src: "\.\/fonts\/AtkinsonHyperlegibleNext-latin-ext\.woff2"/);
  assert.match(ext, /preload: false/);
  // Its own Arial fallback would cover every character and shadow the latin face.
  assert.match(ext, /adjustFontFallback: false/);
  // Per character, the stack tries latin-ext's range first, then latin (with its metric fallback).
  assert.match(read('app/globals.css'), /--font-sans: var\(--font-atkinson-ext\), var\(--font-atkinson\), /);
});

test('the unicode ranges in the layout match the build script', () => {
  const src = read('app/layout.tsx');
  const ranges = scriptRanges();
  assert.deepEqual(Object.keys(ranges), ['latin', 'latin-ext']);
  for (const [variable, subset] of [['--font-atkinson', 'latin'], ['--font-atkinson-ext', 'latin-ext']]) {
    const m = callFor(src, variable).match(/prop: "unicode-range", value: "([^"]+)"/);
    assert.ok(m, `${subset} declares its unicode-range`);
    assert.equal(m[1], ranges[subset], subset);
  }
  // The degree sign, middle dot and minus sign are in the preloaded latin file.
  for (const cp of ['U+0000-00FF', 'U+2212']) assert.ok(ranges.latin.includes(cp), cp);
});

test('the committed fonts are woff2 under the OFL, from the export script\'s pinned commit', () => {
  for (const f of ['AtkinsonHyperlegibleNext-latin.woff2', 'AtkinsonHyperlegibleNext-latin-ext.woff2']) {
    const buf = readFileSync(new URL(`../app/fonts/${f}`, import.meta.url));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', f);
  }
  assert.match(read('app/fonts/OFL.txt'), /SIL Open Font License, Version 1\.1/);
  const pinned = read('scripts/build-atkinson-embed.py').match(COMMIT)[1];
  assert.equal(read('scripts/build-atkinson-web.py').match(COMMIT)[1], pinned);
  assert.ok(existsSync(new URL('../app/fonts/README.md', import.meta.url)));
  assert.ok(read('app/fonts/README.md').includes(`https://github.com/google/fonts/raw/${pinned}/ofl/atkinsonhyperlegiblenext/`));
});
