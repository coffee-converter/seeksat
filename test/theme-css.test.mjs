import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every page colour comes from a theme token (app/globals.css), except the
// chart block: the sky chart, radio chart and pass-card polar plots keep their
// literal dark colours in both themes.

const FILES = ['app/globals.css', 'app/home.css', 'app/sat.css', 'app/mcp/mcp.css'];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const TOKENS_BEGIN = '/* theme-tokens:begin */';
const TOKENS_END = '/* theme-tokens:end */';
const CHART_BEGIN = '/* chart-block:begin */';
const CHART_END = '/* chart-block:end */';

// Blank a span but keep its newlines, so line numbers still match the file.
const blank = (s) => s.replace(/[^\n]/g, ' ');

function blankRegions(css, begin, end) {
  let out = '';
  let at = 0;
  for (;;) {
    const b = css.indexOf(begin, at);
    if (b < 0) break;
    const e = css.indexOf(end, b);
    assert.ok(e > b, `unclosed ${begin}`);
    out += css.slice(at, b) + blank(css.slice(b, e + end.length));
    at = e + end.length;
  }
  return out + css.slice(at);
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, blank);

function regions(css, begin, end) {
  const found = [];
  let at = 0;
  for (;;) {
    const b = css.indexOf(begin, at);
    if (b < 0) return found;
    const e = css.indexOf(end, b);
    found.push(css.slice(b + begin.length, e));
    at = e + end.length;
  }
}

/** Colour literals in declaration values, as "file:line  property: value". */
function literalsIn(file) {
  let css = read(file);
  css = blankRegions(css, TOKENS_BEGIN, TOKENS_END);
  css = blankRegions(css, CHART_BEGIN, CHART_END);
  css = stripComments(css);
  const found = [];
  const decl = /[{;]\s*([-\w]+)\s*:\s*([^;{}]*)/g;
  for (const m of css.matchAll(decl)) {
    const value = m[2];
    const lit = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*(?!var\()/;
    if (!lit.test(value)) continue;
    const line = css.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length;
    found.push(`${file}:${line}  ${m[1]}: ${value.trim()}`);
  }
  return found;
}

test('outside the chart block and the token definitions, no colour literals', () => {
  const found = FILES.flatMap(literalsIn);
  assert.deepEqual(found, [], `colour literals left:\n${found.join('\n')}`);
});

test('the chart block holds the chart rules, and none sit outside it', () => {
  const home = read('app/home.css');
  const globals = read('app/globals.css');
  const chart = [...regions(home, CHART_BEGIN, CHART_END), ...regions(globals, CHART_BEGIN, CHART_END)].join('\n');
  for (const sel of ['.polar-modal-content', '.radio-modal-content', '.radio-freq-select', '.pass-card__plot .polar-plot', '.polar-plot .horizon']) {
    assert.ok(chart.includes(sel), `${sel} is in the chart block`);
  }
  for (const file of FILES) {
    const outside = stripComments(blankRegions(read(file), CHART_BEGIN, CHART_END));
    assert.doesNotMatch(outside, /\.(?:polar-modal|radio-modal|radio-|polar-plot)[\w-]*/, `${file}: chart selectors outside the block`);
  }
  // The modals paint their own opaque dark background, whatever the page.
  for (const sel of ['.polar-modal-content', '.radio-modal-content']) {
    const rule = chart.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))[1];
    assert.match(rule, /background:\s*#[0-9a-fA-F]{6};/, `${sel} has an opaque dark background`);
  }
});

// --- Token values and contrast -------------------------------------------

function parseTokens() {
  const block = regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n');
  const css = stripComments(block);
  const themes = {};
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    const vars = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
    if (/data-theme='light'/.test(sel)) themes.light = { ...themes.light, ...vars };
    if (/data-theme='dark'/.test(sel)) themes.dark = { ...themes.dark, ...vars };
  }
  // The dark block also matches :root, so light inherits what it leaves out.
  return { dark: themes.dark, light: themes.dark && themes.light && { ...themes.dark, ...themes.light } };
}

const THEMES = parseTokens();

function resolve(vars, value, depth = 0) {
  assert.ok(depth < 10, `var() loop in ${value}`);
  const out = value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(name in vars, `token ${name} is defined`);
    return resolve(vars, vars[name], depth + 1);
  });
  return out;
}

/** [r, g, b, a] with r,g,b in 0..255 and a in 0..1. Handles #rgb, #rrggbb and rgb(a). */
function parseColor(str) {
  const s = str.trim();
  let m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return [...m.slice(1, 4).map((h) => parseInt(h + h, 16)), 1];
  m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [...m.slice(1, 4).map((h) => parseInt(h, 16)), 1];
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`cannot parse colour ${str}`);
}

