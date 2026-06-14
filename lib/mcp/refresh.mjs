// lib/mcp/refresh.mjs — pure refresh orchestration. No framework, no
// global state: store, catalog, fetchTle and now are all injected.

import { makeTleRecord, mergeRecord } from './tle-record.mjs';

export async function refreshCatalog({ store, catalog, fetchTle, now }) {
  const map = { ...(await store.readMap()) };
  const updated = [];
  const failed = [];
  for (const entry of catalog) {
    const fetched = await fetchTle(entry.noradId);
    if (!fetched) { failed.push(entry.noradId); continue; }
    const incoming = makeTleRecord(entry.noradId, fetched, now());
    const merged = mergeRecord(map[entry.noradId] ?? null, incoming);
    map[entry.noradId] = merged;
    if (merged === incoming) updated.push(entry.noradId);
  }
  await store.writeMap(map);
  return { updated, failed };
}
