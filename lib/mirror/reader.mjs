// lib/mirror/reader.mjs - read side of the mirror: snapshot first, then a
// rate-limited on-demand lookup. I/O (store, onDemand, clock, log) injected.
import { ommToTleLines } from '../sat/omm.mjs';
import { CATALOG, downlinksFor } from '../catalog.mjs';
import { bandsOf } from '../radio/bands.mjs';
import { prepareEntry, rankHits } from './fuzzy.mjs';

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
// Words a radio-mode search treats as "satellites with this kind of
// downlink" rather than as part of a name.
const RADIO_WORDS = new Set([
  'fm', 'ssb', 'usb', 'lsb', 'cw', 'sstv', 'aprs', 'afsk', 'bpsk', 'gmsk', 'fsk', 'lrpt', 'apt',
  'repeater', 'transponder', 'beacon', 'digipeater', 'voice', 'telemetry',
]);

/** A satellite's downlinks as served: curated ones first, else the snapshot's. */
function downlinksOf(snapshot, noradId) {
  return downlinksFor(CURATED.get(noradId), { downlinks: snapshot?.downlinks?.[String(noradId)] });
}

/** Satellites with a downlink of this kind, curated ones first. */
function byDownlinkWord(snapshot, word, limit) {
  const re = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i');
  const hit = (id) => downlinksOf(snapshot, id).some((d) => d.mode === word || re.test(d.label));
  const ids = new Set([
    ...CATALOG.map((c) => c.noradId),
    ...Object.keys(snapshot.downlinks ?? {}).map(Number),
  ]);
  const out = [];
  for (const id of ids) {
    const rec = snapshot.objects[String(id)];
    if (!rec || !hit(id)) continue;
    out.push({ noradId: id, name: CURATED.get(id)?.name ?? String(rec.name ?? id), radio: true, bands: bandsOf(downlinksOf(snapshot, id)), tier: 0 });
    if (out.length >= limit) break;
  }
  return out;
}

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

    // Each result says whether the satellite has known downlinks, and how
    // well its name matched (tier, lower is better; lib/mirror/fuzzy.mjs
    // rankHits). In radio mode those with downlinks come first among equally
    // good matches, and a downlink word ("fm", "sstv") finds satellites with
    // that kind of downlink (all tier 0).
    async search(query, limit = 20, { radio = false } = {}) {
      const q = String(query ?? '').trim();
      if (!q) return [];
      const s = await load();
      if (!s) return [];
      const max = Math.max(0, limit);
      if (radio && RADIO_WORDS.has(q.toLowerCase())) return byDownlinkWord(s, q.toLowerCase(), max);
      const hits = rankHits(q, searchIndex(s), radio ? max * 3 : max)
        .map(({ entry: e, tier }) => {
          const links = downlinksOf(s, e.noradId);
          return { tier, result: { noradId: e.noradId, name: e.name, radio: links.length > 0, bands: bandsOf(links), tier } };
        });
      if (!radio) return hits.map((h) => h.result);
      // Radio mode lifts satellites with downlinks within each match tier, so
      // a better name match (SDO for "sdo") still beats a weaker one with a
      // frequency. The sort is stable: relevance order holds inside a group.
      return hits
        .sort((a, b) => a.tier - b.tier || (a.result.radio ? 0 : 1) - (b.result.radio ? 0 : 1))
        .slice(0, max)
        .map((h) => h.result);
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
