import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_KEY, MODES, parseMode, resolveTheme, readMode, writeMode, applyTheme, syncTheme, THEME_SCRIPT,
  NIGHT_KEY, readNight, writeNight,
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
  const nextDark = fakeMeta({ name: 'theme-color', content: '#11151c', media: '(prefers-color-scheme: dark)' });
  const nextLight = fakeMeta({ name: 'theme-color', content: '#f3f5f8', media: '(prefers-color-scheme: light)' });
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
  assert.equal(own.attrs.content, '#f3f5f8');
  assert.equal(d.head.children.length, 3);
  applyTheme(d, 'dark');
  assert.equal(d.head.children.length, 3);
  assert.equal(own.attrs.content, '#11151c');
  // Next's metas are untouched: media kept.
  assert.equal(d.nextDark.attrs.media, '(prefers-color-scheme: dark)');
  assert.equal(d.nextLight.attrs.media, '(prefers-color-scheme: light)');
  assert.equal(d.nextLight.attrs.content, '#f3f5f8');
});

test('syncTheme applies when data-theme is missing or stale, not otherwise', () => {
  const store = (v) => ({ getItem: () => v });
  const d = fakeDoc();
  assert.equal(syncTheme(d, store('light'), { matches: true }), 'light');
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.equal(d.head.children[0].attrs.content, '#f3f5f8');
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
  assert.equal(d.head.children[0].attrs.content, '#f3f5f8');
  assert.equal(d.nextDark.attrs.media, '(prefers-color-scheme: dark)');
  assert.equal(d.nextDark.attrs.content, '#11151c');
});

test('THEME_SCRIPT defaults to dark when matchMedia throws', () => {
  const doc = fakeDoc();
  const f = new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT);
  f(doc, { getItem: () => null }, () => { throw new Error('no'); });
  assert.equal(doc.documentElement.dataset.theme, 'dark');
});

test('resolveTheme forces dark in night vision', () => {
  assert.equal(resolveTheme('light', false, true), 'dark');
  assert.equal(resolveTheme('light', false, false), 'light');
});

test('readNight / writeNight round-trip and survive a throwing storage', () => {
  const data = {};
  const store = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
  assert.equal(NIGHT_KEY, 'seeksat.night');
  assert.equal(readNight(store), false);
  writeNight(true, store);
  assert.equal(data[NIGHT_KEY], '1');
  assert.equal(readNight(store), true);
  writeNight(false, store);
  assert.equal(NIGHT_KEY in data, false);
  assert.equal(readNight(store), false);
  assert.equal(readNight(throwing), false);
  assert.doesNotThrow(() => writeNight(true, throwing));
  assert.equal(readNight(null), false);
});

test('applyTheme sets and clears data-night and the night theme-color', () => {
  const d = fakeDoc();
  applyTheme(d, 'dark', true);
  assert.equal(d.documentElement.dataset.night, '1');
  assert.equal(d.head.children[0].attrs.content, '#1a0505');
  applyTheme(d, 'dark', false);
  assert.equal('night' in d.documentElement.dataset, false);
  assert.equal(d.head.children[0].attrs.content, '#11151c');
});

test('syncTheme follows night vision', () => {
  const store = (night) => ({ getItem: (k) => (k === NIGHT_KEY ? (night ? '1' : null) : 'light') });
  const d = fakeDoc();
  assert.equal(syncTheme(d, store(true), { matches: false }), 'dark');
  assert.equal(d.documentElement.dataset.night, '1');
  assert.equal(syncTheme(d, store(false), { matches: false }), 'light');
  assert.equal('night' in d.documentElement.dataset, false);
});

test('THEME_SCRIPT forces dark and sets data-night when night vision is on', () => {
  const doc = fakeDoc();
  const ls = { getItem: (k) => (k === NIGHT_KEY ? '1' : 'light') };
  new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT)(doc, ls, () => ({ matches: false }));
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(doc.documentElement.dataset.night, '1');
  assert.equal(doc.head.children[0].attrs.content, '#1a0505');
  const off = runScript({ saved: 'light', systemDark: true });
  assert.equal('night' in off.documentElement.dataset, false);
});
