import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ROUTES, navigationFallback, strategyFor } from '../lib/pwa/strategy.mjs';
import manifest from '../app/manifest.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ORIGIN = 'https://seeksat.com';
const req = (path, o = {}) => ({ url: new URL(path, ORIGIN).href, method: 'GET', mode: 'cors', sameOrigin: true, ...o });
const nav = (path, o = {}) => req(path, { mode: 'navigate', ...o });

// [label, request, expected strategy]: every row of the table, plus the edges.
const CASES = [
  ['POST is passthrough', req('/api/sats?ids=25544', { method: 'POST' }), 'passthrough'],
  ['HEAD is passthrough', nav('/', { method: 'HEAD' }), 'passthrough'],
  ['cross-origin Nominatim is passthrough', req('https://nominatim.openstreetmap.org/search?q=x', { sameOrigin: false }), 'passthrough'],
  ['a cross-origin navigation is passthrough', nav('https://example.com/', { sameOrigin: false }), 'passthrough'],
  ['Vercel analytics is passthrough', req('/_vercel/insights/view', { method: 'POST' }), 'passthrough'],
  ['Vercel analytics GET is passthrough', req('/_vercel/insights/script.js'), 'passthrough'],
  ['Speed Insights GET is passthrough', req('/_vercel/speed-insights/script.js'), 'passthrough'],
  ['navigating to / is network-first', nav('/'), 'network-first'],
  ['navigating to a satellite page is network-first', nav('/sat/25544'), 'network-first'],
  ['navigating with a query is network-first', nav('/?focus=25544'), 'network-first'],
  ['/api/sats is network-first', req('/api/sats?ids=25544,20580'), 'network-first'],
  ['/_next/static chunks are cache-first', req('/_next/static/chunks/app/page-0a1b2c.js'), 'cache-first'],
  ['/_next/static css is cache-first', req('/_next/static/css/abc123.css'), 'cache-first'],
  ['/assets are cache-first', req('/assets/stars/px.jpg'), 'cache-first'],
  ['/api/search is network-only', req('/api/search?q=iss'), 'network-only'],
  ['/api/og is network-only', req('/api/og?s=abc'), 'network-only'],
  ['/api/og/sat is network-only', req('/api/og/sat/25544'), 'network-only'],
  ['/api/mcp is network-only', req('/api/mcp'), 'network-only'],
  ['/api/refresh-tle is network-only', req('/api/refresh-tle'), 'network-only'],
  ['navigating to an OG image is still network-only', nav('/api/og/sat/25544'), 'network-only'],
  ['navigating to /api/mcp is still network-only', nav('/api/mcp'), 'network-only'],
  ['an RSC fetch for a page is passthrough', req('/sat/25544?_rsc=1x2y'), 'passthrough'],
  ['the icon is passthrough', req('/icon.svg'), 'passthrough'],
  ['the manifest is passthrough', req('/manifest.webmanifest'), 'passthrough'],
  ['the service worker script is passthrough', req('/sw.js'), 'passthrough'],
  ['a lookalike of /api/sats is passthrough', req('/api/satsx?ids=1'), 'passthrough'],
  ['a lookalike of /assets is passthrough', req('/assetsx/a.png'), 'passthrough'],
  ['a bad url is passthrough', { url: 'not a url', method: 'GET', mode: 'cors', sameOrigin: true }, 'passthrough'],
];

for (const [label, request, expected] of CASES) {
  test(`strategyFor: ${label}`, () => {
    assert.equal(strategyFor(request), expected);
  });
}

test('every row of the table is exercised by a case', () => {
  for (const row of ROUTES) {
    const hit = CASES.some(([, r, want]) => {
      if (want !== row.strategy || r.method !== 'GET' || !r.sameOrigin) return false;
      if (row.test === 'navigate') return r.mode === 'navigate';
      return new URL(r.url).pathname.startsWith(row.path);
    });
    assert.ok(hit, `no case for ${JSON.stringify(row)}`);
  }
});

// An offline navigation with no saved copy: / gets the saved home, any other
// page an honest "not saved" page rather than the home under the wrong URL.
const FALLBACKS = [
  [`${ORIGIN}/`, 'home'],
  [`${ORIGIN}/?focus=25544`, 'home'],
  [`${ORIGIN}/sat/20580`, 'offline-page'],
  [`${ORIGIN}/sat/25544/share/abc`, 'offline-page'],
  [`${ORIGIN}/mcp`, 'offline-page'],
  ['not a url', 'offline-page'],
];

