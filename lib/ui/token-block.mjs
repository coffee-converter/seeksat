// lib/ui/token-block.mjs - reads the theme-tokens block of app/globals.css into
// plain sets of custom properties, for the design bible page. Pure: it takes
// the stylesheet text. It throws when the block is missing or comes out empty
// or short of key tokens, so a reformatted stylesheet fails the build instead
// of quietly rendering a partial page.

export const TOKENS_BEGIN = '/* theme-tokens:begin */';
export const TOKENS_END = '/* theme-tokens:end */';

// Tokens each set must hold; a parse that misses one is a parse that broke.
export const REQUIRED = {
  dark: ['--bg', '--panel', '--text', '--muted', '--accent', '--border'],
  light: ['--bg', '--panel', '--text', '--muted', '--accent', '--border'],
  scale: ['--font-sans', '--fs-md', '--fw-regular', '--sp-8', '--radius-md', '--dur-fast', '--ease', '--line-subtle'],
};

/** The text between the region markers, comments removed. */
export function tokenRegion(css) {
  const b = css.indexOf(TOKENS_BEGIN);
  const e = b < 0 ? -1 : css.indexOf(TOKENS_END, b);
  if (b < 0 || e < 0) throw new Error('app/globals.css: no theme-tokens:begin / theme-tokens:end region');
  return css.slice(b + TOKENS_BEGIN.length, e).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Custom properties of a declaration block, in order. The last one may omit its `;`. */
export function declarations(body) {
  const out = [];
  for (const part of body.split(';')) {
    const m = part.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/);
    if (m && m[2]) out.push([m[1], m[2]]);
  }
  return out;
}

/** Rules as { selector, media, vars }, with `@media` blocks unwrapped (braces matched). */
export function parseRules(css, media) {
  const out = [];
  let at = 0;
  for (;;) {
    const open = css.indexOf('{', at);
    if (open < 0) return out;
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}' && --depth === 0) break;
    }
    const selector = css.slice(at, open).trim().replace(/\s+/g, ' ');
    const body = css.slice(open + 1, close);
    if (selector.startsWith('@')) out.push(...parseRules(body, selector));
    else out.push({ selector, media, vars: declarations(body) });
    at = close + 1;
  }
}

const themeAttr = (name) => new RegExp(`data-theme\\s*=\\s*["']?${name}["']?\\s*\\]`);
const NIGHT = /data-night/;

/**
 * The token sets of app/globals.css:
 *   dark   - the dark block (it also matches :root, so it is the default)
 *   light  - what the light block sets (light inherits the rest from dark)
 *   scale  - theme-independent tokens (fonts, sizes, spacing, radii, motion, lines)
 *   reducedMotion - the prefers-reduced-motion overrides
 *   night  - the night vision rule's tokens
 * Each is an ordered array of [name, value]. Throws on a missing or short set.
 */
export function readTokenBlock(css) {
  const rules = parseRules(tokenRegion(css));
  const collect = (test) => rules.filter(test).flatMap((r) => r.vars);
  const sets = {
    dark: collect((r) => !r.media && themeAttr('dark').test(r.selector)),
    light: collect((r) => !r.media && themeAttr('light').test(r.selector)),
    scale: collect((r) => !r.media && !/data-theme/.test(r.selector) && !NIGHT.test(r.selector)),
    reducedMotion: collect((r) => !!r.media && /prefers-reduced-motion/.test(r.media)),
    night: collect((r) => !r.media && NIGHT.test(r.selector)),
  };
  const problems = [];
  for (const [set, keys] of Object.entries(REQUIRED)) {
    const names = new Set(sets[set].map(([n]) => n));
    if (!names.size) problems.push(`${set} is empty`);
    else {
      const missing = keys.filter((k) => !names.has(k));
      if (missing.length) problems.push(`${set} misses ${missing.join(', ')}`);
    }
  }
  if (problems.length) throw new Error(`app/globals.css theme-tokens block did not parse: ${problems.join('; ')}`);
  return sets;
}
