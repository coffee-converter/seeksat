// lib/pwa/strategy.mjs - which caching strategy the service worker uses for a
// request. public/sw.js is a classic script and cannot import this module, so
// it carries a copy of the block between the strategy markers below;
// test/pwa-strategy.test.mjs fails if the two copies drift apart.
//
// Rows are tried in order; the first match wins. Non-GET and cross-origin
// requests never reach the table. Network-only rows come before navigation so
// an OG image or the MCP endpoint is never cached, even when opened in a tab.
//   test 'prefix'   - the path starts with `path`
//   test 'segment'  - the path is `path` or sits under `path/`
//   test 'exact'    - the path is `path`
//   test 'navigate' - the request is a page navigation

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

export { ROUTES, strategyFor };
