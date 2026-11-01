// lib/mirror/refresh.mjs - fetch mirror groups, merge into the snapshot, write once.
// All I/O injected: store, fetchGroup, fetchByCatnr, now.
import { buildSnapshot } from './snapshot.mjs';

// CelesTrak updates GP sets about every 2 hours and answers a repeat
// download inside that window with 403, so a group fetched more recently
// than this is skipped (its records carry forward like a failed group's).
export const MIN_REFETCH_MS = 2 * 3_600_000;

export const catnrKey = (noradId) => `catnr:${noradId}`;

// pinnedIds (the curated satellites) must always be in the snapshot. Any a
// group did not supply is fetched by CATNR, keyed like a group so the same
// 2-hour skip and carry-forward rules apply. Retired satellites such as
// NOAA-19 drop out of every group, so this is the only way they stay.
export async function refreshMirror({
  store, groups, fetchGroup, now, log = console,
  pinnedIds = /** @type {number[]} */ ([]),
  fetchByCatnr = /** @type {((id: number) => Promise<any>) | null} */ (null),
}) {
  const previous = await store.read();
  const lastFetched = (previous && previous.groupFetchedAtMs) || {};
  const startMs = now();
  const results = {};
  const failedGroups = [];
  const skippedGroups = [];
  // Sequential on purpose: be gentle on CelesTrak.
  for (const group of groups) {
    const last = lastFetched[group];
    if (Number.isFinite(last) && startMs - last < MIN_REFETCH_MS) {
      results[group] = { ok: false };
      skippedGroups.push(group);
      continue;
    }
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
  if (pinnedIds.length > 0 && fetchByCatnr) {
    const fromGroups = buildSnapshot({ results, previous, nowMs: startMs }).objects;
    for (const id of pinnedIds) {
      const key = catnrKey(id);
      const held = fromGroups[String(id)];
      if (held && !(held.groups || []).includes(key)) continue;
      const last = lastFetched[key];
      if (Number.isFinite(last) && startMs - last < MIN_REFETCH_MS) {
        results[key] = { ok: false };
        skippedGroups.push(key);
        continue;
      }
      try {
        const omm = await fetchByCatnr(id);
        if (omm) results[key] = { ok: true, omms: [omm] };
        else {
          log.warn(`mirror refresh: pinned ${id} not found at CelesTrak`);
          results[key] = { ok: false };
          failedGroups.push(key);
        }
      } catch (err) {
        log.error(`mirror refresh: pinned ${id} failed: ${err?.message ?? err}`);
        results[key] = { ok: false };
        failedGroups.push(key);
      }
    }
  }
  const previousCount = previous ? Object.keys(previous.objects).length : 0;
  if (!Object.values(results).some((r) => r.ok)) {
    return { written: false, objectCount: previousCount, failedGroups, skippedGroups };
  }
  const snapshot = buildSnapshot({ results, previous, nowMs: now() });
  if (Object.keys(snapshot.objects).length === 0) {
    return { written: false, objectCount: 0, failedGroups, skippedGroups };
  }
  await store.write(snapshot);
  return { written: true, objectCount: Object.keys(snapshot.objects).length, failedGroups, skippedGroups };
}

// HTTP status + JSON body for the cron route. A run that wrote nothing
// because groups failed is a 502 so Vercel Cron and monitors see the failure.
export function refreshResponse(result) {
  if (!result.written && result.failedGroups.length > 0) {
    return { status: 502, body: { ok: false, ...result } };
  }
  return { status: 200, body: { ok: true, ...result } };
}
