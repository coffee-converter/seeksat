// lib/pass-finder/tle-seed.js - pure helpers for server-seeding the
// pass-finder TLE and guarding the client refresh by epoch. No I/O, no
// React. Reuses the existing parseTleEpoch.

import { parseTleEpoch } from "./tle.js";

// Map an Edge Config TLE record { noradId, name, line1, line2, ... } to
// the store's Tle shape { name, line1, line2 }. Returns null for a
// missing or structurally-invalid record so the seed path degrades to
// "no seed" rather than seeding garbage.
export function recordToTle(record) {
  if (!record) return null;
  const { name, line1, line2 } = record;
  if (typeof line1 !== "string" || typeof line2 !== "string") return null;
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return null;
  return { name: typeof name === "string" ? name : "", line1, line2 };
}

// True iff fetchedLine1's epoch is strictly newer than currentLine1's.
// A non-finite fetched epoch never wins (don't apply junk). A non-finite
// current epoch (empty/invalid store TLE) is always replaceable by a
// valid fetch.
export function isNewerTle(currentLine1, fetchedLine1) {
  const fetchedEpoch = parseTleEpoch(fetchedLine1);
  if (!Number.isFinite(fetchedEpoch)) return false;
  const currentEpoch = parseTleEpoch(currentLine1);
  if (!Number.isFinite(currentEpoch)) return true;
  return fetchedEpoch > currentEpoch;
}
