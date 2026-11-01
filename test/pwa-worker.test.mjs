// Runs public/sw.js (and the kill-switch body in its header) in a vm with a
// small in-memory Cache Storage, fetch and clients, then drives its events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ORIGIN = 'https://seeksat.com';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const keyOf = (req, ignoreSearch) => {
  const u = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
  return ignoreSearch ? `${u.origin}${u.pathname}` : u.href;
};

// One cache: entries in insertion order; put moves an entry to the end.
class FakeCache {
  constructor() { this.entries = new Map(); }
  async put(req, res) {
    const k = keyOf(req);
    this.entries.delete(k);
    this.entries.set(k, { url: k, body: await res.text(), status: res.status, headers: [...res.headers] });
  }
  async match(req, opts = {}) {
    const want = keyOf(req, opts.ignoreSearch);
    for (const e of this.entries.values()) {
      if (keyOf(e.url, opts.ignoreSearch) === want) return new Response(e.body, { status: e.status, headers: e.headers });
    }
    return undefined;
  }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(req) { return this.entries.delete(keyOf(req)); }
  async add(req) { await this.put(req, await harnessFetch(req)); }
  paths() { return [...this.entries.keys()].map((k) => { const u = new URL(k); return u.pathname + u.search; }); }
}

let harnessFetch;

/** A fresh worker. net(url) answers a fetch, or throws to mean offline. */
function makeWorker({ file = 'public/sw.js', source, scriptUrl = `${ORIGIN}/sw.js?v=build-a`, net, store = new Map() } = {}) {
  const listeners = {};
  const navigated = [];
  const windows = [{ url: `${ORIGIN}/`, navigate: async (u) => { navigated.push(u); } }];
  let unregistered = false;
  const basic = (res) => {
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const fetchImpl = async (req) => {
    const url = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
    const res = await net(url);
    return basic(res);
  };
  harnessFetch = fetchImpl;
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new FakeCache());
      return store.get(name);
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async has(name) { return store.has(name); },
  };
  // A worker resolves relative URLs against its own location; Node does not.
  const WorkerRequest = class extends Request {
    constructor(input, init) { super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init); }
  };
  const ctx = {
    URL, Request: WorkerRequest, Response, Headers, console, Promise, caches, fetch: fetchImpl,
    location: new URL(scriptUrl),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    registration: { unregister: async () => { unregistered = true; return true; } },
    clients: { claim: async () => {}, matchAll: async () => windows },
  };
  ctx.self = ctx;
  vm.runInContext(source ?? read(file), vm.createContext(ctx));

  const extend = async (type, extra = {}) => {
    const pending = [];
    const event = { ...extra, waitUntil: (p) => pending.push(p), respondWith: (p) => { event.responded = p; } };
    listeners[type](event);
    const res = event.responded ? await event.responded : undefined;
    // waitUntil may queue more work while it runs.
    for (let i = 0; i < pending.length; i += 1) await pending[i].catch(() => {});
    return { event, res };
  };
  return {
    store,
    navigated,
    get unregistered() { return unregistered; },
    install: () => extend('install'),
    activate: () => extend('activate'),
    fetch: (path, { mode = 'cors', method = 'GET' } = {}) =>
      extend('fetch', { request: new FakeRequest(new URL(path, ORIGIN).href, mode, method) }),
    names: () => [...store.keys()].sort(),
  };
}

// Node's Request cannot have mode 'navigate'.
class FakeRequest {
  constructor(url, mode, method) { this.url = url; this.mode = mode; this.method = method; }
}

const page = (url) => new Response(`<html>${new URL(url).pathname}</html>`, { status: 200, headers: { 'content-type': 'text/html' } });
const online = async (url) => page(url);
const offline = async () => { throw new TypeError('Failed to fetch'); };

