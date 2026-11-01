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

export function applyTheme(doc, theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  doc.documentElement.dataset.theme = t;
  // Every theme-color tag (the viewport export renders one per scheme) gets the
  // resolved colour and loses its media query, so a forced theme wins.
  let metas = Array.from(doc.querySelectorAll('meta[name="theme-color"]'));
  if (!metas.length && doc.head && doc.createElement) {
    const m = doc.createElement('meta');
    m.setAttribute('name', 'theme-color');
    doc.head.appendChild(m);
    metas = [m];
  }
  for (const m of metas) {
    m.setAttribute('content', COLOR[t]);
    m.removeAttribute('media');
  }
}

// Pre-paint script (minified by hand). Uses only the globals document,
// localStorage and matchMedia. Any error means dark.
export const THEME_SCRIPT =
  '(function(){var t="dark";try{var m=localStorage.getItem("' + THEME_KEY + '");' +
  't=m==="light"||m==="dark"?m:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="dark"}' +
  'try{var d=document,c=t==="light"?"' + COLOR.light + '":"' + COLOR.dark + '",l=d.querySelectorAll(\'meta[name="theme-color"]\'),i;' +
  'd.documentElement.dataset.theme=t;' +
  'if(!l.length){var n=d.createElement("meta");n.setAttribute("name","theme-color");d.head.appendChild(n);l=[n]}' +
  'for(i=0;i<l.length;i++){l[i].setAttribute("content",c);l[i].removeAttribute("media")}}catch(e){}})();';
