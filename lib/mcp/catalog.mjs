// lib/mcp/catalog.mjs — curated, trackable satellites.
// The MCP layer is satellite-agnostic: it takes an identifier and
// resolves it here. Adding "track any NORAD id" later means relaxing
// resolveSatellite to synthesize an entry for an unknown numeric id.

export const CATALOG = [
  { noradId: 25544, name: 'ISS (ZARYA)', aliases: ['iss', 'zarya', 'space station'] },
  { noradId: 20580, name: 'Hubble Space Telescope', aliases: ['hubble', 'hst'] },
  { noradId: 48274, name: 'Tiangong (CSS)', aliases: ['tiangong', 'css', 'chinese space station'] },
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
