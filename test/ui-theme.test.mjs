import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_KEY, MODES, parseMode, resolveTheme, readMode, writeMode, applyTheme, syncTheme, THEME_SCRIPT,
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

function fakeMeta(attrs0 = {}) {
  const attrs = { ...attrs0 };
  return {
    attrs,
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
  };
}

function fakeDoc() {
  const nextDark = fakeMeta({ name: 'theme-color', content: '#0a0e1a', media: '(prefers-color-scheme: dark)' });
  const nextLight = fakeMeta({ name: 'theme-color', content: '#f5f7fb', media: '(prefers-color-scheme: light)' });
  const children = [nextDark, nextLight];
  return {
    documentElement: { dataset: {} },
    getElementById: (id) => children.find((m) => m.attrs.id === id) ?? null,
    createElement: () => fakeMeta(),
    head: {
      children,
      prepend: (m) => children.unshift(m),
      insertBefore: (m, ref) => children.splice(children.indexOf(ref) < 0 ? children.length : children.indexOf(ref), 0, m),
      get firstChild() { return children[0] ?? null; },
    },
    nextDark,
    nextLight,
  };
}

test('applyTheme sets data-theme and updates only the owned theme-color tag', () => {
  const d = fakeDoc();
  applyTheme(d, 'light');
  assert.equal(d.documentElement.dataset.theme, 'light');
  const own = d.head.children[0];
  assert.equal(own.attrs.id, 'seeksat-theme-color');
  assert.equal(own.attrs.content, '#f5f7fb');
  assert.equal(d.head.children.length, 3);
  applyTheme(d, 'dark');
  assert.equal(d.head.children.length, 3);
  assert.equal(own.attrs.content, '#0a0e1a');
  // Next's metas are untouched: media kept.
  assert.equal(d.nextDark.attrs.media, '(prefers-color-scheme: dark)');
  assert.equal(d.nextLight.attrs.media, '(prefers-color-scheme: light)');
  assert.equal(d.nextLight.attrs.content, '#f5f7fb');
});

test('syncTheme applies when data-theme is missing or stale, not otherwise', () => {
  const store = (v) => ({ getItem: () => v });
  const d = fakeDoc();
  assert.equal(syncTheme(d, store('light'), { matches: true }), 'light');
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.equal(d.head.children[0].attrs.content, '#f5f7fb');
  d.documentElement.dataset.theme = 'dark';
  syncTheme(d, store('light'), { matches: true });
  assert.equal(d.documentElement.dataset.theme, 'light');
  d.head.children[0].attrs.content = 'sentinel';
  syncTheme(d, store('light'), { matches: true });
  assert.equal(d.head.children[0].attrs.content, 'sentinel');
  const e = fakeDoc();
  assert.equal(syncTheme(e, store(null), { matches: false }), 'light');
  assert.equal(syncTheme(e, store(null), { matches: true }), 'dark');
  assert.equal(e.documentElement.dataset.theme, 'dark');
  assert.equal(syncTheme(fakeDoc(), throwing, { matches: false }), 'light');
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

test('THEME_SCRIPT prepends one owned theme-color tag and leaves Next metas alone', () => {
  const d = runScript({ saved: 'light', systemDark: true });
  assert.equal(d.head.children.length, 3);
  assert.equal(d.head.children[0].attrs.id, 'seeksat-theme-color');
  assert.equal(d.head.children[0].attrs.content, '#f5f7fb');
  assert.equal(d.nextDark.attrs.media, '(prefers-color-scheme: dark)');
  assert.equal(d.nextDark.attrs.content, '#0a0e1a');
});

test('THEME_SCRIPT defaults to dark when matchMedia throws', () => {
  const doc = fakeDoc();
  const f = new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT);
  f(doc, { getItem: () => null }, () => { throw new Error('no'); });
  assert.equal(doc.documentElement.dataset.theme, 'dark');
});
