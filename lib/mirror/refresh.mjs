// lib/mirror/refresh.mjs - fetch mirror groups, merge into the snapshot, write once.
// All I/O injected: store, fetchGroup, fetchByCatnr, now.
import { buildSnapshot } from './snapshot.mjs';
import { DOWNLINKS_REFETCH_MS } from './satnogs.mjs';

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
  // Downlinks per satellite ({ [noradId]: Downlink[] }, lib/mirror/satnogs.mjs),
  // asked at most once per DOWNLINKS_REFETCH_MS; a failure keeps the last set.
  fetchDownlinks = /** @type {(() => Promise<Record<string, any[]>>) | null} */ (null),
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
  let downlinks = (previous && previous.downlinks) || null;
  let downlinksFetchedAtMs = (previous && previous.downlinksFetchedAtMs) || null;
  let downlinksFailed = false;
  if (fetchDownlinks && !(Number.isFinite(downlinksFetchedAtMs) && startMs - downlinksFetchedAtMs < DOWNLINKS_REFETCH_MS)) {
    try {
      const fresh = await fetchDownlinks();
      if (fresh && Object.keys(fresh).length > 0) {
        downlinks = fresh;
        downlinksFetchedAtMs = startMs;
      } else {
        log.warn('mirror refresh: downlinks came back empty; keeping the last set');
        downlinksFailed = true;
      }
    } catch (err) {
      log.error(`mirror refresh: downlinks failed: ${err?.message ?? err}`);
      downlinksFailed = true;
    }
  }
  const previousCount = previous ? Object.keys(previous.objects).length : 0;
  if (!Object.values(results).some((r) => r.ok)) {
    return { written: false, objectCount: previousCount, failedGroups, skippedGroups };
  }
  const snapshot = buildSnapshot({ results, previous, nowMs: now() });
  if (downlinks) Object.assign(snapshot, { downlinks, downlinksFetchedAtMs });
  if (Object.keys(snapshot.objects).length === 0) {
    return { written: false, objectCount: 0, failedGroups, skippedGroups };
  }
  await store.write(snapshot);
  // What changed, for search engines (app/api/refresh-tle submits these
  // pages to IndexNow). Nothing on a first run: every page would be new.
  const before = previous ? new Set(Object.keys(previous.objects)) : null;
  const after = new Set(Object.keys(snapshot.objects));
  const addedIds = before ? [...after].filter((id) => !before.has(id)).map(Number) : [];
  const removedIds = before ? [...before].filter((id) => !after.has(id)).map(Number) : [];
  return {
    written: true, objectCount: Object.keys(snapshot.objects).length, failedGroups, skippedGroups, addedIds, removedIds,
    ...(fetchDownlinks && { downlinkSatellites: downlinks ? Object.keys(downlinks).length : 0, downlinksFailed }),
  };
}

// HTTP status + JSON body for the cron route. A run that wrote nothing
// because groups failed is a 502 so Vercel Cron and monitors see the failure.
export function refreshResponse(result) {
  if (!result.written && result.failedGroups.length > 0) {
    return { status: 502, body: { ok: false, ...result } };
  }
  return { status: 200, body: { ok: true, ...result } };
}
