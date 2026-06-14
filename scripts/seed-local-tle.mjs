// scripts/seed-local-tle.mjs — prints a current TLE map you can paste
// into a local memory store or inspect. Run: node scripts/seed-local-tle.mjs
import { CATALOG } from '../lib/catalog.mjs';
import { fetchTleForId } from '../lib/mcp/tle-fetch.mjs';

const map = {};
for (const s of CATALOG) {
  const t = await fetchTleForId(s.noradId);
  if (t) map[s.noradId] = { noradId: s.noradId, ...t, fetchedAtMs: Date.now() };
  console.error(`${s.name}: ${t ? 'ok' : 'FAILED'}`);
}
console.log(JSON.stringify(map, null, 2));
