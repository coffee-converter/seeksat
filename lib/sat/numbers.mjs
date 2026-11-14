// lib/sat/numbers.mjs - honest, labeled satellite numbers in km and km/s.
import { lengthIn, speedIn } from '../units.mjs';
import { ecefToGeodetic } from '../coords.js';
import { OMEGA_EARTH } from '../pass-finder/sat-state.js';
import { sunlitFraction } from '../pass-finder/visibility.js';
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
    ...sunlight(sunlitFraction(s.rEcef, sunPositionEcef(date))),
  };
}

// sunlit: any direct sunlight; litFraction: how much of the Sun's disc it
// sees (below 1 in Earth's penumbra).
function sunlight(f) {
  return { sunlit: f > 0, litFraction: f };
}

function sunlightText(f) {
  if (!Number.isFinite(f) || f <= 0) return 'In shadow';
  if (f >= 1) return 'Sunlit';
  return `Partly lit, ${Math.min(99, Math.max(1, Math.round(f * 100)))}%`;
}

function hemisphere(deg, pos, neg) {
  if (!Number.isFinite(deg)) return 'n/a';
  return `${formatNumber(Math.abs(deg), 3)}° ${deg < 0 ? neg : pos}`;
}

// The dashboard tiles, in order: in pairs (altitude and distance from the
// centre, speed and ground speed, latitude and longitude), so two columns
// put each pair side by side. Pure and formatted; `elements` is taken so
// callers pass one shape for every tile set.
export function dashboardValues(live, elements, units = 'metric') {
  // Distances and speeds in the viewer's units (lib/units.mjs).
  const alt = lengthIn(live.altitudeKm, units);
  const radius = lengthIn(live.radiusKm, units);
  const speed = speedIn(live.speedKmS, units);
  const ground = speedIn(live.groundSpeedKmS, units);
  return [
    { key: 'altitude', label: 'Altitude', value: formatNumber(alt.value, 1), unit: alt.unit, note: 'above the WGS84 ellipsoid' },
    { key: 'radius', label: "From Earth's center", value: formatNumber(radius.value, 1), unit: radius.unit, note: 'distance, from SGP4' },
    { key: 'speed', label: 'Speed', value: formatNumber(speed.value, 3), unit: speed.unit, note: 'inertial, from SGP4' },
    { key: 'groundSpeed', label: 'Ground speed', value: formatNumber(ground.value, 3), unit: ground.unit, note: "over Earth's surface" },
    { key: 'lat', label: 'Latitude', value: hemisphere(live.latDeg, 'N', 'S'), unit: '', note: 'below the satellite' },
    { key: 'lon', label: 'Longitude', value: hemisphere(live.lonDeg, 'E', 'W'), unit: '', note: 'below the satellite' },
    { key: 'sun', label: 'Sunlight', value: sunlightText(live.litFraction ?? (live.sunlit ? 1 : 0)), unit: '', note: "Earth's shadow and atmosphere" },
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
  sun: "How much sunlight reaches the satellite past Earth and its atmosphere. Light grazing Earth is dimmed by air and ozone, bent into the shadow by refraction, and blocked below 10 km (clouds and haze); the Sun's disc is darker at its edge. So the satellite fades over a few seconds in low orbit and a couple of minutes in geostationary orbit, reddening as it goes, rather than switching off. The atmosphere is a clear standard one: haze from a large volcanic eruption can make the real fade come a few seconds early.",
  visViva: 'v²r/GM uses the live speed and distance above, with GM = 398,600.4418 km³/s². Vis-viva says it equals 2 − r/a, where a is the mean semi-major axis. They agree as closely as SGP4\'s mean elements allow, usually within 1%.',
  elements: "Perigee, apogee, period, eccentricity, inclination and semi-major axis are mean elements from the published set, not instantaneous values. Perigee and apogee heights are above Earth's equatorial radius (6,378 km).",
  accuracy: 'Positions are predictions from the published elements, not live tracking. Through SGP4 they are usually within a kilometre or two near the epoch and drift by a few km a day after it, more for low or manoeuvring satellites. The map shows ground positions, the point straight below the satellite, so dots that look close can be thousands of km apart in height. Good for passes and tracks; not for judging close approaches between objects.',
  epoch: 'The epoch is the moment the element set describes. Positions get less accurate the further you are from it.',
};
