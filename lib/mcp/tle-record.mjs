// lib/mcp/tle-record.mjs - pure TLE record shape + epoch-guarded merge.
// No I/O. The epoch guard guarantees a flaky source returning an older
// element set can never overwrite a newer stored one.

export function makeTleRecord(noradId, fetched, fetchedAtMs) {
  return {
    noradId,
    name: fetched.name,
    line1: fetched.line1,
    line2: fetched.line2,
    epochMs: fetched.epochMs,
    source: fetched.source,
    fetchedAtMs,
  };
}

// Return whichever record has the newer (larger) epochMs. Incoming wins
// ties (a re-fetch of the same epoch refreshes fetchedAtMs/source).
export function mergeRecord(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.epochMs >= existing.epochMs ? incoming : existing;
}

export function tleAgeHours(record, nowMs) {
  if (!record || !Number.isFinite(record.epochMs)) return null;
  return (nowMs - record.epochMs) / 3_600_000;
}
