// lib/mcp/tle-store.mjs - storage for the TLE record map (noradId -> record).
//
// createMemoryStore: dev/test, in-process.
// createEdgeConfigStore: prod. Reads via @vercel/edge-config (sub-ms at
//   the edge); writes via the Vercel REST API (the cron writes ~4x/day).
//   Requires env: EDGE_CONFIG (read connection string, set automatically
//   when an Edge Config is linked), EDGE_CONFIG_ID, VERCEL_API_TOKEN,
//   and optionally VERCEL_TEAM_ID.

export function createMemoryStore(initial = {}) {
  let map = { ...initial };
  return {
    async readMap() { return map; },
    async writeMap(next) { map = { ...next }; },
  };
}

export function createEdgeConfigStore() {
  const id = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  return {
    async readMap() {
      const { get } = await import('@vercel/edge-config');
      return (await get('tle')) ?? {};
    },
    async writeMap(next) {
      const qs = teamId ? `?teamId=${teamId}` : '';
      const resp = await fetch(`https://api.vercel.com/v1/edge-config/${id}/items${qs}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ operation: 'upsert', key: 'tle', value: next }] }),
      });
      if (!resp.ok) throw new Error(`Edge Config write failed: HTTP ${resp.status}`);
    },
  };
}
