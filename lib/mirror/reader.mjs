// lib/mirror/reader.mjs - read side of the mirror: snapshot first, then a
// rate-limited on-demand lookup. I/O (store, onDemand, clock, log) injected.
import { ommToTleLines } from '../sat/omm.mjs';
import { CATALOG } from '../catalog.mjs';

const CURATED = new Map(CATALOG.map((c) => [c.noradId, c]));

function served(record) {
  const out = { ...record };
  const lines = ommToTleLines(record.omm);
  if (lines) { out.line1 = lines.line1; out.line2 = lines.line2; }
  return out;
}

export function createCatalogReader({ store, onDemand, now, reloadMs = 15 * 60_000, log = console }) {
  let snapshot = null;
  let lastAttemptMs = null;
  let inflight = null;

  function startLoad(nowMs) {
    lastAttemptMs = nowMs;
    inflight = (async () => {
      try {
        const s = await store.read();
        if (s) snapshot = s;
      } catch (err) {
        log.warn(`catalog reader: snapshot read failed: ${err?.message ?? err}`);
      } finally {
        inflight = null;
      }
      return snapshot;
    })();
  }

  // Stale-while-revalidate: once a snapshot is held, a due reload runs in
  // the background and callers get the current snapshot right away. Only
  // the very first load (no snapshot yet) is awaited, shared by all callers.
  async function load() {
    const nowMs = now();
    const due = lastAttemptMs === null || nowMs - lastAttemptMs >= reloadMs;
    if (due && !inflight) startLoad(nowMs);
    if (snapshot) return snapshot;
    return inflight ?? snapshot;
  }

  return {
    async ready() {
      return (await load()) !== null;
    },

    // Snapshot only: never spends the on-demand CelesTrak budget or waits on
    // it. For latency-sensitive callers such as the home page seed.
    async getSnapshotRecord(noradId) {
      const s = await load();
      const rec = s?.objects[String(noradId)];
      return rec ? served(rec) : null;
    },

    async getRecord(noradId) {
      const s = await load();
      const rec = s?.objects[String(noradId)];
      if (rec) return served(rec);
      const fetched = await onDemand.get(noradId);
      return fetched ? served(fetched) : null;
    },

    async search(query, limit = 20) {
      const q = String(query ?? '').trim().toLowerCase();
      if (!q) return [];
      const s = await load();
      if (!s) return [];
      const hits = [];
      for (const rec of Object.values(s.objects)) {
        const name = String(rec.name ?? '').toLowerCase();
        const curated = CURATED.get(rec.noradId);
        let rank = 0;
        if (String(rec.noradId) === q) rank = 1;
        else if (name === q || curated?.aliases?.includes(q)) rank = 2;
        else if (name.startsWith(q)) rank = 3;
        else if (name.includes(q)) rank = 4;
        if (rank) hits.push({ rank, curated: curated ? 0 : 1, rec });
      }
      hits.sort((a, b) => a.rank - b.rank || a.curated - b.curated
        || (a.rec.name < b.rec.name ? -1 : a.rec.name > b.rec.name ? 1 : 0));
      return hits.slice(0, Math.max(0, limit)).map(({ rec }) => ({ noradId: rec.noradId, name: rec.name }));
    },

    // Snapshot ids, ascending. Never touches the on-demand path.
    async noradIds() {
      const s = await load();
      if (!s) return [];
      return Object.values(s.objects).map((r) => r.noradId).sort((a, b) => a - b);
    },

    generatedAtMs() {
      return snapshot ? snapshot.generatedAtMs : null;
    },
  };
}
