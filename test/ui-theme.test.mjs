import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_KEY, MODES, parseMode, resolveTheme, readMode, writeMode, applyTheme, THEME_SCRIPT,
} from '../lib/ui/theme.mjs';

test('constants', () => {
  assert.equal(THEME_KEY, 'seeksat.theme');
  assert.deepEqual(MODES, ['auto', 'light', 'dark']);
});

test('parseMode', () => {
  for (const m of MODES) assert.equal(parseMode(m), m);
  for (const bad of [null, undefined, '', 'LIGHT', 'blue', 5, {}]) assert.equal(parseMode(bad), 'auto');
});

test('resolveTheme covers all combinations', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('dark', false), 'dark');
});

const throwing = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};

test('readMode / writeMode', () => {
  const data = {};
  const store = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
  assert.equal(readMode(store), 'auto');
  writeMode('light', store);
  assert.equal(data[THEME_KEY], 'light');
  assert.equal(readMode(store), 'light');
  data[THEME_KEY] = 'junk';
  assert.equal(readMode(store), 'auto');
});

test('readMode / writeMode survive a throwing storage', () => {
  assert.equal(readMode(throwing), 'auto');
  assert.doesNotThrow(() => writeMode('dark', throwing));
  assert.equal(readMode(null), 'auto');
});

function fakeMeta(media) {
  const attrs = { name: 'theme-color', content: '', media };
  return {
    attrs,
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
  };
}

function fakeDoc(withMetas = true) {
  const metas = withMetas
    ? [fakeMeta('(prefers-color-scheme: dark)'), fakeMeta('(prefers-color-scheme: light)')]
    : [];
  return {
    documentElement: { dataset: {} },
    querySelectorAll: () => metas,
    createElement: () => fakeMeta(undefined),
    head: { appendChild: (m) => metas.push(m) },
    metas,
  };
}

test('applyTheme sets data-theme and every theme-color tag', () => {
  const d = fakeDoc();
  applyTheme(d, 'light');
  assert.equal(d.documentElement.dataset.theme, 'light');
  for (const m of d.metas) {
    assert.equal(m.attrs.content, '#f5f7fb');
    assert.equal('media' in m.attrs, false);
  }
  applyTheme(d, 'dark');
  assert.equal(d.documentElement.dataset.theme, 'dark');
  for (const m of d.metas) assert.equal(m.attrs.content, '#0a0e1a');
});

test('applyTheme creates a theme-color tag when none exists', () => {
  const d = fakeDoc(false);
  applyTheme(d, 'light');
  assert.equal(d.metas.length, 1);
  assert.equal(d.metas[0].attrs.content, '#f5f7fb');
});

function runScript({ saved, systemDark, storageThrows = false }) {
  const doc = fakeDoc();
  const localStorage = storageThrows ? throwing : { getItem: () => saved ?? null };
  const matchMedia = () => ({ matches: systemDark });
  new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT)(doc, localStorage, matchMedia);
  return doc;
}

test('THEME_SCRIPT', () => {
  const theme = (o) => runScript(o).documentElement.dataset.theme;
  assert.equal(theme({ saved: 'light', systemDark: true }), 'light');
  assert.equal(theme({ saved: 'dark', systemDark: false }), 'dark');
  assert.equal(theme({ saved: null, systemDark: false }), 'light');
  assert.equal(theme({ saved: null, systemDark: true }), 'dark');
  assert.equal(theme({ saved: 'junk', systemDark: false }), 'light');
  assert.equal(theme({ systemDark: false, storageThrows: true }), 'dark');
});

test('THEME_SCRIPT updates every theme-color tag and drops media', () => {
  const d = runScript({ saved: 'light', systemDark: true });
  assert.equal(d.metas.length, 2);
  for (const m of d.metas) {
    assert.equal(m.attrs.content, '#f5f7fb');
    assert.equal('media' in m.attrs, false);
  }
});

test('THEME_SCRIPT defaults to dark when matchMedia throws', () => {
  const doc = fakeDoc();
  const f = new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT);
  f(doc, { getItem: () => null }, () => { throw new Error('no'); });
  assert.equal(doc.documentElement.dataset.theme, 'dark');
});
