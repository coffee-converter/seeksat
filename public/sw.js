// public/sw.js - SeekSat's service worker: install, offline and reminders.
// A plain classic script with no build step. Registered by
// components/SwRegister.tsx in production only.
//
//   network-first - pages and /api/sats: the network when it answers, else
//                   the last saved copy (a page falls back to the saved /).
//   cache-first   - /_next/static (content-hashed) and /assets.
//   network-only  - search, OG images, MCP and the refresh cron: never saved.
//   passthrough   - everything else, every non-GET and every other origin
//                   (Nominatim, Vercel analytics): the worker stays out of it.
//
// Bump SW_VERSION to drop every saved response on the next visit.
const SW_VERSION = 1;
const CACHE = `seeksat-v${SW_VERSION}`;
// Hashed chunks pile up across deploys inside one version; keep the newest.
const MAX_STATIC = 300;
const MAX_SATS = 30;

// strategy:begin
const ROUTES = [
  { test: 'prefix', path: '/_vercel/', strategy: 'passthrough' },
  { test: 'segment', path: '/api/search', strategy: 'network-only' },
  { test: 'prefix', path: '/api/og', strategy: 'network-only' },
  { test: 'segment', path: '/api/mcp', strategy: 'network-only' },
  { test: 'segment', path: '/api/refresh-tle', strategy: 'network-only' },
  { test: 'prefix', path: '/_next/static/', strategy: 'cache-first' },
  { test: 'prefix', path: '/assets/', strategy: 'cache-first' },
  { test: 'navigate', strategy: 'network-first' },
  { test: 'exact', path: '/api/sats', strategy: 'network-first' },
];

function routeMatches(row, path, mode) {
  if (row.test === 'navigate') return mode === 'navigate';
  if (row.test === 'exact') return path === row.path;
  if (row.test === 'segment') return path === row.path || path.startsWith(`${row.path}/`);
  return path.startsWith(row.path);
}

/** 'network-first' | 'cache-first' | 'network-only' | 'passthrough' */
function strategyFor({ url, method, mode, sameOrigin }) {
  if (method !== 'GET' || !sameOrigin) return 'passthrough';
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return 'passthrough';
  }
  for (const row of ROUTES) {
    if (routeMatches(row, path, mode)) return row.strategy;
  }
  return 'passthrough';
}
// strategy:end

const sameOrigin = (url) => {
  try {
    return new URL(url, self.location.origin).origin === self.location.origin;
  } catch {
    return false;
  }
};

// Only whole, same-origin, successful answers are worth keeping.
const saveable = (res) => res && res.ok && res.status === 200 && res.type === 'basic';

async function trim(cache, prefix, max) {
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname.startsWith(prefix));
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function put(request, res) {
  const cache = await caches.open(CACHE);
  await cache.put(request, res);
  const path = new URL(request.url).pathname;
  if (path.startsWith('/_next/static/')) await trim(cache, '/_next/static/', MAX_STATIC);
  else if (path === '/api/sats') await trim(cache, '/api/sats', MAX_SATS);
}

async function networkFirst(event, isPage) {
  const { request } = event;
  try {
    const res = await fetch(request);
    if (saveable(res)) event.waitUntil(put(request, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    if (isPage) {
      const home = await cache.match('/', { ignoreVary: true });
      if (home) return home;
    }
    throw err;
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (saveable(res)) event.waitUntil(put(request, res.clone()).catch(() => {}));
  return res;
}

// Saves a URL the way the fetch handler would have, for pages that loaded
// before this worker took control.
async function warm(url, mode) {
  if (!sameOrigin(url)) return;
  const strategy = strategyFor({ url, method: 'GET', mode, sameOrigin: true });
  if (strategy !== 'network-first' && strategy !== 'cache-first') return;
  const cache = await caches.open(CACHE);
  if (strategy === 'cache-first' && (await cache.match(url, { ignoreVary: true }))) return;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (saveable(res)) await put(new Request(url), res);
}

self.addEventListener('install', (event) => {
  // The app shell: the home page, so any page has an offline fallback.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('seeksat-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor({
    url: request.url,
    method: request.method,
    mode: request.mode,
    sameOrigin: sameOrigin(request.url),
  });
  if (strategy === 'network-first') event.respondWith(networkFirst(event, request.mode === 'navigate'));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(event));
  else if (strategy === 'network-only') event.respondWith(fetch(request));
  // passthrough: no respondWith, so the browser handles it as if we were not here.
});

// SwRegister posts what the first, uncontrolled load fetched.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm') return;
  const jobs = [];
  if (typeof data.page === 'string') jobs.push(warm(data.page, 'navigate'));
  for (const url of Array.isArray(data.urls) ? data.urls.slice(0, 200) : []) {
    if (typeof url === 'string') jobs.push(warm(url, 'cors'));
  }
  event.waitUntil(Promise.all(jobs.map((j) => j.catch(() => {}))));
});

// Pass reminders (components/AlertRunner.tsx) carry the page to open in
// data.url. Same-origin only; anything else opens /.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === 'string' && sameOrigin(raw) ? new URL(raw, self.location.origin).href : new URL('/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => sameOrigin(c.url));
    if (client) {
      try {
        const focused = await client.focus();
        await (focused || client).navigate(url);
        return;
      } catch {
        /* an uncontrolled window cannot be navigated from here */
      }
    }
    await self.clients.openWindow(url);
  })());
});
