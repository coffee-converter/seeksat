import { parseDmsToDecimal } from '../coords.js';

// Maidenhead grid locators (EN52ve). Work in the smallest unit the
// 8-character form resolves: 1/240 degree of latitude, 2/240 degree of
// longitude. Every pair then reduces to integer divides.
const GRID_RE = /^([A-R]{2})(\d{2})(?:([A-X]{2})(\d{2})?)?$/i;
const LAT_UNITS_PER_DEG = 240;
const LON_UNITS_PER_DEG = 120;

// Centre of a 4-, 6- or 8-character square, or null if it is not one.
export function gridToLatLon(grid) {
  const m = GRID_RE.exec(String(grid ?? '').trim());
  if (!m) return null;
  const [, field, square, sub, ext] = m;
  const code = (s, i) => s.toUpperCase().charCodeAt(i) - 65;
  const pair = (fieldIdx, squareIdx, subIdx, extIdx) => {
    let units = fieldIdx * 2400 + squareIdx * 240;
    let size = 240;
    if (subIdx != null) { units += subIdx * 10; size = 10; }
    if (extIdx != null) { units += extIdx; size = 1; }
    return { units, size };
  };
  const lonPair = pair(code(field, 0), Number(square[0]),
    sub ? code(sub, 0) : null, ext ? Number(ext[0]) : null);
  const latPair = pair(code(field, 1), Number(square[1]),
    sub ? code(sub, 1) : null, ext ? Number(ext[1]) : null);
  return {
    latDeg: (latPair.units + latPair.size / 2) / LAT_UNITS_PER_DEG - 90,
    lonDeg: (lonPair.units + lonPair.size / 2) / LON_UNITS_PER_DEG - 180,
  };
}

// Grid square for a point. chars is 4, 6 or 8. Latitude is clamped into
// [-90, 90), longitude wrapped into [-180, 180).
export function latLonToGrid(latDeg, lonDeg, chars = 6) {
  const latUnits = Math.min(Math.max(Math.floor((latDeg + 90) * LAT_UNITS_PER_DEG), 0), 180 * LAT_UNITS_PER_DEG - 1);
  const lonWrapped = (((lonDeg + 180) % 360) + 360) % 360;
  const lonUnits = Math.min(Math.floor(lonWrapped * LON_UNITS_PER_DEG), 360 * LON_UNITS_PER_DEG - 1);
  const letter = (n, lower) => String.fromCharCode((lower ? 97 : 65) + n);
  const digits = (u) => Math.floor(u / 240) % 10;
  const sub = (u) => Math.floor(u / 10) % 24;
  let out = letter(Math.floor(lonUnits / 2400), false) + letter(Math.floor(latUnits / 2400), false)
    + digits(lonUnits) + digits(latUnits);
  if (chars >= 6) out += letter(sub(lonUnits), true) + letter(sub(latUnits), true);
  if (chars >= 8) out += (lonUnits % 10) + '' + (latUnits % 10);
  return out;
}

function tryParseLatLon(raw) {
  // Need a comma with two non-empty pieces. Without that, fall
  // through to geocode (place names rarely include a stray comma
  // followed by something that parses as a coord).
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  try {
    const latDeg = parseDmsToDecimal(parts[0]);
    const lonDeg = parseDmsToDecimal(parts[1]);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
    return { latDeg, lonDeg };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ kind: 'grid', grid: string, latDeg: number, lonDeg: number }
 *   | { kind: 'coords', latDeg: number, lonDeg: number }
 *   | { kind: 'place', query: string }
 *   | { kind: 'invalid', message: string }} LocationInput
 */

// Classify what the user typed: grid square, lat/lon pair, or a place
// name to geocode. Null for blank input.
/** @returns {LocationInput | null} */
export function parseLocationInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const pos = gridToLatLon(raw);
  if (pos) {
    const grid = raw.slice(0, 2).toUpperCase() + raw.slice(2, 4)
      + raw.slice(4, 6).toLowerCase() + raw.slice(6);
    return { kind: 'grid', grid, ...pos };
  }
  const coords = tryParseLatLon(raw);
  if (coords) {
    // Out of range is still coordinates: say so rather than search for them.
    if (Math.abs(coords.latDeg) > 90 || Math.abs(coords.lonDeg) > 180) {
      return { kind: 'invalid', message: 'Latitude runs from -90 to 90 and longitude from -180 to 180.' };
    }
    return { kind: 'coords', ...coords };
  }
  return { kind: 'place', query: raw };
}
