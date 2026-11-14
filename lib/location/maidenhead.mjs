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

// ---- A latitude and longitude written out --------------------------------
// People and agents write positions many ways; all of these read as
// 41.88, -87.63:
//   41.88, -87.63 · 41.88 -87.63 · 41.88;-87.63 · +41.88, -87.63
//   41.88N 87.63W · N41.88 W87.63 · 41.88 N, 87.63 W · 87.63W 41.88N
//   41°52'48"N 87°37'48"W · 41 52 48 N 87 37 48 W · 41°52.8′N, 87°37.8′W
//   41d52m48sN 87d37m48sW · 41.88 deg N, 87.63 deg W
//   41.88°, -87.63° · lat: 41.88, lon: -87.63 · latitude 41.88 longitude -87.63
//   41,88; -87,63 (decimal commas, with a semicolon between)
//   geo:41.88,-87.63 · https://www.google.com/maps/@41.88,-87.63,12z · …?q=41.88,-87.63
// Anything else is left for the geocoder.

/** Longer text is no position (and is not worth parsing): a cap on work. */
export const MAX_INPUT = 200;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
/** One coordinate: an optional hemisphere letter before or after, degrees,
 *  and optional minutes and seconds, with or without their marks. */
const COORD_RE = new RegExp(
  String.raw`^([NSEW])?\s*(-?${NUM})\s*°?\s*(?:(${NUM})\s*'?\s*(?:(${NUM})\s*(?:"|'')?)?)?\s*([NSEW])?$`,
  'i',
);

/** Typographic marks, dashes, labels and signs, made plain. */
function plainCoordText(raw) {
  return String(raw)
    .replace(/[‐-―−﹣－]/g, '-')
    .replace(/[′‘’ʼ`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/[º˚]/g, '°')
    // Unit words and letters as marks: "41d52m48s" and "41 deg" (a lone s
    // or m would read as a hemisphere or be unclear, so only whole forms).
    .replace(/(\d+(?:\.\d+)?)\s*d\s*(\d+(?:\.\d+)?)\s*m\s*(\d+(?:\.\d+)?)\s*s(?=$|[^A-Za-z]|[NSEWnsew](?![A-Za-z]))/gi, '$1°$2\'$3"')
    .replace(/(\d+(?:\.\d+)?)\s*d\s*(\d+(?:\.\d+)?)\s*m(?=$|[^A-Za-z]|[NSEWnsew](?![A-Za-z]))/gi, "$1°$2'")
    .replace(/(\d)\s*(?:degrees|degree|deg)\b/gi, '$1°')
    .replace(/\b(?:latitude|lat)\b\s*[:=]?/gi, ' ')
    .replace(/\b(?:longitude|long|lng|lon)\b\s*[:=]?/gi, ' ; ')
    // A run of separators around a label's ";" is one separator.
    .replace(/[\s,;|]*;[\s,;|]*/g, ' ; ')
    .replace(/(^|[\s,;])\+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[;,\s]+/, '');
}

/** One coordinate in decimal degrees, its hemisphere letter ('' if none),
 *  or null when it is not one. */
function readCoord(text) {
  const m = COORD_RE.exec(text.trim());
  if (!m) return null;
  const [, pre, d, mi, se, post] = m;
  if (pre && post) return null;
  const n = (v) => (v == null ? 0 : Number(v.replace(',', '.')));
  const deg = n(d), min = n(mi), sec = n(se);
  if (!Number.isFinite(deg) || min >= 60 || sec >= 60) return null;
  if ((mi != null || se != null) && /[.,]/.test(d)) return null;
  const hemi = (pre || post || '').toUpperCase();
  if (deg < 0 && (hemi === 'S' || hemi === 'W')) return null;
  const value = Math.sign(deg || 1) * (Math.abs(deg) + min / 60 + sec / 3600) * (hemi === 'S' || hemi === 'W' ? -1 : 1);
  return { value, hemi };
}

/** The two halves of a written position, or null. */
function splitPair(s) {
  // A map link or geo: URI: the pair it carries.
  const link = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s)
    ?? /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i.exec(s)
    ?? /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(s);
  if (link) return [link[1], link[2]];
  const bySemi = s.split(/\s*[;|]\s*/).filter(Boolean);
  if (bySemi.length === 2) return bySemi;
  const byComma = s.split(/\s*,\s*/).filter(Boolean);
  if (byComma.length === 2) return byComma;
  // No separator: split between whitespace-separated tokens, at the one place
  // where each side reads as a coordinate (no backtracking patterns: the
  // tokens are tried in turn, a handful at most).
  const tokens = s.split(' ');
  if (tokens.length < 2 || tokens.length > 8) return null;
  let found = null;
  for (let i = 1; i < tokens.length; i++) {
    const a = tokens.slice(0, i).join(' ');
    const b = tokens.slice(i).join(' ');
    if (readCoord(a) && readCoord(b)) {
      if (found) return null;
      found = [a, b];
    }
  }
  return found;
}

/** A written latitude and longitude, or null when the text is not one. */
export function parseLatLonText(raw) {
  if (String(raw ?? '').length > MAX_INPUT) return null;
  const pair = splitPair(plainCoordText(raw));
  if (!pair) return null;
  let a = readCoord(pair[0]);
  let b = readCoord(pair[1]);
  if (!a || !b) return null;
  // Longitude first, by its letters: latitude goes first.
  if (/[EW]/.test(a.hemi) && /[NS]/.test(b.hemi)) [a, b] = [b, a];
  // A latitude marked E or W, or a longitude marked N or S, is not a position.
  if (/[EW]/.test(a.hemi) || /[NS]/.test(b.hemi)) return null;
  // Out of range (a swapped pair, a typo) stays as written: the caller says
  // so rather than guess.
  return { latDeg: a.value, lonDeg: b.value };
}

function tryParseLatLon(raw) {
  return parseLatLonText(raw);
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
  if (raw.length > MAX_INPUT) return { kind: 'invalid', message: `That is too long for a location (${MAX_INPUT} characters at most).` };
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
