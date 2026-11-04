// lib/mirror/snapshot.mjs - pure snapshot build + gzip JSON codec.
// No I/O. Epoch guard reused from lib/mcp/tle-record.mjs.
import { gzipSync, gunzipSync } from 'node:zlib';
import { ommEpochMs } from '../sat/omm.mjs';
import { mergeRecord } from '../mcp/tle-record.mjs';

const VERSION = 1;

// Groups whose names are the ones people know and search for. A satellite in
// one takes that name; its catalog name stays as altName, for search. 'active'
// names GPS satellites NAVSTAR 43 (USA 132); 'gps-ops' calls it
// GPS BIIR-2  (PRN 13).
export const NAME_GROUPS = Object.freeze(['gps-ops']);
const tidy = (name) => String(name).replace(/\s+/g, ' ').trim();

// results: Record<group, { ok: true, omms } | { ok: false }>
// previous: Snapshot | null | undefined
export function buildSnapshot({ results, previous, nowMs }) {
  const prevObjects = (previous && previous.objects) || {};
  const failed = new Set();
  const incoming = new Map(); // key -> { record, seenGroups }
  const preferredNames = new Map(); // key -> name from a NAME_GROUPS group
  const catalogNames = new Map(); // key -> name from any other group

  for (const [group, res] of Object.entries(results || {})) {
    if (!res || !res.ok) { failed.add(group); continue; }
    for (const omm of res.omms) {
      const key = String(omm.NORAD_CAT_ID);
      if (omm.OBJECT_NAME) {
        if (NAME_GROUPS.includes(group)) preferredNames.set(key, tidy(omm.OBJECT_NAME));
        else catalogNames.set(key, omm.OBJECT_NAME);
      }
      const rec = {
        noradId: Number(omm.NORAD_CAT_ID),
        name: omm.OBJECT_NAME,
        omm,
        epochMs: ommEpochMs(omm),
        source: group.startsWith('catnr:') ? 'celestrak-catnr' : 'celestrak-gp',
        fetchedAtMs: nowMs,
        groups: [],
      };
      const cur = incoming.get(key);
      if (!cur) incoming.set(key, { record: rec, seenGroups: [group] });
      else {
        cur.record = mergeRecord(cur.record, rec);
        if (!cur.seenGroups.includes(group)) cur.seenGroups.push(group);
      }
    }
  }

  const objects = {};
  for (const [key, { record, seenGroups }] of incoming) {
    const prev = prevObjects[key];
    const { altName: _a, ...winner } = mergeRecord(prev, record);
    // Groups reflect this refresh, plus prior memberships in failed groups.
    const groups = [...seenGroups];
    if (prev) for (const g of prev.groups || []) if (failed.has(g) && !groups.includes(g)) groups.push(g);
    // The name: a name group's (this refresh's, or the last one's when that
    // group failed or was skipped), else the catalog name.
    const catalog = catalogNames.get(key) ?? (prev && (prev.altName ?? prev.name)) ?? winner.name;
    const kept = prev && (prev.groups || []).some((g) => NAME_GROUPS.includes(g) && failed.has(g)) ? prev.name : null;
    const preferred = preferredNames.get(key) ?? kept;
    const name = preferred ?? catalog;
    objects[key] = { ...winner, name, ...(preferred && preferred !== tidy(catalog) && { altName: catalog }), groups };
  }
  for (const [key, prev] of Object.entries(prevObjects)) {
    if (objects[key]) continue;
    if ((prev.groups || []).some((g) => failed.has(g))) objects[key] = prev;
  }
  // Last successful fetch per group, so the refresh can skip a group
  // CelesTrak has not updated yet.
  const groupFetchedAtMs = { ...((previous && previous.groupFetchedAtMs) || {}) };
  for (const [group, res] of Object.entries(results || {})) if (res && res.ok) groupFetchedAtMs[group] = nowMs;
  return { version: VERSION, generatedAtMs: nowMs, groupFetchedAtMs, objects };
}

export function encodeSnapshot(s) {
  return gzipSync(Buffer.from(JSON.stringify(s), 'utf8'));
}

export function decodeSnapshot(buf) {
  const s = JSON.parse(gunzipSync(buf).toString('utf8'));
  if (!s || s.version !== VERSION) throw new Error(`unsupported snapshot version: ${s && s.version}`);
  return s;
}
