// lib/catalog.mjs - curated, trackable satellites. Single source of
// truth shared by the webapp selector, the MCP tools, and the cron
// seeder. Pure data; safe to import into client components.
//
// CATALOG is the curated popular set. resolveSatellite also synthesizes an
// entry for any other positive NORAD id.

export const CATALOG = [
  {
    noradId: 25544, name: 'ISS (ZARYA)', shortName: 'ISS', aliases: ['iss', 'zarya', 'space station'],
    tier: 'free', inclinationDeg: 51.6, standardMag: -1.8, viewingHint: null, defaultMode: 'visual',
    // Verified against ARISS/AMSAT sources 2026-09; SSTV updated 2026-11:
    // ARISS SSTV series 31 and 32 (April and May 2026) and the October 2026
    // activation all sent Robot 36 on 437.550 MHz (ARISS, AMSAT-UK, IARU R1).
    // APRS is deliberately omitted: 145.825 is the long-standing digipeater
    // frequency but packet operations have reportedly moved to 437.825 from
    // Zvezda. Verify before adding.
    downlinks: [
      {
        hz: 437_800_000, label: 'FM cross-band repeater', mode: 'fm',
        uplink: { hz: 145_990_000, mode: 'fm', tone: 67 },
        // NOT a beacon: it transmits only while someone is uplinking on
        // 145.990 with a 67.0 Hz tone, so a recording will have gaps - and
        // the AOS/LOS extremes are exactly when it is least likely to be in
        // use, which biases a measured peak-to-peak low.
        duty: 'on-demand', default: true,
      },
      {
        // SSTV is sent as FM audio: the receiver's mode is FM.
        hz: 437_550_000, label: 'SSTV events (Robot 36)', mode: 'fm',
        // ARISS SSTV events since 2025: about 36 s per image, 2 min apart,
        // for days at a time - the best continuous-carrier target while one
        // runs. Dates are announced a few days ahead.
        duty: 'scheduled',
      },
      {
        hz: 145_800_000, label: 'Voice (crew contacts), older SSTV events', mode: 'fm',
        duty: 'scheduled',
      },
    ],
  },
  {
    noradId: 48274, name: 'Tiangong (CSS)', shortName: 'Tiangong', aliases: ['tiangong', 'css', 'chinese space station'],
    tier: 'free', inclinationDeg: 41.5, standardMag: -1.0, viewingHint: null, defaultMode: 'visual',
    downlinks: [],
  },
  {
    noradId: 53807, name: 'BlueWalker 3', shortName: 'BlueWalker 3', aliases: ['bluewalker', 'bluewalker 3', 'bw3'],
    tier: 'free', inclinationDeg: 53.0, standardMag: 0.5,
    viewingHint: 'One of the brightest satellites - easy naked-eye target.',
    defaultMode: 'visual',
    downlinks: [],
  },
  {
    noradId: 20580, name: 'Hubble Space Telescope', shortName: 'Hubble', aliases: ['hubble', 'hst'],
    tier: 'free', inclinationDeg: 28.5, standardMag: 2.0,
    viewingHint: 'Low inclination - best seen from lower latitudes.',
    defaultMode: 'visual',
    downlinks: [],
  },
  {
    noradId: 33591, name: 'NOAA-19', shortName: 'NOAA-19', aliases: ['noaa', 'noaa-19', 'noaa19'],
    tier: 'free', inclinationDeg: 99.0, standardMag: 3.5,
    viewingHint: 'Decommissioned 2025-08-13 - no longer transmits. Still tracked; a faint visual target.',
    defaultMode: 'visual',
    downlinks: [],
  },
  {
    noradId: 57166, name: 'METEOR-M2 3', shortName: 'Meteor-M2 3', aliases: ['meteor-m2 3', 'meteor m2-3', 'meteor-m2-3'],
    tier: 'free', inclinationDeg: 98.7, standardMag: null, viewingHint: null, defaultMode: 'radio',
    // Verified 2026-11-01 against WMO OSCAR (137.1 / 137.9 MHz LRPT) and SatNOGS DB (137.9 MHz). 137.9 is the usual channel; operators switch to 137.1 at times.
    downlinks: [
      { hz: 137_900_000, label: 'LRPT', mode: 'lrpt', duty: 'continuous', default: true },
      { hz: 137_100_000, label: 'LRPT alternate channel', mode: 'lrpt', duty: 'occasional' },
    ],
  },
  {
    noradId: 59051, name: 'METEOR-M2 4', shortName: 'Meteor-M2 4', aliases: ['meteor-m2 4', 'meteor m2-4', 'meteor-m2-4'],
    tier: 'free', inclinationDeg: 98.7, standardMag: null, viewingHint: null, defaultMode: 'radio',
    // Verified 2026-11-01 against WMO OSCAR (137.1 / 137.9 MHz LRPT) and SatNOGS DB (137.9 MHz). 137.9 is the usual channel; operators switch to 137.1 at times.
    downlinks: [
      { hz: 137_900_000, label: 'LRPT', mode: 'lrpt', duty: 'continuous', default: true },
      { hz: 137_100_000, label: 'LRPT alternate channel', mode: 'lrpt', duty: 'occasional' },
    ],
  },
  {
    noradId: 27607, name: 'SAUDISAT 1C (SO-50)', shortName: 'SO-50', aliases: ['so-50', 'so50', 'saudisat 1c'],
    tier: 'free', inclinationDeg: 64.6, standardMag: null, viewingHint: null, defaultMode: 'radio',
    // Verified 2026-11-01 against the AMSAT FM satellites page (uplink 145.850 MHz, 67.0 Hz tone; arm the 10-minute timer with a 74.4 Hz tone).
    downlinks: [
      { hz: 436_795_000, label: 'FM repeater', mode: 'fm', duty: 'on-demand', default: true, uplink: { hz: 145_850_000, mode: 'fm', tone: 67 } },
    ],
  },
  {
    noradId: 44909, name: 'RS-44 & BREEZE-KM R/B', shortName: 'RS-44', aliases: ['rs-44', 'rs44', 'dosaaf-85', 'dosaaf 85'],
    tier: 'free', inclinationDeg: 82.5, standardMag: null, viewingHint: null, defaultMode: 'radio',
    // Verified 2026-11-01 against AMSAT's RS-44 page (downlink 435.610-435.670 MHz USB/CW, CW beacon 435.605 MHz, updated 2025-04-27) and SatNOGS DB (V/U transponder from 435.610 MHz, CW beacon 435.605 MHz). The transponder passband is 435.610-435.670 MHz; 435.640 is its midpoint.
    downlinks: [
      { hz: 435_605_000, label: 'CW beacon', mode: 'cw', duty: 'continuous', default: true },
      {
        hz: 435_640_000, label: 'Linear transponder (passband centre)', mode: 'ssb', duty: 'on-demand',
        // Uplink 145.935-145.995 MHz LSB, inverting (AMSAT's RS-44 page and SatNOGS DB).
        uplink: { hz: 145_935_000, highHz: 145_995_000, mode: 'lsb', invert: true },
      },
    ],
  },
  {
    noradId: 61781, name: 'ASRTU-1 (AO-123)', shortName: 'AO-123', aliases: ['ao-123', 'ao123', 'asrtu-1', 'asrtu 1'],
    tier: 'free', inclinationDeg: 97.3, standardMag: null, viewingHint: null, defaultMode: 'radio',
    // Verified 2026-11-01 against the AMSAT FM satellites page (uplink 145.850 MHz, 67 Hz tone) and SatNOGS DB (V/U FM transceiver, 435.400 MHz). Reported on the AMSAT status page Oct 27 - Nov 1 2026.
    downlinks: [
      { hz: 435_400_000, label: 'FM repeater', mode: 'fm', duty: 'on-demand', default: true, uplink: { hz: 145_850_000, mode: 'fm', tone: 67 } },
    ],
  },
];