for (const [url, expected] of FALLBACKS) {
  test(`navigationFallback: ${url} -> ${expected}`, () => {
    assert.equal(navigationFallback(url), expected);
  });
}

test('the offline page says the page was not saved and links home', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /<h1>Offline<\/h1>/);
  assert.match(sw, /This page wasn&#39;t saved for offline use\./);
  assert.match(sw, /<a href="\/">Go to SeekSat home<\/a>/);
  assert.match(sw, /offline-page/);
});

test('sw.js keeps every hashed chunk, and never saves a redirected answer', () => {
  const sw = read('public/sw.js');
  assert.doesNotMatch(sw, /MAX_STATIC/);
  assert.doesNotMatch(sw, /trim\(cache, '\/_next\/static\/'/);
  assert.match(sw, /!res\.redirected/);
});

test('sw.js marks /api/sats answers served from the cache', () => {
  assert.match(read('public/sw.js'), /x-seeksat-cache/);
});

// sw.js is a classic script, so it carries its own copy of the table and of
// strategyFor between the strategy:begin/end markers. The copies must match.
const BEGIN = '// strategy:begin';
const END = '// strategy:end';
function block(text, file) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  assert.ok(b >= 0 && e > b, `${file} has no ${BEGIN} ... ${END} block`);
  return text.slice(b + BEGIN.length, e);
}

test('sw.js carries the same table and strategyFor as lib/pwa/strategy.mjs', () => {
  const lib = block(read('lib/pwa/strategy.mjs'), 'strategy.mjs').replace(/^export /gm, '');
  const sw = block(read('public/sw.js'), 'sw.js');
  assert.equal(sw, lib);
});

test('sw.js strategyFor gives the same answer for every case', () => {
  const sw = block(read('public/sw.js'), 'sw.js');
  const ctx = vm.createContext({ URL });
  vm.runInContext(`${sw}\nglobalThis.__out = { ROUTES, strategyFor, navigationFallback };`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.__out.ROUTES)), JSON.parse(JSON.stringify(ROUTES)));
  for (const [label, request, expected] of CASES) {
    assert.equal(ctx.__out.strategyFor(request), expected, label);
  }
  for (const [url, expected] of FALLBACKS) assert.equal(ctx.__out.navigationFallback(url), expected, url);
});

test('sw.js versions its cache, cleans up old ones and claims clients', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /const SW_VERSION = \d+;/);
  assert.match(sw, /`seeksat-static-v\$\{SW_VERSION\}-\$\{BUILD\}`/);
  assert.match(sw, /`seeksat-pages-v\$\{SW_VERSION\}-\$\{BUILD\}`/);
  assert.match(sw, /`seeksat-data-v\$\{SW_VERSION\}`/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /caches\.delete\(/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.doesNotMatch(sw, /^\s*(import|export)\s/m, 'a classic worker cannot use ESM');
});

test('the manifest makes SeekSat installable', () => {
  const m = manifest();
  assert.equal(m.name, 'SeekSat');
  assert.equal(m.short_name, 'SeekSat');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.background_color, '#11151c');
  assert.equal(m.theme_color, '#11151c');
  const icons = Object.fromEntries(m.icons.map((i) => [i.src, i]));
  assert.equal(icons['/icon.svg']?.type, 'image/svg+xml');
  assert.equal(icons['/apple-icon.png']?.sizes, '180x180');
  assert.equal(icons['/icon-192.png']?.sizes, '192x192');
  assert.equal(icons['/icon-512.png']?.sizes, '512x512');
});

// PNG width and height live in the IHDR chunk at bytes 16..24.
function pngSize(path) {
  const buf = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

test('every manifest PNG icon exists at its stated size', () => {
  const files = { '/icon-192.png': 'public/icon-192.png', '/icon-512.png': 'public/icon-512.png', '/apple-icon.png': 'app/apple-icon.png' };
  for (const icon of manifest().icons.filter((i) => i.type === 'image/png')) {
    assert.ok(files[icon.src], `unknown icon ${icon.src}`);
    assert.equal(pngSize(files[icon.src]), icon.sizes, icon.src);
  }
});

test('sw.js never saves an /api/sats answer marked no-store, live or warmed', () => {
  const sw = read('public/sw.js');
  // Network-first answers and warm-up refetches can be /api/sats; both ask
  // heldBack before saving. (Cache-first holds static files only.)
  const network = sw.slice(sw.indexOf('async function networkFirst'), sw.indexOf('async function cacheFirst'));
  const warm = sw.slice(sw.indexOf('async function warm'));
  for (const body of [network, warm]) assert.match(body, /if \(saveable\(res\) && !heldBack\(res, isPage\)\)/);
});
