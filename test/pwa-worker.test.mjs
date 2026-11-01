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
  const ctx = {
    URL, Request, Response, Headers, console, Promise, caches, fetch: fetchImpl,
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

