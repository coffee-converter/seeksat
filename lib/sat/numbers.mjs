// lib/sat/numbers.mjs - honest, labeled satellite numbers in km and km/s.
import { ecefToGeodetic } from '../coords.js';
import { OMEGA_EARTH } from '../pass-finder/sat-state.js';

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
  };
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
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

export const HOW_WE_COMPUTE = {
  speed: "Inertial speed: the length of SGP4's velocity vector in the TEME frame. It is not the speed over the ground.",
  groundSpeed: "Ground speed: how fast the point below the satellite moves across Earth's surface, with Earth's rotation taken out.",
  altitude: 'Height above the WGS84 ellipsoid, the standard model of Earth\'s shape, straight below the satellite.',
  radius: "Distance from Earth's center, from SGP4's position.",
  visViva: 'v²r/GM uses the live speed and distance above, with GM = 398,600.4418 km³/s². Vis-viva says it equals 2 − r/a, where a is the mean semi-major axis. They agree as closely as SGP4\'s mean elements allow, usually within 1%.',
  elements: "Perigee, apogee, period, eccentricity, inclination and semi-major axis are mean elements from the published set, not instantaneous values. Perigee and apogee heights are above Earth's equatorial radius (6,378 km).",
  epoch: 'The epoch is the moment the element set describes. Positions get less accurate the further you are from it.',
};
