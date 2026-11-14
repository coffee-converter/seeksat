import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/import-graph.mjs';

// Source scans: every screen builds its controls from components/ui.
// components/ui is the library itself; Triangulate is out of scope.
const SKIP = ['components/ui', 'components/triangulate', 'components/TriangulateApp.tsx'];

// Raw <input type="checkbox|range|radio"> allowed outside components/ui (none yet).
const INPUT_ALLOW = [];

// Clickable surfaces that are not controls in the library's sense: a whole
// strip, card row, heading or chart mark that is a button. They keep a raw
// <button> with their own class. Keyed by file, then the button's first class.
const BESPOKE = {
  'components/home/PassRow.tsx': ['pass-row__btn'], // one pass as a row that opens in place
  'components/home/Timeline.tsx': ['timeline__bar'], // one pass as a bar on the 24 h strip
  'components/home/PassRowOpen.tsx': ['pass-open__plot'], // the small sky plot, which opens the sky chart
  'components/home/BestLine.tsx': ['best-line'], // the Best line, which opens that pass's row
  'components/LiveClock.tsx': ['live-clock__resume'], // the paused clock, which goes back to live
  'app/design-27b284ec240e9ac9/DesignBible.tsx': ['bible__tap'], // the interactive Surface specimen
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (SKIP.includes(rel)) continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const SOURCES = [...walk('components'), ...walk('app')];
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** First class in the className of the tag that starts at `at`. */
function firstClass(src, at) {
  const m = src.slice(at, at + 600).match(/className=\{?[`"']([\w-]+)/);
  return m ? m[1] : null;
}

/** Raw controls outside the library, as "file:line  <tag ...". */
function rawControls() {
  const found = [];
  for (const file of SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(/<(button|select|textarea|input)\b/g)) {
      const at = m.index;
      const tag = m[1];
      // A form control handed to <Field> is the library's field.
      if (tag !== 'button' && /<Field\b[^<]*>\s*$/.test(src.slice(Math.max(0, at - 600), at))) continue;
      if (tag === 'input' && INPUT_ALLOW.includes(file)) continue;
      if (tag === 'button' && (BESPOKE[file] || []).includes(firstClass(src, at))) continue;
      const line = src.slice(0, at).split('\n').length;
      found.push(`${file}:${line}  <${tag}`);
    }
  }
  return found;
}

/** Files whose source matches `re`, as "file:line". */
function filesMatching(re) {
  const found = [];
  for (const file of [...SOURCES, 'app/globals.css', 'app/home.css', 'app/sat.css']) {
    read(file).split('\n').forEach((l, i) => { if (re.test(l)) found.push(`${file}:${i + 1}`); });
  }
  return found;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');
function blankBetween(css, begin, end) {
  let at = css.indexOf(begin);
  while (at >= 0) {
    const e = css.indexOf(end, at);
    css = css.slice(0, at) + blank(css.slice(at, e + end.length)) + css.slice(e + end.length);
    at = css.indexOf(begin);
  }
  return css;
}
function blankPrint(css) {
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
/** A screen stylesheet with comments, tokens, chart graphics and print blanked. */
function liveCss(file) {
  let css = read(file).replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes(':begin') || c.includes(':end') ? c : blank(c)));
  css = blankBetween(css, '/* theme-tokens:begin */', '/* theme-tokens:end */');
  css = blankBetween(css, '/* chart-block:begin */', '/* chart-block:end */');
  return blankPrint(css);
}

// The design page's stylesheet is layout only: it places library parts, never restyles them.
const SCREEN_CSS = ['app/home.css', 'app/sat.css', 'app/globals.css', 'app/design-27b284ec240e9ac9/bible.css'];

/** Selectors that style a control by its tag, as "file:line  selector". */
function tagSelectors() {
  const found = [];
  for (const file of SCREEN_CSS) {
    const css = liveCss(file);
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      const sels = m[1].trim();
      if (sels.startsWith('@')) continue;
      for (const sel of sels.split(',')) {
        const last = sel.trim().split(/[\s>+~]+/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, '');
        if (/^(button|input|select|summary|textarea)\b/.test(last) || /\[role=["']?radio["']?\]/.test(last)) {
          found.push(`${file}:${css.slice(0, m.index).split('\n').length + (m[1].match(/^\s*/)[0].split('\n').length - 1)}  ${sel.trim()}`);
        }
      }
    }
  }
  return found;
}

// Library parts a screen may place but never restyle.
const LIB_PART = /\.(?:btn|segmented|badge|chip|field|details|stat-tile|modal|surface|disclosure|qbars)(?:__[\w]+|--[\w]+)*(?![\w-])/;
const LAYOUT_PROP = /^(?:margin(?:-[\w-]+)?|flex(?:-[\w-]+)?|grid(?:-[\w-]+)?|order|display|align-[\w-]+|justify-[\w-]+|place-[\w-]+|(?:min-|max-)?(?:width|height)|position|inset|top|left|right|bottom|z-index|pointer-events|visibility)$/;

/** Declarations in screen CSS that set a non-layout property on a library part, as "file:line  selector { prop }". */
function libraryRestyles() {
  const found = [];
  for (const file of [...SCREEN_CSS, 'app/mcp/mcp.css']) {
    const css = liveCss(file);
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].trim();
      if (sels.startsWith('@')) continue;
      const hits = sels.split(/,(?![^(]*\))/).filter((sel) => LIB_PART.test(sel.trim().split(/[\s>+~]+/).pop()));
      if (!hits.length) continue;
      for (const d of m[2].matchAll(/([-\w]+)\s*:/g)) {
        if (LAYOUT_PROP.test(d[1])) continue;
        const line = css.slice(0, m.index + m[0].indexOf('{')).split('\n').length;
        found.push(`${file}:${line}  ${hits.join(', ').trim()} { ${d[1]} }`);
      }
    }
  }
  return found;
}

test('screen stylesheets only place library components, never restyle them', () => {
  assert.deepEqual(libraryRestyles(), []);
});

test('no screen renders a raw <button>, <select> or <input> outside the library', () => {
  assert.deepEqual(rawControls(), [], 'use components/ui');
});

test('no old component class names remain', () => {
  const old = /\b(home-button|home-chip|sat-badge|theme-toggle__opt|more-toggle)\b/;
  assert.deepEqual(filesMatching(old), []);
});

test('screen stylesheets do not style controls by tag', () => {
  assert.deepEqual(tagSelectors(), []);
});

test('no filter outside the night-vision rules', () => {
  for (const file of ['app/ui.css', 'app/home.css', 'app/sat.css']) {
    assert.doesNotMatch(liveCss(file), /(^|[{;\s])filter\s*:/, `${file} sets filter`);
  }
  // globals.css: only the html[data-night] rules may filter.
  const css = liveCss('app/globals.css');
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/(^|[;\s])filter\s*:/.test(m[2]) && !/data-night/.test(m[1])) bad.push(m[1].trim());
  }
  assert.deepEqual(bad, []);
});

test('the scans see the files they guard', () => {
  assert.ok(SOURCES.includes('components/home/HomeApp.tsx'));
  assert.ok(SOURCES.includes('components/sat/SatApp.tsx'));
  assert.ok(!SOURCES.some((f) => f.startsWith('components/ui/')));
});

test('a pass rating reads its word first, then "N of 5"', () => {
  const src = readFileSync(path.join(ROOT, 'components/passes/QualityBadge.tsx'), 'utf8');
  // The bars sit before the word on screen but are decorative there; the
  // count is spoken after the word, as "Poor: faint, 3 of 5".
  assert.match(src, /<RatingBars bars=\{[^}]*\} \/>/, 'the badge\'s bars carry no accessible name');
  const word = src.indexOf('{ratingText(');
  const count = src.search(/className="sr-only">\{`, \$\{bars\} of \$\{BAR_COUNT\}`\}/);
  assert.ok(word > 0 && count > word, 'the spoken count follows the word');
  const bars = readFileSync(path.join(ROOT, 'components/ui/RatingBars.tsx'), 'utf8');
  assert.match(bars, /aria-hidden/, 'RatingBars without a label is hidden from screen readers');
});

test('Modal stops Escape from reaching page handlers', () => {
  const src = readFileSync(path.join(ROOT, 'components/ui/Modal.tsx'), 'utf8');
  assert.match(src, /e\.key === "Escape"\)\s*\{[^}]*e\.stopPropagation\(\)/);
});

// R21: the card look (panel, hairline edge, corners, the coloured leading
// edge, the selected ring) comes from Surface; these screen classes keep layout.
const CARDS = ['.home-controls', '.live-view__nums div', '.live-view__radio', '.sat-next'];
const CARD_LOOK = /^(?:background(?:-color)?|border(?:-[\w-]+)?|box-shadow|outline(?:-[\w-]+)?)$/;

test('the card screens take their look from Surface', () => {
  const found = [];
  for (const file of SCREEN_CSS) {
    const css = liveCss(file);
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].trim().split(/,(?![^(]*\))/).map((s) => s.trim().replace(/:[\w-]+(\([^)]*\))?/g, ''));
      const hits = sels.filter((s) => CARDS.some((c) => s === c || new RegExp(`^${c.replace('.', '\\.')}(?:--[\\w-]+)+$`).test(s)));
      if (!hits.length) continue;
      for (const d of m[2].matchAll(/([-\w]+)\s*:/g)) {
        if (!CARD_LOOK.test(d[1])) continue;
        found.push(`${file}:${css.slice(0, m.index + m[0].indexOf('{')).split('\n').length}  ${hits.join(', ')} { ${d[1]} }`);
      }
    }
  }
  assert.deepEqual(found, []);
  const uses = {
    'components/home/PassRow.tsx': /surfaceClass\(/,
    'components/live/LiveView.tsx': /<Surface\b/,
    'components/sat/NextPassLine.tsx': /surfaceClass\(|<Surface\b/,
  };
  for (const [f, re] of Object.entries(uses)) assert.match(read(f), re, f);
});
