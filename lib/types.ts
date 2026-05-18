// lib/types.ts — shared type definitions for the React-ified app.
//
// Pure TS; no DOM/Cesium imports. Used by the Zustand store, every UI
// component, and the eventual alert-runner backend.

/** ISO-8601 UTC string, e.g. "2026-05-18T22:35:00Z". */
export type IsoUtcString = string;

/** ECEF position in meters: [x, y, z]. */
export type EcefMeters = readonly [number, number, number];

/** TLE (Two-Line Element set) as it appears in the UI / persistence. */
export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

/**
 * Sky direction an observer reports for the satellite. Discriminated
 * by `mode`:
 *  - radec  → right ascension (hours) + declination (degrees), J2000
 *  - altaz  → azimuth (degrees, 0 = N, 90 = E) + altitude (degrees)
 *
 * Fields are nullable while the user is mid-input on a fresh row.
 */
export type ObservationDirection =
  | { mode: "radec"; raHours: number | null; decDeg: number | null }
  | { mode: "altaz"; azDeg: number | null; altDeg: number | null };

/** One observer-station reading. */
export interface Observation {
  /** Stable id — used as React key and for lookups. */
  id: string;
  /** User-editable label ("Obs 1", "Roof of building A", etc.). */
  name: string;
  /** Hex color string assigned from PALETTE on creation. */
  color: string;
  /** Geodetic latitude / longitude in decimal degrees. */
  latDeg: number | null;
  lonDeg: number | null;
  /**
   * Elevation in meters above WGS-84 ellipsoid. Auto-populated from
   * the elevation-lookup service if absent at parse time.
   */
  elevM?: number;
  dir: ObservationDirection;
}

/**
 * Built-in attempt that ships with the site under data/. The file
 * field points at the JSON payload (relative to /data/). User can
 * edit a manifest attempt; edits go to a localStorage override map
 * keyed by id, and the original manifest data is restorable.
 */
export interface ManifestAttemptEntry {
  source: "manifest";
  id: string;
  label: string;
  /** File path under /data/ holding the actual observations + tle. */
  file: string;
}

/**
 * User-created attempt — fully editable, stored as a single record
 * in localStorage under USER_ATTEMPTS_KEY. The `+` button on the
 * attempt picker creates one; the trash button deletes it.
 */
export interface UserAttemptEntry {
  source: "user";
  id: string;
  label: string;
  timestampUTC: IsoUtcString;
  observations: Observation[];
  defaultTle?: Tle;
  createdAt: IsoUtcString;
}

export type AttemptEntry = ManifestAttemptEntry | UserAttemptEntry;

/**
 * Resolved payload of an attempt — what fetchAttemptData returns.
 * For manifest attempts this is fetched from /data/<file>; for user
 * attempts it's the full record. Either way the runtime state shape
 * is the same.
 */
export interface AttemptData {
  timestampUTC: IsoUtcString;
  observations: Observation[];
  defaultTle?: Tle;
}

/**
 * Residual between an observation's direction and the triangulated
 * solution. Angular separation in degrees + which observation it
 * belongs to (by id, so the row can be highlighted).
 */
export interface Residual {
  observationId: string;
  angleSepDeg: number;
}