function killSwitchSource() {
  const sw = read('public/sw.js');
  const b = sw.indexOf('// kill-switch:begin');
  const e = sw.indexOf('// kill-switch:end');
  assert.ok(b >= 0 && e > b, 'sw.js documents the kill-switch body');
  return sw.slice(b, e).split('\n').slice(1).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

test('the documented kill-switch worker clears seeksat caches, unregisters and reloads windows', async () => {
  const store = new Map([['seeksat-v1', new FakeCache()], ['seeksat-data-v2', new FakeCache()], ['other-app', new FakeCache()]]);
  const w = makeWorker({ source: killSwitchSource(), net: online, store });
  await w.install();
  await w.activate();
  assert.deepEqual(w.names(), ['other-app']);
  assert.equal(w.unregistered, true);
  assert.deepEqual(w.navigated, [`${ORIGIN}/`]);
});

test('SwRegister has the NEXT_PUBLIC_SW_OFF lever and the ops doc covers both levers', () => {
  const reg = read('components/SwRegister.tsx');
  assert.match(reg, /process\.env\.NEXT_PUBLIC_SW_OFF === "1"/);
  assert.match(reg, /getRegistrations\(\)/);
  assert.match(reg, /\.unregister\(\)/);
  assert.match(reg, /startsWith\(CACHE_PREFIX\)/);
  assert.match(reg, /const CACHE_PREFIX = "seeksat-";/);
  const doc = read('docs/ops/service-worker.md');
  assert.match(doc, /NEXT_PUBLIC_SW_OFF=1/);
  assert.match(doc, /kill-switch/);
});


// M1: chunks (and non-star assets) and pages live in caches named for the
// build the worker was registered with; star images and /api/sats in one
// stable cache. A new build's worker drops the old build's caches.
const sats = async (url) => new Response(JSON.stringify({ url }), { status: 200, headers: { 'content-type': 'application/json' } });
const net = async (url) => (new URL(url).pathname === '/api/sats' ? sats(url) : page(url));

test('the worker keeps chunks and pages per build and star images and satellites in a stable cache', async () => {
  const w = makeWorker({ net });
  await w.install();
  await w.activate();
  await w.fetch('/_next/static/chunks/app-1.js');
  await w.fetch('/assets/stars/px.jpg');
  await w.fetch('/assets/observer.svg');
  await w.fetch('/api/sats?ids=25544');
  await w.fetch('/sat/25544', { mode: 'navigate' });
  assert.deepEqual(w.names(), ['seeksat-data-v1', 'seeksat-pages-v1-build-a', 'seeksat-static-v1-build-a']);
  assert.deepEqual(w.store.get('seeksat-static-v1-build-a').paths(), ['/_next/static/chunks/app-1.js', '/assets/observer.svg']);
  assert.deepEqual(w.store.get('seeksat-data-v1').paths(), ['/assets/stars/px.jpg', '/api/sats?ids=25544']);
  assert.deepEqual(w.store.get('seeksat-pages-v1-build-a').paths(), ['/', '/sat/25544']);

  const next = makeWorker({ net, store: w.store, scriptUrl: `${ORIGIN}/sw.js?v=build-b` });
  await next.install();
  await next.activate();
  assert.deepEqual(next.names(), ['seeksat-data-v1', 'seeksat-pages-v1-build-b']);
  assert.deepEqual(next.store.get('seeksat-data-v1').paths(), ['/assets/stars/px.jpg', '/api/sats?ids=25544']);
});

test('the worker drops the old single cache and copes with a missing or odd build id', async () => {
  const store = new Map([['seeksat-v1', new FakeCache()]]);
  const w = makeWorker({ net, store, scriptUrl: `${ORIGIN}/sw.js` });
  await w.install();
  await w.activate();
  assert.deepEqual(w.names(), ['seeksat-pages-v1-dev']);
  const odd = makeWorker({ net, scriptUrl: `${ORIGIN}/sw.js?v=${encodeURIComponent('a/b c<d>')}` });
  await odd.install();
  assert.deepEqual(odd.names(), ['seeksat-pages-v1-abcd']);
});

test('SwRegister registers the worker with the build id, set in next.config', () => {
  const reg = read('components/SwRegister.tsx');
  assert.match(reg, /process\.env\.NEXT_PUBLIC_BUILD_ID/);
  assert.match(reg, /`\/sw\.js\?v=\$\{/);
  const config = read('next.config.ts');
  assert.match(config, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(config, /NEXT_PUBLIC_BUILD_ID:/);
});

// M2: saved pages are capped, and an offline page with a query falls back
// to the same page saved without it.
test('saved pages are trimmed to the newest 30, keeping the home', async () => {
  const w = makeWorker({ net });
  await w.install();
  await w.activate();
  for (let i = 1; i <= 35; i += 1) await w.fetch(`/sat/${i}`, { mode: 'navigate' });
  const paths = w.store.get('seeksat-pages-v1-build-a').paths();
  assert.equal(paths.length, 31);
  assert.equal(paths[0], '/');
  assert.equal(paths[1], '/sat/6');
  assert.equal(paths.at(-1), '/sat/35');
});

test('offline, a page with a query falls back to the saved page without it', async () => {
  let up = true;
  const w = makeWorker({ net: (url) => (up ? net(url) : offline()) });
  await w.install();
  await w.activate();
  await w.fetch('/sat/25544', { mode: 'navigate' });
  up = false;
  const { res } = await w.fetch('/sat/25544?focus=1', { mode: 'navigate' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<html>/sat/25544</html>');
  const miss = await w.fetch('/sat/20580?focus=1', { mode: 'navigate' });
  assert.equal(miss.res.status, 503);
  assert.match(await miss.res.text(), /This page wasn&#39;t saved for offline use\./);
  const home = await w.fetch('/?focus=25544', { mode: 'navigate' });
  assert.equal(await home.res.text(), '<html>/</html>');
});

// M5: network-only is left to the browser, like passthrough.
test('network-only and passthrough requests get no respondWith', async () => {
  const w = makeWorker({ net });
  for (const path of ['/api/search?q=iss', '/api/og/sat/25544', '/api/mcp', '/icon.svg']) {
    const { event } = await w.fetch(path);
    assert.equal(event.responded, undefined, path);
  }
  const { event } = await w.fetch('/api/sats?ids=1');
  assert.ok(event.responded, 'network-first still responds');
});

// M3
test('the offline page has a light palette', () => {
  const sw = read('public/sw.js');
  const light = sw.match(/@media \(prefers-color-scheme: light\)\{([^}]*\{[^}]*\})+\}/);
  assert.ok(light, 'no light block');
  assert.match(light[0], /background:#f5f7fb/);
  assert.match(light[0], /color:#1b2333/);
});
