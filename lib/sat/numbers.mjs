// lib/sat/numbers.mjs - honest, labeled satellite numbers in km and km/s.
import { ecefToGeodetic } from '../coords.js';
import { OMEGA_EARTH } from '../pass-finder/sat-state.js';
import { satIlluminated } from '../pass-finder/visibility.js';
import { sunPositionEcef } from '../pass-finder/sun.js';

export const GM_KM3_S2 = 398600.4418;
export const EQUATORIAL_RADIUS_KM = 6378.137;
export const OLD_AFTER_DAYS = 7;
export const STALE_AFTER_DAYS = 14;
const SGP4_RADIUS_KM = 6378.135;

export function orbitElements(track) {
  const semiMajorAxisKm = track.satrec.a * SGP4_RADIUS_KM;
  const e = track.eccentricity;
  return {
    semiMajorAxisKm,
    eccentricity: e,
    inclinationDeg: track.inclinationDeg,
    periodMin: track.periodMs / 60_000,
    perigeeAltKm: semiMajorAxisKm * (1 - e) - EQUATORIAL_RADIUS_KM,
    apogeeAltKm: semiMajorAxisKm * (1 + e) - EQUATORIAL_RADIUS_KM,
  };
}

export function liveNumbers(track, date) {
  const s = track.stateAt(date);
  if (!s) return null;
  const r = s.rTeme.map((x) => x / 1000);
  const v = s.vTeme.map((x) => x / 1000);
  const speedKmS = Math.hypot(...v);
  const radiusKm = Math.hypot(...r);
  const { latDeg, lonDeg, elevM } = ecefToGeodetic(...s.rEcef);
  const altitudeKm = elevM / 1000;
  // Velocity relative to the rotating Earth: v - omega x r.
  const rel = [v[0] + OMEGA_EARTH * r[1], v[1] - OMEGA_EARTH * r[0], v[2]];
  const radial = (rel[0] * r[0] + rel[1] * r[1] + rel[2] * r[2]) / radiusKm;
  const perp = Math.sqrt(Math.max(0, rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2 - radial ** 2));
  const groundSpeedKmS = (perp * (radiusKm - altitudeKm)) / radiusKm;
  const a = orbitElements(track).semiMajorAxisKm;
  return {
    speedKmS,
    radiusKm,
    altitudeKm,
    latDeg,
    lonDeg,
    groundSpeedKmS,
    v2rOverGM: (speedKmS ** 2 * radiusKm) / GM_KM3_S2,
    visViva: 2 - radiusKm / a,
    visVivaSpeedKmS: Math.sqrt(GM_KM3_S2 * (2 / radiusKm - 1 / a)),
    sunlit: satIlluminated(s.rEcef, sunPositionEcef(date)),
  };
}

function hemisphere(deg, pos, neg) {
  if (!Number.isFinite(deg)) return 'n/a';
  return `${formatNumber(Math.abs(deg), 3)}° ${deg < 0 ? neg : pos}`;
}

// The dashboard tiles, in order. Pure and formatted; `elements` is taken so
// callers pass one shape for every tile set.
export function dashboardValues(live, elements) {
  return [
    { key: 'altitude', label: 'Altitude', value: formatNumber(live.altitudeKm, 1), unit: 'km', note: 'above the WGS84 ellipsoid' },
    { key: 'speed', label: 'Speed', value: formatNumber(live.speedKmS, 3), unit: 'km/s', note: 'inertial, from SGP4' },
    { key: 'groundSpeed', label: 'Ground speed', value: formatNumber(live.groundSpeedKmS, 3), unit: 'km/s', note: "over Earth's surface" },
    { key: 'radius', label: "From Earth's center", value: formatNumber(live.radiusKm, 1), unit: 'km', note: 'distance, from SGP4' },
    { key: 'lat', label: 'Latitude', value: hemisphere(live.latDeg, 'N', 'S'), unit: '', note: 'below the satellite' },
    { key: 'lon', label: 'Longitude', value: hemisphere(live.lonDeg, 'E', 'W'), unit: '', note: 'below the satellite' },
    { key: 'sun', label: 'Sunlight', value: live.sunlit ? 'Sunlit' : 'In shadow', unit: '', note: "Earth's shadow, no refraction" },
  ];
}

export function elementAge(epochMs, nowMs) {
  if (!Number.isFinite(epochMs)) return { ageDays: null, level: 'stale', text: 'Element age unknown' };
  const hours = Math.max(0, (nowMs - epochMs) / 3_600_000);
  const ageDays = Math.round((hours / 24) * 10) / 10;
  const days = hours / 24;
  const level = days > STALE_AFTER_DAYS ? 'stale' : days > OLD_AFTER_DAYS ? 'old' : 'fresh';
  let text;
  if (hours < 1) text = 'Elements are less than an hour old';
  else if (hours < 24) {
    const n = Math.floor(hours);
    text = `Elements are ${n} ${n === 1 ? 'hour' : 'hours'} old`;
  } else text = `Elements are ${ageDays.toFixed(1)} days old`;
  return { ageDays, level, text };
}

export function formatNumber(x, digits) {
  if (!Number.isFinite(x)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'negative',
  }).format(x);
}

// "92.87 min", or past 10 hours "719.70 min (12 h 0 min)". Total minutes are
// rounded first, so it never prints "11 h 60 min".
export function periodText(periodMin) {
  const base = `${formatNumber(periodMin, 2)} min`;
  if (!(periodMin > 600)) return base;
  const total = Math.round(periodMin);
  return `${base} (${Math.floor(total / 60)} h ${total % 60} min)`;
}

export function relativeTime(thenMs, nowMs) {
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

export const HOW_WE_COMPUTE = {
  speed: "The length of SGP4's velocity vector in the TEME frame: the inertial speed. It is not the speed over the ground.",
  groundSpeed: "How fast the point below the satellite moves across Earth's surface, with Earth's rotation taken out.",
  altitude: 'Height above the WGS84 ellipsoid, the standard model of Earth\'s shape, straight below the satellite.',
  radius: "Distance from Earth's center, from SGP4's position.",
  position: "The point on the WGS84 ellipsoid straight below the satellite, from SGP4's position turned into Earth-fixed coordinates.",
  sun: "Earth's shadow is taken as a cylinder of Earth's mean radius pointing away from the Sun, with no penumbra and no atmospheric refraction. Near the shadow's edge the change can come seconds early or late, minutes for high orbits.",
  visViva: 'v²r/GM uses the live speed and distance above, with GM = 398,600.4418 km³/s². Vis-viva says it equals 2 − r/a, where a is the mean semi-major axis. They agree as closely as SGP4\'s mean elements allow, usually within 1%.',
  elements: "Perigee, apogee, period, eccentricity, inclination and semi-major axis are mean elements from the published set, not instantaneous values. Perigee and apogee heights are above Earth's equatorial radius (6,378 km).",
  epoch: 'The epoch is the moment the element set describes. Positions get less accurate the further you are from it.',
};
