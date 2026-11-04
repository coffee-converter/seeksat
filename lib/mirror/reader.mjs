// lib/mirror/reader.mjs - read side of the mirror: snapshot first, then a
// rate-limited on-demand lookup. I/O (store, onDemand, clock, log) injected.
import { ommToTleLines } from '../sat/omm.mjs';
import { CATALOG } from '../catalog.mjs';
import { prepareEntry, rankEntries } from './fuzzy.mjs';

const CURATED = new Map(CATALOG.map((c) => [c.noradId, c]));
const RANKED_GROUPS = ['active', 'visual', 'weather'];
const indexes = new WeakMap(); // snapshot object -> prepared search entries

function searchIndex(snapshot) {
  let index = indexes.get(snapshot);
  if (index) return index;
  index = Object.values(snapshot.objects).map((rec) => {
    const name = String(rec.name ?? '');
    const c = CURATED.get(rec.noradId);
    return prepareEntry({
      noradId: rec.noradId,
      name,
      // The catalog name when the record shows another (GPS: NAVSTAR 43 (USA 132)).
      aliases: [...(rec.altName ? [rec.altName] : []), ...(c ? [c.name, c.shortName, ...(c.aliases ?? [])] : [])],
      curated: !!c,
      inGroups: (rec.groups ?? []).some((g) => RANKED_GROUPS.includes(g)),
      debris: / DEB| R\/B/.test(name),
    });
  });
  indexes.set(snapshot, index);
  return index;
}

// A record as served: TLE lines from its OMM, and the snapshot's downlinks
// for it (SatNOGS DB) when it has any.
function served(record, snapshot) {
  const out = { ...record };
  const downlinks = snapshot?.downlinks?.[String(record.noradId)];
  if (Array.isArray(downlinks) && downlinks.length) out.downlinks = downlinks;
  const lines = ommToTleLines(record.omm);
  if (lines) { out.line1 = lines.line1; out.line2 = lines.line2; }
  return out;
}

export function createCatalogReader({ store, onDemand, now, reloadMs = 15 * 60_000, emptyRetryMs = 30_000, log = console }) {
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
    // Without a snapshot, a failed or empty read is retried after
    // emptyRetryMs, not reloadMs: every lookup meanwhile falls through to the
    // on-demand budget, so a long wait would spend it all.
    const waitMs = snapshot ? reloadMs : emptyRetryMs;
    const due = lastAttemptMs === null || nowMs - lastAttemptMs >= waitMs;
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
      return rec ? served(rec, s) : null;
    },

    // A record, null for a confirmed miss, or undefined when the on-demand
    // answer is unknown (budget spent or the lookup failed).
    async getRecord(noradId) {
      const s = await load();
      const rec = s?.objects[String(noradId)];
      if (rec) return served(rec, s);
      const fetched = await onDemand.get(noradId);
      if (fetched === undefined) return undefined;
      return fetched ? served(fetched, s) : null;
    },

    async search(query, limit = 20) {
      if (!String(query ?? '').trim()) return [];
      const s = await load();
      if (!s) return [];
      return rankEntries(query, searchIndex(s), Math.max(0, limit))
        .map((e) => ({ noradId: e.noradId, name: e.name }));
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
