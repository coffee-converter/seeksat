// lib/mirror/refresh.mjs - fetch mirror groups, merge into the snapshot, write once.
// All I/O injected: store, fetchGroup, now.
import { buildSnapshot } from './snapshot.mjs';

export async function refreshMirror({ store, groups, fetchGroup, now }) {
  const results = {};
  const failedGroups = [];
  // Sequential on purpose: be gentle on CelesTrak.
  for (const group of groups) {
    try {
      results[group] = { ok: true, omms: await fetchGroup(group) };
    } catch {
      results[group] = { ok: false };
      failedGroups.push(group);
    }
  }
  const previous = await store.read();
  if (groups.length > 0 && failedGroups.length === groups.length) {
    return {
      written: false,
      objectCount: previous ? Object.keys(previous.objects).length : 0,
      failedGroups,
    };
  }
  const snapshot = buildSnapshot({ results, previous, nowMs: now() });
  await store.write(snapshot);
  return { written: true, objectCount: Object.keys(snapshot.objects).length, failedGroups };
}
