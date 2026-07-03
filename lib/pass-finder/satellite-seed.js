// lib/pass-finder/satellite-seed.js - pure helpers for seeding the
// per-satellite TLE map from Edge Config records and computing the
// store patch when the user selects a satellite. No I/O, no React.

import { recordToTle } from './tle-seed.js';

// Build { [noradId]: Tle } from an Edge Config record map, including
// only catalog satellites with a structurally-valid record.
export function recordsToSatelliteTles(catalog, recordMap) {
  const out = {};
  for (const sat of catalog) {
    const tle = recordToTle(recordMap?.[String(sat.noradId)]);
    if (tle) out[sat.noradId] = tle;
  }
  return out;
}

// Compute the store patch for selecting `noradId`: always the new
// selection + the satellite's default pass mode; the seeded TLE too
// when one is cached. Returns null for an unknown id.
export function selectionUpdate(catalog, satelliteTles, noradId) {
  const entry = catalog.find((s) => s.noradId === noradId);
  if (!entry) return null;
  const patch = { selectedNoradId: entry.noradId, mode: entry.defaultMode };
  const tle = satelliteTles?.[entry.noradId];
  if (tle) patch.tle = tle;
  return patch;
}
