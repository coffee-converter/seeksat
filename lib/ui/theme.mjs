// Theme modes: auto (follow the system), light, dark. Saved in localStorage;
// the resolved theme goes on <html data-theme> before first paint.
export const THEME_KEY = 'seeksat.theme';
export const MODES = ['auto', 'light', 'dark'];

const COLOR = { dark: '#0a0e1a', light: '#f5f7fb' };

export function parseMode(raw) {
  return MODES.includes(raw) ? raw : 'auto';
}

export function resolveTheme(mode, systemPrefersDark) {
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

const META_ID = 'seeksat-theme-color';

// Next's own theme-color metas (one per scheme) are left alone. We own one
// more, first in <head>, and only ever update that one.
export function applyTheme(doc, theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  doc.documentElement.dataset.theme = t;
  let m = doc.getElementById ? doc.getElementById(META_ID) : null;
  if (!m && doc.head && doc.createElement) {
    m = doc.createElement('meta');
    m.setAttribute('name', 'theme-color');
    m.setAttribute('id', META_ID);
    if (doc.head.prepend) doc.head.prepend(m);
    else doc.head.appendChild(m);
  }
  if (m) m.setAttribute('content', COLOR[t]);
  return t;
}

// Make <html data-theme> match the saved mode and the system setting. Safe to
// call on every mount: it only writes when the attribute is missing or stale.
// Returns the resolved theme.
export function syncTheme(doc, storage, mq) {
  let dark = true;
  try { dark = !!mq.matches; } catch { dark = true; }
  const theme = resolveTheme(readMode(storage), dark);
  if (doc.documentElement.dataset.theme !== theme) applyTheme(doc, theme);
  return theme;
}

// Pre-paint script (minified by hand). Uses only the globals document,
// localStorage and matchMedia. Any error means dark.
export const THEME_SCRIPT =
  '(function(){var t="dark";try{var m=localStorage.getItem("' + THEME_KEY + '");' +
  't=m==="light"||m==="dark"?m:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="dark"}' +
  'try{var d=document,n=d.getElementById("' + META_ID + '");' +
  'd.documentElement.dataset.theme=t;' +
  'if(!n){n=d.createElement("meta");n.setAttribute("name","theme-color");n.setAttribute("id","' + META_ID + '");d.head.insertBefore(n,d.head.firstChild)}' +
  'n.setAttribute("content",t==="light"?"' + COLOR.light + '":"' + COLOR.dark + '")}catch(e){}})();';