/** Paint `top` over an opaque `bottom`. */
function over(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour from a token value, or an expression like rgba(var(--x-rgb), 0.1). */
function color(theme, expr, base) {
  const vars = THEMES[theme];
  const raw = expr.startsWith('--') ? `var(${expr})` : expr;
  const c = parseColor(resolve(vars, raw));
  if (c[3] === 1) return c;
  assert.ok(base, `${expr} is translucent and needs a background`);
  return over(c, base);
}

/** Contrast of fg on bg; bg may itself be translucent over `under`. */
function contrast(theme, fg, bg, under) {
  const b = color(theme, bg, under && color(theme, under));
  return ratio(color(theme, fg, b), b);
}

test('the token blocks define the minimum set in both themes', () => {
  const need = ['--bg', '--panel', '--panel-2', '--border', '--text', '--text-strong', '--muted', '--accent',
    '--accent-strong', '--danger', '--warn', '--ok', '--focus-ring', '--shadow', '--chip-bg', '--chip-border',
    '--input-bg', '--input-border', '--map-ocean', '--map-land', '--map-accent', '--map-text', '--map-muted',
    '--map-panel', '--map-border', '--map-night', '--map-footprint'];
  for (const theme of ['dark', 'light']) {
    assert.ok(THEMES[theme], `${theme} tokens found`);
    for (const t of need) assert.ok(t in THEMES[theme], `${theme} defines ${t}`);
  }
});

// The satellite page's cards and the home chrome use these, so they stay
// aliases of the site tokens in both themes; map-only colours get their own.
test('the map text, muted and border tokens alias the site tokens', () => {
  for (const theme of ['dark', 'light']) {
    assert.equal(THEMES[theme]['--map-text'], 'var(--text)', `${theme} --map-text`);
    assert.equal(THEMES[theme]['--map-muted'], 'var(--muted)', `${theme} --map-muted`);
    assert.equal(THEMES[theme]['--map-border'], 'var(--border)', `${theme} --map-border`);
  }
});

test('light uses the cool paper palette', () => {
  const L = THEMES.light;
  assert.equal(L['--bg'], '#f5f7fb');
  assert.equal(L['--panel'], '#ffffff');
  assert.equal(L['--panel-2'], '#eef2f8');
  assert.equal(L['--border'], 'rgba(15, 30, 60, 0.12)');
  assert.equal(L['--text'], '#1b2333');
  assert.equal(L['--text-strong'], '#0b1220');
  assert.equal(L['--muted'], '#5b6780');
  assert.equal(L['--accent'], '#1f5fbf');
});

test('the colour parser handles #rgb, #rrggbb and composites rgba', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#0a0e1a'), [10, 14, 26, 1]);
  assert.deepEqual(over(parseColor('rgba(0, 0, 0, 0.5)'), [255, 255, 255, 1]), [127.5, 127.5, 127.5, 1]);
  assert.equal(ratio([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
});

for (const theme of ['dark', 'light']) {
  test(`${theme}: required contrast`, () => {
    const check = (fg, bg, min, under) => {
      const r = contrast(theme, fg, bg, under);
      assert.ok(r >= min, `${theme}: ${fg} on ${bg}${under ? ` over ${under}` : ''} is ${r.toFixed(2)}, needs ${min}`);
    };
    check('--text', '--bg', 4.5);
    check('--text', '--panel', 4.5);
    check('--muted', '--panel', 3);
    check('--accent', '--panel', 4.5);
  });

  test(`${theme}: status text, badges and focus rings`, () => {
    const check = (fg, bg, min, under) => {
      const r = contrast(theme, fg, bg, under);
      assert.ok(r >= min, `${theme}: ${fg} on ${bg}${under ? ` over ${under}` : ''} is ${r.toFixed(2)}, needs ${min}`);
    };
    for (const page of ['--bg', '--panel']) {
      check('--text-strong', page, 4.5);
      check('--muted', page, 4.5);
      check('--accent', page, 4.5);
      check('--ok', page, 4.5); // LIVE label
      check('--warn', page, 4.5);
      check('--danger-text', page, 4.5);
      check('--teal', page, 4.5);
      check('--faint', page, 3);
      check('--focus-ring', page, 3);
      check('--badge-old-text', 'rgba(var(--warn-rgb), 0.14)', 4.5, page);
      check('--badge-stale-text', 'rgba(var(--danger-rgb), 0.14)', 4.5, page);
      check('--warn-text', 'rgba(var(--warn-rgb), 0.08)', 4.5, page);
      check('--danger-soft-text', 'rgba(var(--danger-rgb), 0.1)', 4.5, page);
      check('--accent-strong', 'rgba(var(--accent-rgb), 0.22)', 4.5, page);
      check('--flash-text', '--flash-bg', 4.5, page);
    }
    check('--text', '--map-panel', 4.5, '--map-ocean');
    check('--text', '--input-bg', 4.5);
    check('--text', '--tile-bg', 4.5);
    check('--text-strong', '--tile-hover', 4.5);
  });
}

// Colour keywords (black, white) are allowed only inside `@media print`,
// where the pass sheet forces black on white whatever the theme.
test('colour keywords appear only inside @media print', () => {
  const found = [];
  for (const file of FILES) {
    let css = stripComments(blankRegions(blankRegions(read(file), TOKENS_BEGIN, TOKENS_END), CHART_BEGIN, CHART_END));
    // Blank each `@media print { ... }` block (brace matched).
    for (let at = css.indexOf('@media print'); at >= 0; at = css.indexOf('@media print')) {
      let depth = 0;
      let i = css.indexOf('{', at);
      const start = i;
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) break;
      }
      css = css.slice(0, at) + blank(css.slice(at, i + 1)) + css.slice(i + 1);
      assert.ok(start > at);
    }
    for (const m of css.matchAll(/[{;]\s*([-\w]+)\s*:\s*([^;{}]*)/g)) {
      if (/(?<![-\w])(?:black|white|gray|grey|red|blue|green)(?![-\w])/.test(m[2])) found.push(`${file}: ${m[1]}: ${m[2].trim()}`);
    }
  }
  assert.deepEqual(found, [], `colour keywords outside @media print:\n${found.join('\n')}`);
});