const MAX_NORAD_ID = 999_999_999;

// Any positive NORAD id outside the curated CATALOG is trackable; its
// display name comes from the orbit record once one is fetched.
function synthesizeEntry(noradId) {
  return {
    noradId, name: String(noradId), shortName: null, aliases: [], tier: 'free',
    standardMag: null, defaultMode: 'radio', downlinks: [],
  };
}

// Resolve a NORAD id (number or numeric string) or a name/alias
// (case-insensitive) to a catalog entry, or null if unknown.
export function resolveSatellite(idOrName) {
  if (idOrName == null) return null;
  const q = String(idOrName).trim().toLowerCase();
  if (!q) return null;
  if (typeof idOrName === 'number' || /^-?\d+$/.test(q)) {
    const asNum = Number(q);
    // Same upper bound as the mirror API routes (lib/mirror/api.mjs).
    if (!Number.isInteger(asNum) || asNum <= 0 || asNum > MAX_NORAD_ID) return null;
    return CATALOG.find(s => s.noradId === asNum) ?? synthesizeEntry(asNum);
  }
  return CATALOG.find(s =>
    s.name.toLowerCase() === q || s.aliases.includes(q),
  ) ?? null;
}

const CURATED_IDS = new Set(CATALOG.map((s) => s.noradId));

/** True for entries from the curated CATALOG, false for synthesized ones. */
export function isCurated(entry) {
  return CURATED_IDS.has(entry.noradId);
}

/** Name to show for a satellite: the curated name for catalog entries, else
 *  the orbit record's name for synthesized ones, else "NORAD <id>" when no
 *  record has been fetched yet. */
export function displayName(entry, record) {
  if (isCurated(entry)) return entry.name;
  return record?.name || `NORAD ${entry.noradId}`;
}

/** The downlink a satellite should chart by default: the one flagged
 *  `default`, else the first, else null for satellites with no known
 *  receivable downlink. */
/** The downlinks to show for a satellite: the curated, hand-verified ones
 *  when the catalog has any, else the record's (SatNOGS DB, via the snapshot). */
export function downlinksFor(entry, record) {
  if (entry && Array.isArray(entry.downlinks) && entry.downlinks.length) return entry.downlinks;
  return record && Array.isArray(record.downlinks) ? record.downlinks : [];
}

export function defaultDownlink(entry) {
  if (!entry || !Array.isArray(entry.downlinks) || !entry.downlinks.length) return null;
  return entry.downlinks.find((d) => d.default) ?? entry.downlinks[0];
}
