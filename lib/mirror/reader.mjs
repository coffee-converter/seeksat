// lib/mirror/reader.mjs - read side of the mirror: snapshot first, then a
// rate-limited on-demand lookup. I/O (store, onDemand, clock, log) injected.
import { ommToTleLines } from '../sat/omm.mjs';
import { CATALOG, downlinksFor } from '../catalog.mjs';
import { bandsOf } from '../radio/bands.mjs';
import { RADIO_WORDS, downlinkHasWord } from '../radio/modes.mjs';
import { prepareEntry, rankHits } from './fuzzy.mjs';

const CURATED = new Map(CATALOG.map((c) => [c.noradId, c]));
const RANKED_GROUPS = ['active', 'visual', 'weather'];
const indexes = new WeakMap(); // snapshot object -> prepared search entries
const skies = new WeakMap(); // snapshot object -> sky catalog list
const visuals = new WeakMap(); // snapshot object -> ids in the visual group

function searchIndex(snapshot) {
  let index = indexes.get(snapshot);
  if (index) return index;
  index = Object.values(snapshot.objects).map((rec) => {
    const name = String(rec.name ?? '');
    const c = CURATED.get(rec.noradId);
    return prepareEntry({
      noradId: rec.noradId,
      // A curated satellite shows by the name the rest of the site uses
      // ("Tiangong (CSS)", not "CSS (TIANHE)"); its catalog name still finds it.
      name: c?.name ?? name,
      // The catalog name when the record shows another (GPS: NAVSTAR 43 (USA 132)).
      aliases: [...(rec.altName ? [rec.altName] : []), ...(c ? [name, c.shortName, ...(c.aliases ?? [])] : [])],
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
// downlink" rather than as part of a name (lib/radio/modes.mjs).
const RADIO_WORD_SET = new Set(RADIO_WORDS);

/** A satellite's downlinks as served: curated ones first, else the snapshot's. */
function downlinksOf(snapshot, noradId) {
  return downlinksFor(CURATED.get(noradId), { downlinks: snapshot?.downlinks?.[String(noradId)] });
}

/** Curated ids, then every id the snapshot has downlinks for: everything
 *  that may have a known downlink, before checking. */
function radioCandidates(snapshot) {
  return new Set([
    ...CATALOG.map((c) => c.noradId),
    ...Object.keys(snapshot.downlinks ?? {}).map(Number),
  ]);
}

/** Satellites with a downlink of this kind, curated ones first. */
function byDownlinkWord(snapshot, word, limit) {
  const hit = (id) => downlinksOf(snapshot, id).some((d) => downlinkHasWord(d, word));
  const out = [];
  for (const id of radioCandidates(snapshot)) {
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
      if (radio && RADIO_WORD_SET.has(q.toLowerCase())) return byDownlinkWord(s, q.toLowerCase(), max);
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

    // Ids of satellites with known downlinks (curated or the snapshot's
    // SatNOGS ones) that the snapshot has orbits for, ascending. Snapshot
    // only, so a scan over them never spends the on-demand budget.
    async radioIds() {
      const s = await load();
      if (!s) return [];
      return [...radioCandidates(s)]
        .filter((id) => s.objects[String(id)] && downlinksOf(s, id).length > 0)
        .sort((a, b) => a - b);
    },

    // Ids of satellites in CelesTrak's "visual" group (the brightest objects
    // in the sky, many of them spent rocket bodies), ascending. The snapshot
    // records each object's groups. Snapshot only, like radioIds.
    async visualIds() {
      const s = await load();
      if (!s) return [];
      let ids = visuals.get(s);
      if (!ids) {
        ids = Object.values(s.objects)
          .filter((r) => (r.groups ?? []).includes('visual'))
          .map((r) => r.noradId)
          .sort((a, b) => a - b);
        visuals.set(s, ids);
      }
      return ids;
    },

    // Every satellite in the snapshot as { noradId, record, downlinks }, for
    // tools that look at the whole sky at once. The records are the stored
    // ones, not copies (callers must not change them), and the list is built
    // once per snapshot, so a caller can key its own per-snapshot work (such
    // as satrecs) on it.
    async skyCatalog() {
      const s = await load();
      if (!s) return [];
      let list = skies.get(s);
      if (!list) {
        list = Object.values(s.objects).map((rec) => ({ noradId: rec.noradId, record: rec, downlinks: downlinksOf(s, rec.noradId) }));
        skies.set(s, list);
      }
      return list;
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
