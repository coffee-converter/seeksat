// lib/catalog.mjs - curated, trackable satellites. Single source of
// truth shared by the webapp selector, the MCP tools, and the cron
// seeder. Pure data; safe to import into client components.
//
// Adding "track any NORAD id" later means relaxing resolveSatellite to
// synthesize an entry for an unknown numeric id.

export const CATALOG = [
  {
    noradId: 25544, name: 'ISS (ZARYA)', shortName: 'ISS', aliases: ['iss', 'zarya', 'space station'],
    tier: 'free', inclinationDeg: 51.6, standardMag: -1.8, viewingHint: null, defaultMode: 'visual',
    // Verified against ARISS/AMSAT sources 2026-09.
    // APRS is deliberately omitted: 145.825 is the long-standing digipeater
    // frequency but packet operations have reportedly moved to 437.825 from
    // Zvezda. Verify before adding.
    downlinks: [
      {
        hz: 437_800_000, label: 'FM cross-band repeater', mode: 'fm',
        // NOT a beacon: it transmits only while someone is uplinking on
        // 145.990 with a 67.0 Hz tone, so a recording will have gaps - and
        // the AOS/LOS extremes are exactly when it is least likely to be in
        // use, which biases a measured peak-to-peak low.
        duty: 'on-demand', default: true,
      },
      {
        hz: 145_800_000, label: 'Voice / SSTV', mode: 'fm',
        // Continuous for minutes at a time during scheduled SSTV events -
        // the best continuous-carrier target on this satellite.
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
];

// Resolve a NORAD id (number or numeric string) or a name/alias
// (case-insensitive) to a catalog entry, or null if unknown.
export function resolveSatellite(idOrName) {
  if (idOrName == null) return null;
  const asNum = Number(idOrName);
  if (Number.isInteger(asNum)) {
    return CATALOG.find(s => s.noradId === asNum) ?? null;
  }
  const q = String(idOrName).trim().toLowerCase();
  if (!q) return null;
  return CATALOG.find(s =>
    s.name.toLowerCase() === q || s.aliases.includes(q),
  ) ?? null;
}

/** The downlink a satellite should chart by default: the one flagged
 *  `default`, else the first, else null for satellites with no known
 *  receivable downlink. */
export function defaultDownlink(entry) {
  if (!entry || !Array.isArray(entry.downlinks) || !entry.downlinks.length) return null;
  return entry.downlinks.find((d) => d.default) ?? entry.downlinks[0];
}
