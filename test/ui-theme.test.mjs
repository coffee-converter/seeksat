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

function fakeDoc() {
  const meta = { content: '' };
  return {
    documentElement: { dataset: {} },
    querySelector: () => meta,
    meta,
  };
}

test('applyTheme sets data-theme and theme-color', () => {
  const d = fakeDoc();
  applyTheme(d, 'light');
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.equal(d.meta.content, '#f5f7fb');
  applyTheme(d, 'dark');
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.equal(d.meta.content, '#0a0e1a');
  assert.doesNotThrow(() => applyTheme({ documentElement: { dataset: {} }, querySelector: () => null }, 'dark'));
});

function runScript({ saved, systemDark, storageThrows = false }) {
  const doc = fakeDoc();
  const localStorage = storageThrows ? throwing : { getItem: () => saved ?? null };
  const matchMedia = () => ({ matches: systemDark });
  new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT)(doc, localStorage, matchMedia);
  return doc.documentElement.dataset.theme;
}

test('THEME_SCRIPT', () => {
  assert.equal(runScript({ saved: 'light', systemDark: true }), 'light');
  assert.equal(runScript({ saved: 'dark', systemDark: false }), 'dark');
  assert.equal(runScript({ saved: null, systemDark: false }), 'light');
  assert.equal(runScript({ saved: null, systemDark: true }), 'dark');
  assert.equal(runScript({ saved: 'junk', systemDark: false }), 'light');
  assert.equal(runScript({ systemDark: false, storageThrows: true }), 'dark');
});

test('THEME_SCRIPT defaults to dark when matchMedia throws', () => {
  const doc = fakeDoc();
  const f = new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT);
  f(doc, { getItem: () => null }, () => { throw new Error('no'); });
  assert.equal(doc.documentElement.dataset.theme, 'dark');
});
