// lib/catalog.mjs — curated, trackable satellites. Single source of
// truth shared by the webapp selector, the MCP tools, and the cron
// seeder. Pure data; safe to import into client components.
//
// Adding "track any NORAD id" later means relaxing resolveSatellite to
// synthesize an entry for an unknown numeric id.

export const CATALOG = [
  {
    noradId: 25544, name: 'ISS (ZARYA)', aliases: ['iss', 'zarya', 'space station'],
    tier: 'free', inclinationDeg: 51.6, standardMag: -1.8, viewingHint: null, defaultMode: 'visual',
  },
  {
    noradId: 48274, name: 'Tiangong (CSS)', aliases: ['tiangong', 'css', 'chinese space station'],
    tier: 'free', inclinationDeg: 41.5, standardMag: -1.0, viewingHint: null, defaultMode: 'visual',
  },
  {
    noradId: 53807, name: 'BlueWalker 3', aliases: ['bluewalker', 'bluewalker 3', 'bw3'],
    tier: 'free', inclinationDeg: 53.0, standardMag: 0.5,
    viewingHint: 'One of the brightest satellites — easy naked-eye target.',
    defaultMode: 'visual',
  },
  {
    noradId: 20580, name: 'Hubble Space Telescope', aliases: ['hubble', 'hst'],
    tier: 'free', inclinationDeg: 28.5, standardMag: 2.0,
    viewingHint: 'Low inclination — best seen from lower latitudes.',
    defaultMode: 'visual',
  },
  {
    noradId: 33591, name: 'NOAA-19', aliases: ['noaa', 'noaa-19', 'noaa19'],
    tier: 'free', inclinationDeg: 99.0, standardMag: 3.5,
    viewingHint: 'Polar weather satellite — too dim to see; use radio passes.',
    defaultMode: 'radio',
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
