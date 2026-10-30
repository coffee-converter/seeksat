// lib/mirror/refresh.mjs - fetch mirror groups, merge into the snapshot, write once.
// All I/O injected: store, fetchGroup, now.
import { buildSnapshot } from './snapshot.mjs';

export async function refreshMirror({ store, groups, fetchGroup, now, log = console }) {
  const results = {};
  const failedGroups = [];
  // Sequential on purpose: be gentle on CelesTrak.
  for (const group of groups) {
    try {
      const omms = await fetchGroup(group);
      if (!Array.isArray(omms) || omms.length === 0) {
        log.warn(`mirror refresh: group ${group} returned no objects`);
        results[group] = { ok: false };
        failedGroups.push(group);
      } else {
        results[group] = { ok: true, omms };
      }
    } catch (err) {
      log.error(`mirror refresh: group ${group} failed: ${err?.message ?? err}`);
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
  if (Object.keys(snapshot.objects).length === 0) {
    return { written: false, objectCount: 0, failedGroups };
  }
  await store.write(snapshot);
  return { written: true, objectCount: Object.keys(snapshot.objects).length, failedGroups };
}
