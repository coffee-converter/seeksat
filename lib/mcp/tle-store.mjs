// lib/mcp/tle-store.mjs - in-process store for a TLE record map
// (noradId -> record), for tests and dev. Production data lives in the
// catalog mirror (lib/mirror).

export function createMemoryStore(initial = {}) {
  let map = { ...initial };
  return {
    async readAll() { return map; },
    async writeAll(next) { map = { ...next }; },
  };
}
