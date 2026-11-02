// Theme modes: auto (follow the system), light, dark. Saved in localStorage;
// the resolved theme goes on <html data-theme> before first paint.
export const THEME_KEY = 'seeksat.theme';
export const MODES = ['auto', 'light', 'dark'];

export const NIGHT_KEY = 'seeksat.night';

const COLOR = { dark: '#11151c', light: '#f3f5f8' };
const NIGHT_COLOR = '#1a0505';

export function parseMode(raw) {
  return MODES.includes(raw) ? raw : 'auto';
}

export function resolveTheme(mode, systemPrefersDark, night = false) {
  if (night) return 'dark';
  if (mode === 'light' || mode === 'dark') return mode;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readMode(storage = globalThis.localStorage) {
  try {
    return parseMode(storage.getItem(THEME_KEY));
  } catch {
    return 'auto';
  }
}

export function writeMode(mode, storage = globalThis.localStorage) {
  try {
    storage.setItem(THEME_KEY, parseMode(mode));
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

export function readNight(storage = globalThis.localStorage) {
  try {
    return storage.getItem(NIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeNight(on, storage = globalThis.localStorage) {
  try {
    if (on) storage.setItem(NIGHT_KEY, '1');
    else storage.removeItem(NIGHT_KEY);
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

const META_ID = 'seeksat-theme-color';

// Next's own theme-color metas (one per scheme) are left alone. We own one
// more, first in <head>, and only ever update that one.
export function applyTheme(doc, theme, night = false) {
  const t = theme === 'light' ? 'light' : 'dark';
  doc.documentElement.dataset.theme = t;
  if (night) doc.documentElement.dataset.night = '1';
  else delete doc.documentElement.dataset.night;
  let m = doc.getElementById ? doc.getElementById(META_ID) : null;
  if (!m && doc.head && doc.createElement) {
    m = doc.createElement('meta');
    m.setAttribute('name', 'theme-color');
    m.setAttribute('id', META_ID);
    if (doc.head.prepend) doc.head.prepend(m);
    else doc.head.appendChild(m);
  }
  if (m) m.setAttribute('content', night ? NIGHT_COLOR : COLOR[t]);
  return t;
}

// Apply a theme mode with the saved night vision setting, so changing the mode
// or the system colour scheme never drops night vision. Returns the theme.
export function applyMode(doc, mode, systemPrefersDark, storage = globalThis.localStorage) {
  const night = readNight(storage);
  return applyTheme(doc, resolveTheme(mode, systemPrefersDark, night), night);
}

// Make <html data-theme> match the saved mode and the system setting. Safe to
// call on every mount: it only writes when the attribute is missing or stale.
// Returns the resolved theme.
export function syncTheme(doc, storage, mq) {
  let dark = true;
  try { dark = !!mq.matches; } catch { dark = true; }
  const night = readNight(storage);
  const theme = resolveTheme(readMode(storage), dark, night);
  const ds = doc.documentElement.dataset;
  if (ds.theme !== theme || (ds.night === '1') !== night) applyTheme(doc, theme, night);
  return theme;
}

// Pre-paint script (minified by hand). Uses only the globals document,
// localStorage and matchMedia. Any error means dark; night forces dark.
export const THEME_SCRIPT =
  '(function(){var t="dark",o=0;try{o=localStorage.getItem("' + NIGHT_KEY + '")==="1"}catch(e){}try{var m=localStorage.getItem("' + THEME_KEY + '");' +
  't=o?"dark":m==="light"||m==="dark"?m:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="dark"}' +
  'try{var d=document,n=d.getElementById("' + META_ID + '");' +
  'd.documentElement.dataset.theme=t;if(o)d.documentElement.dataset.night="1";' +
  'if(!n){n=d.createElement("meta");n.setAttribute("name","theme-color");n.setAttribute("id","' + META_ID + '");d.head.insertBefore(n,d.head.firstChild)}' +
  'n.setAttribute("content",o?"' + NIGHT_COLOR + '":t==="light"?"' + COLOR.light + '":"' + COLOR.dark + '")}catch(e){}})();';
