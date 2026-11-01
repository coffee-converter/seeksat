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
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = COLOR[t];
}

// Pre-paint script (minified by hand). Uses only the globals document,
// localStorage and matchMedia. Any error means dark.
export const THEME_SCRIPT =
  '(function(){var t="dark";try{var m=localStorage.getItem("' + THEME_KEY + '");' +
  't=m==="light"||m==="dark"?m:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="dark"}' +
  'try{document.documentElement.dataset.theme=t;var c=document.querySelector(\'meta[name="theme-color"]\');' +
  'if(c)c.content=t==="light"?"' + COLOR.light + '":"' + COLOR.dark + '"}catch(e){}})();';
