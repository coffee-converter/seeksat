// lib/mirror/snapshot.mjs - pure snapshot build + gzip JSON codec.
// No I/O. Epoch guard reused from lib/mcp/tle-record.mjs.
import { gzipSync, gunzipSync } from 'node:zlib';
import { ommEpochMs } from '../sat/omm.mjs';
import { mergeRecord } from '../mcp/tle-record.mjs';

const VERSION = 1;

// results: Record<group, { ok: true, omms } | { ok: false }>
// previous: Snapshot | null | undefined
export function buildSnapshot({ results, previous, nowMs }) {
  const prevObjects = (previous && previous.objects) || {};
  const failed = new Set();
  const incoming = new Map(); // key -> { record, seenGroups }

  for (const [group, res] of Object.entries(results || {})) {
    if (!res || !res.ok) { failed.add(group); continue; }
    for (const omm of res.omms) {
      const key = String(omm.NORAD_CAT_ID);
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
    const winner = mergeRecord(prev, record);
    // Groups reflect this refresh, plus prior memberships in failed groups.
    const groups = [...seenGroups];
    if (prev) for (const g of prev.groups || []) if (failed.has(g) && !groups.includes(g)) groups.push(g);
    objects[key] = { ...winner, groups };
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
