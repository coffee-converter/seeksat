// lib/tle-utils.ts - pure helpers for the Tle shape stored in the
// triangulate Zustand store. Used by ResultPanel/TlePanel/bootstrap to
// agree on what counts as "a TLE has been entered" and which two
// lines to feed satellite.js.

import type { Tle } from "./types";

export function tleHasContent(tle: Tle): boolean {
  return !!(tle.name.trim() || tle.line1.trim() || tle.line2.trim());
}

/**
 * Pick the two SGP4 element lines from the three textareas. Accepts
 * either {name, "1 …", "2 …"} or {"1 …", "2 …", ""} so the name field
 * is optional. Returns null when neither shape is valid.
 */
export function pickTleLines(tle: Tle): [string, string] | null {
  const a = tle.name.trim();
  const b = tle.line1.trim();
  const c = tle.line2.trim();
  if (b.startsWith("1 ") && c.startsWith("2 ")) return [b, c];
  if (a.startsWith("1 ") && b.startsWith("2 ")) return [a, b];
  return null;
}
