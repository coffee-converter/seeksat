// lib/mirror/on-demand.mjs - rate-limited per-ID CelesTrak lookup for objects
// the mirror snapshot does not hold. Hits and misses are cached; only real
// fetches spend the hourly budget (fixed window).
import { ommEpochMs } from '../sat/omm.mjs';

const HOUR_MS = 3_600_000;

export function createOnDemandFetcher({
  fetchByCatnr, now, maxPerHour = 60, hitTtlMs = 4 * HOUR_MS, missTtlMs = HOUR_MS,
}) {
  const cache = new Map(); // noradId -> { record | null, expiresAtMs }
  let windowStartMs = null;
  let used = 0;
  const inflight = new Map(); // noradId -> Promise, shared by concurrent callers

  function takeBudget(nowMs) {
    if (windowStartMs === null || nowMs - windowStartMs >= HOUR_MS) {
      windowStartMs = nowMs;
      used = 0;
    }
    if (used >= maxPerHour) return false;
    used += 1;
    return true;
  }

  return {
    get(noradId) {
      const nowMs = now();
      const hit = cache.get(noradId);
      if (hit && hit.expiresAtMs > nowMs) return Promise.resolve(hit.record);
      const pending = inflight.get(noradId);
      if (pending) return pending;
      if (!takeBudget(nowMs)) return Promise.resolve(null);
      const p = lookup(noradId, nowMs).finally(() => inflight.delete(noradId));
      inflight.set(noradId, p);
      return p;
    },
  };

  async function lookup(noradId, nowMs) {
    let omm;
    try {
      omm = await fetchByCatnr(noradId);
    } catch {
      return null; // not cached: retried on the next call
    }
    if (!omm) {
      cache.set(noradId, { record: null, expiresAtMs: nowMs + missTtlMs });
      return null;
    }
    const record = {
      noradId,
      name: omm.OBJECT_NAME,
      omm,
      epochMs: ommEpochMs(omm),
      source: 'celestrak-catnr',
      fetchedAtMs: nowMs,
      groups: [],
    };
    cache.set(noradId, { record, expiresAtMs: nowMs + hitTtlMs });
    return record;
  }
}
