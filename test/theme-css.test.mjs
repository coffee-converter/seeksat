import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mapCssVars } from '../lib/ui/map-tokens.mjs';
import { chartCssVars } from '../lib/ui/chart-tokens.mjs';

// Every page colour comes from a theme token (app/globals.css), except the
// chart block: the sky chart, radio chart and pass-card polar plots keep their
// literal dark colours in both themes.

const FILES = ['app/globals.css', 'app/home.css', 'app/sat.css', 'app/mcp/mcp.css', 'app/ui.css', 'app/design-27b284ec240e9ac9/bible.css'];
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

/** Css with tokens, chart blocks, `@media print` blocks and comments blanked (line numbers kept). */
function liveCss(file) {
  let css = stripComments(blankRegions(blankRegions(read(file), TOKENS_BEGIN, TOKENS_END), CHART_BEGIN, CHART_END));
  for (let at = css.indexOf('@media print'); at >= 0; at = css.indexOf('@media print')) {
    let depth = 0;
    let i = css.indexOf('{', at);
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    css = css.slice(0, at) + blank(css.slice(at, i + 1)) + css.slice(i + 1);
  }
  return css;
}

/** Declarations of `property` outside tokens, chart graphics and print: [{ where: "file:line", value }]. */
function declsIn(file, property) {
  const css = liveCss(file);
  const src = read(file).split('\n');
  const found = [];
  for (const m of css.matchAll(/[{;]\s*([-\w]+)\s*:\s*([^;{}]*)/g)) {
    if (m[1] !== property) continue;
    const line = css.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length;
    found.push({ where: `${file}:${line}`, value: m[2].trim(), brand: (src[line - 1] || '').includes('/* brand */'), nudge: (src[line - 1] || '').includes('/* nudge */') });
  }
  return found;
}

test('outside the chart block and the token definitions, no colour literals', () => {
  const found = FILES.flatMap(literalsIn);
  assert.deepEqual(found, [], `colour literals left:\n${found.join('\n')}`);
});

test('the chart block holds only chart graphics', () => {
  const chart = [...regions(read('app/home.css'), CHART_BEGIN, CHART_END), ...regions(read('app/globals.css'), CHART_BEGIN, CHART_END)].join('\n');
  for (const sel of ['.polar-modal-svg', '.radio-modal-svg', '.pass-card__plot .polar-plot', '.polar-plot .horizon']) assert.ok(chart.includes(sel), sel);
  assert.doesNotMatch(chart, /\b(button|select|input|summary)\b|-backdrop|-actions|-close|-content\s*\{/, 'modal chrome lives in the library');
  // The chart graphics stay in the block.
  for (const file of FILES) {
    const outside = stripComments(blankRegions(read(file), CHART_BEGIN, CHART_END));
    assert.doesNotMatch(outside, /\.(?:polar-modal|radio-modal|polar-plot)[\w-]*/, `${file}: chart graphics outside the block`);
  }
});

test('chart modals render dark through the library', () => {
  for (const f of ['components/passes/SkyChartModalView.tsx', 'components/passes/RadioChartModalView.tsx']) assert.match(read(f), /tone="dark"/, f);
  assert.match(read('components/live/LiveView.tsx'), /size="full"/);
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
  // The map colours come from lib/ui/map-tokens.mjs and the chart dialog
  // panel from lib/ui/chart-tokens.mjs, not the stylesheet.
  const dark = themes.dark && { ...themes.dark, ...mapCssVars('dark'), ...chartCssVars() };
  const light = themes.light && { ...themes.light, ...mapCssVars('light') };
  return { dark, light: dark && light && { ...dark, ...light } };
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

test('both themes use the Slate palette', () => {
  const D = THEMES.dark;
  assert.equal(D['--bg'], '#11151c');
  assert.equal(D['--panel'], '#171c24');
  assert.equal(D['--text'], '#e4e8ee');
  assert.equal(D['--muted'], '#96a0ae');
  assert.equal(D['--accent'], '#8fb4e6');
  assert.equal(D['--primary'], '#5c8fd6');
  const L = THEMES.light;
  assert.equal(L['--bg'], '#f3f5f8');
  assert.equal(L['--panel'], '#ffffff');
  assert.equal(L['--text'], '#1a2230');
  assert.equal(L['--text-strong'], '#0b1220');
  assert.equal(L['--muted'], '#5a6475');
  assert.equal(L['--accent'], '#2c5a99');
  assert.equal(L['--primary'], '#2c5a99');
});

test('the colour parser handles #rgb, #rrggbb and composites rgba', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#0a0e1a'), [10, 14, 26, 1]);
  assert.deepEqual(over(parseColor('rgba(0, 0, 0, 0.5)'), [255, 255, 255, 1]), [127.5, 127.5, 127.5, 1]);
  assert.equal(ratio([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
});

/** OKLCH chroma of an opaque sRGB colour (Björn Ottosson's OKLab matrices). */
function chroma([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, Bk);
}

test('the chroma helper reads grey as 0 and a saturated blue as high', () => {
  assert.ok(chroma([128, 128, 128]) < 0.001);
  assert.ok(chroma([31, 95, 191]) > 0.1);
});

for (const theme of ['dark', 'light']) {
  // Slate: the chrome is neutral grey; blue is kept for the brand, links,
  // focus, the main action and selected toggles.
  test(`${theme}: slate tokens are neutral`, () => {
    for (const t of ['--panel', '--input-bg', '--border']) {
      const c = chroma(color(theme, t, color(theme, '--panel')));
      assert.ok(c < 0.04, `${theme}: ${t} has OKLCH chroma ${c.toFixed(3)}, needs under 0.04`);
    }
  });

  test(`${theme}: text contrast`, () => {
    for (const [fg, bg] of [['--text', '--bg'], ['--text', '--panel'], ['--muted', '--panel']]) {
      const r = contrast(theme, fg, bg);
      assert.ok(r >= 4.5, `${theme}: ${fg} on ${bg} is ${r.toFixed(2)}, needs 4.5`);
    }
  });

  // Inputs, menus, segmented wells and the stepper are known by their edge
  // alone (the well is barely apart from the page), so it needs 3:1 (WCAG 1.4.11).
  test(`${theme}: input boundaries`, () => {
    for (const bg of ['--bg', '--panel']) {
      const r = contrast(theme, '--input-border', bg);
      assert.ok(r >= 3, `${theme}: --input-border on ${bg} is ${r.toFixed(2)}, needs 3`);
    }
  });

  test(`${theme}: primary button contrast`, () => {
    const r = contrast(theme, '--primary-text', '--primary');
    assert.ok(r >= 4.5, `${theme}: --primary-text on --primary is ${r.toFixed(2)}, needs 4.5`);
    // A selected segment is a filled control too.
    const s = contrast(theme, '--seg-on-text', '--seg-on');
    assert.ok(s >= 4.5, `${theme}: --seg-on-text on --seg-on is ${s.toFixed(2)}, needs 4.5`);
    // The fill and an outline both have to stand out from the page (non-text 3:1 and a visible edge).
    const f = contrast(theme, '--primary', '--panel');
    assert.ok(f >= 3, `${theme}: --primary on --panel is ${f.toFixed(2)}, needs 3`);
  });

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

  test(`${theme}: the timeline's night stands apart from its day`, () => {
    const r = contrast(theme, '--timeline-night', '--timeline-day');
    assert.ok(r >= 1.4, `${theme}: night on day is ${r.toFixed(2)}, needs 1.4`);
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

// The timeline and the cloud badges are screen-only: neither prints.
test('home.css print styles hide the timeline and the cloud badges', () => {
  const css = stripComments(read('app/home.css'));
  const blocks = [];
  for (let at = css.indexOf('@media print'); at >= 0; at = css.indexOf('@media print', at + 1)) {
    let depth = 0;
    let i = css.indexOf('{', at);
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    blocks.push(css.slice(start + 1, i));
  }
  const hidden = new Set();
  for (const block of blocks) {
    for (const m of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/display\s*:\s*none/.test(m[2])) continue;
      for (const sel of m[1].split(',')) hidden.add(sel.trim());
    }
  }
  for (const sel of ['.timeline', '.cloud']) assert.ok(hidden.has(sel), `${sel} is hidden in print`);
});

test('printing removes the night vision filter', () => {
  const css = read('app/globals.css');
  const m = css.match(/@media print\s*\{([^}]*\{[^}]*\})+\s*\}/);
  assert.ok(m, 'no print block');
  assert.match(m[0], /html\[data-night='1'\]/);
  assert.match(m[0], /filter:\s*none/);
});

test('globals.css carries no triangulate rules', () => {
  const css = read('app/globals.css');
  for (const sel of ['#cesium-container', '#panel-observations', '#attempt-picker', '#tle-section', '.obs-card', '#camera-controls', '#imagery-select', '.result-block']) {
    assert.ok(!css.includes(sel), `${sel} moved to components/triangulate/triangulate.css`);
  }
});

test('scale tokens exist with the spec values', () => {
  const block = regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n');
  const want = { '--fs-xs': '11px', '--fs-sm': '12px', '--fs-md': '13px', '--fs-lg': '15px', '--fs-xl': '18px', '--fs-2xl': '24px', '--fs-input': '16px',
    '--fw-regular': '400', '--fw-medium': '500', '--fw-semibold': '600',
    '--sp-2': '2px', '--sp-4': '4px', '--sp-6': '6px', '--sp-8': '8px', '--sp-12': '12px', '--sp-16': '16px', '--sp-24': '24px', '--sp-32': '32px',
    '--radius-sm': '4px', '--radius-md': '6px', '--radius-lg': '8px', '--radius-xl': '12px', '--radius-full': '999px',
    '--dur-fast': '120ms', '--dur-base': '200ms', '--dur-slow': '300ms' };
  for (const [k, v] of Object.entries(want)) assert.match(block, new RegExp(`${k}:\\s*${v};`), k);
  for (const k of ['--font-sans', '--font-num', '--font-brand', '--font-code', '--fs-hero', '--lh-tight', '--lh-body', '--ease', '--line-subtle', '--line-control', '--line-input']) assert.ok(block.includes(`${k}:`), k);
  assert.match(block, /prefers-reduced-motion:\s*reduce[\s\S]*--dur-fast:\s*0ms/);
});

test('.theme-dark gets the dark tokens in any page theme', () => {
  const block = stripComments(regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n'));
  assert.match(block, /:root,\s*:root\[data-theme='dark'\],\s*\.theme-dark\s*\{/);
  assert.ok(THEMES.dark['--shadow-modal'] && THEMES.light['--shadow-modal']);
});

test('--line-* tokens resolve per .theme-dark scope, and .theme-dark sets its text colour', () => {
  const block = stripComments(regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n'));
  for (const k of ['--line-subtle', '--line-control', '--line-input']) {
    const rule = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[2].includes(`${k}:`));
    assert.ok(rule && /\.theme-dark/.test(rule[1]), `${k} is declared in a rule that includes .theme-dark`);
  }
  assert.match(block, /\.theme-dark\s*\{\s*color:\s*var\(--text\);/);
});

test('font-family uses font tokens only (outside tokens, chart graphics and print)', () => {
  const found = FILES.flatMap((f) => declsIn(f, 'font-family').filter((d) => !/^(var\(--font-(?:sans|num|brand|code)\)|inherit)$/.test(d.value)));
  assert.deepEqual(found.map((d) => d.where), []);
});

test('no font shorthand outside tokens, chart graphics and print (except inherit)', () => {
  const found = FILES.flatMap((f) => declsIn(f, 'font').filter((d) => d.value !== 'inherit'));
  assert.deepEqual(found.map((d) => `${d.where} ${d.value}`), []);
});

test('the root layout loads Atkinson Hyperlegible Next through next/font', () => {
  const src = read('app/layout.tsx');
  assert.match(src, /Atkinson_Hyperlegible_Next\s*\(/);
  assert.match(src, /variable:\s*"--font-atkinson"/);
  assert.match(src, /className=\{atkinson\.variable\}/);
  assert.doesNotMatch(src, /fonts\.googleapis\.com/);
});

test('font-size and font-weight use tokens', () => {
  const ok = (v) => /^var\(--f[sw]-[\w-]+\)$/.test(v) || /^[\d.]+em$/.test(v) || v === 'inherit';
  const found = FILES.flatMap((f) => [...declsIn(f, 'font-size'), ...declsIn(f, 'font-weight')].filter((d) => !ok(d.value) && !d.brand));
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});

test('ticking readouts use the numeric class', () => {
  for (const f of ['components/ui/StatTile.tsx', 'components/sat/StatTile.tsx', 'components/LiveClock.tsx', 'components/live/LiveView.tsx', 'components/home/NextUpList.tsx', 'components/home/UpNow.tsx']) {
    if (existsSync(new URL(`../${f}`, import.meta.url))) assert.match(read(f), /\bnum\b/, f);
  }
});

test('radius, transition and drop shadow use tokens', () => {
  const radiusOk = (v) => v.split(/\s+/).every((p) => /^var\(--radius-[\w-]+\)$/.test(p) || p === '0' || p === '50%');
  const transOk = (v) => v === 'none' || v.split(',').every((p) => /var\(--dur-\w+\)/.test(p) && /var\(--ease\)/.test(p));
  const shadowOk = (v) => v === 'none' || /^var\(--shadow-(popover|modal)\)$/.test(v) || /^(inset |0 0 0 )/.test(v);
  const found = FILES.flatMap((f) => [
    ...declsIn(f, 'border-radius').filter((d) => !radiusOk(d.value)),
    ...declsIn(f, 'transition').filter((d) => !transOk(d.value)),
    ...declsIn(f, 'box-shadow').filter((d) => !shadowOk(d.value.replace(/\s*!important$/, ''))),
  ]);
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});

/** Splits a value on spaces outside parentheses, so calc(-1 * var(--sp-4)) stays one part. */
function parts(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const SP = String.raw`var\(--sp-\d+\)`;
// A token, 0, auto, a safe-area inset, or calc of tokens only: a negated token
// or a sum of tokens. No px inside calc.
const SPACE_PART = new RegExp(String.raw`^(?:${SP}|0|auto|calc\(-1 \* ${SP}\)|calc\(${SP}(?: \+ ${SP})+\)|env\(safe-area-inset-\w+(?:, ?0)?\))$`);
const SPACE_PROPS = ['padding', 'margin', 'gap', 'row-gap', 'column-gap',
  ...['top', 'bottom', 'left', 'right'].flatMap((s) => [`padding-${s}`, `margin-${s}`]),
  ...['inline', 'block', 'inline-start', 'inline-end', 'block-start', 'block-end'].flatMap((s) => [`padding-${s}`, `margin-${s}`])];

test('the spacing rule accepts tokens and token calcs only', () => {
  for (const v of ['var(--sp-8)', '0 auto', 'calc(-1 * var(--sp-4))', 'calc(var(--sp-32) + var(--sp-8))']) assert.ok(parts(v).every((p) => SPACE_PART.test(p)), v);
  for (const v of ['8px', 'calc(var(--sp-8) + 2px)', 'calc(var(--sp-24) * 2)', '-var(--sp-4)']) assert.ok(!parts(v).every((p) => SPACE_PART.test(p)), v);
});

test('padding, margin and gap use spacing tokens', () => {
  // A /* nudge */ line may hold 1px optical corrections, nothing else literal.
  const ok = (d) => parts(d.value).every((p) => SPACE_PART.test(p) || (d.nudge && /^-?1px$/.test(p)));
  const found = FILES.flatMap((f) => SPACE_PROPS.flatMap((p) => declsIn(f, p)).filter((d) => !ok(d)));
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});

// --- Task 9 review (R15-R17) ----------------------------------------------

test('an always-dark dialog panel takes the chart canvas colour', () => {
  const ui = stripComments(read('app/ui.css'));
  assert.match(ui, /\.theme-dark\s*>\s*\.modal__panel\s*\{[^}]*background:\s*var\(--modal-dark-bg\);/);
  assert.ok(THEMES.dark['--modal-dark-bg'], '--modal-dark-bg is a dark token');
});

test('the radio dialog is wide and untitled through Modal props, not :has()', () => {
  const src = read('components/passes/RadioChartModalView.tsx');
  assert.match(src, /<Modal\b[^>]*\bwide\b/);
  assert.match(src, /<Modal\b[^>]*\bhideTitle\b/);
  assert.doesNotMatch(read('app/home.css'), /:has\(\.chart-modal/);
  const modal = read('components/ui/Modal.tsx');
  assert.match(modal, /hideTitle\?: boolean/);
  assert.match(modal, /wide\?: boolean/);
  assert.match(stripComments(read('app/ui.css')), /\.modal__panel--wide\s*\{[^}]*max-width:\s*98vw;/);
});

test('the radio phone tiles are small StatTiles', () => {
  assert.match(read('components/ui/StatTile.tsx'), /size\?: "sm" \| "md" \| "lg"/);
  assert.match(read('components/passes/RadioChartModalView.tsx'), /<StatTile\b[^>]*size="sm"/);
  const ui = stripComments(read('app/ui.css'));
  assert.match(ui, /\.stat-tile--sm \.stat-tile__value\s*\{[^}]*font-size:\s*var\(--fs-lg\);/);
});

test('fields are 13px with a fine pointer and 16px with a coarse one', () => {
  const ui = stripComments(read('app/ui.css'));
  assert.match(ui, /\.field__control\s*\{[^}]*font-size:\s*var\(--fs-md\);/);
  assert.match(ui, /@media \(pointer: coarse\)\s*\{[^@]*\.field__control\s*\{[^}]*font-size:\s*var\(--fs-input\);/);
});

test('Esc before a chart has painted closes it, before the page sees it', () => {
  for (const f of ['components/passes/SkyChartModalView.tsx', 'components/passes/RadioChartModalView.tsx']) {
    const src = read(f);
    assert.match(src, /if \(!open \|\| visible\) return;/, f);
    assert.match(src, /e\.stopPropagation\(\)/, f);
    assert.match(src, /addEventListener\("keydown", onKey, \{ capture: true \}\)/, f);
  }
});

// --- Task 11 review -----------------------------------------------------------

test('a done primary button keeps its readable text on the fill', () => {
  const ui = stripComments(read('app/ui.css'));
  assert.match(ui, /\.btn--primary\.btn--done\s*\{[^}]*color:\s*var\(--primary-text\);/);
  assert.match(ui, /\.btn--primary\.btn--done:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--primary-text\);/);
  // After the generic done rule, so it is the one that applies.
  assert.ok(ui.indexOf('.btn--primary.btn--done') > ui.indexOf('.btn--done,'));
});

test('a link button never takes the filled pressed or on look', () => {
  const ui = stripComments(read('app/ui.css'));
  for (const sel of [/\.btn\.btn--link\[aria-pressed="true"\]/, /\.btn\.btn--link\.btn--on/]) {
    const m = ui.match(new RegExp(`${sel.source}[^{]*\\{([^}]*)\\}`));
    assert.ok(m, `${sel} rule exists`);
    assert.match(m[1], /background:\s*none;/);
    assert.match(m[1], /color:\s*var\(--link\);/);
  }
  assert.match(ui, /\.btn\.btn--link\[aria-pressed="true"\]:hover:not\(:disabled\)/);
});
