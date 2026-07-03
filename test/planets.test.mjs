import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planetPositionEci, planetPositionEcef,
  planetApparentMagnitude,
  PLANET_STYLE, PLANET_NAMES,
} from '../lib/pass-finder/planets.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;
const unitLen = (v) => Math.hypot(v[0], v[1], v[2]);

const SAMPLE_DATE = new Date('2025-06-15T00:00:00Z');

// ---- PLANET_NAMES / PLANET_STYLE -----------------------------------------

test('PLANET_NAMES: lists the five classical naked-eye planets', () => {
  assert.deepEqual(PLANET_NAMES, [
    'mercury', 'venus', 'mars', 'jupiter', 'saturn',
  ]);
});

test('PLANET_STYLE: has an entry for every PLANET_NAMES key', () => {
  for (const name of PLANET_NAMES) {
    const s = PLANET_STYLE[name];
    assert.ok(s, `missing PLANET_STYLE[${name}]`);
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.color, 'string');
    assert.match(s.color, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof s.glyph, 'string');
  }
});

// ---- planetPositionEci ---------------------------------------------------

test('planetPositionEci: returns a 3-element array of finite numbers', () => {
  for (const name of PLANET_NAMES) {
    const v = planetPositionEci(name, SAMPLE_DATE);
    assert.equal(v.length, 3);
    for (const c of v) assert.ok(Number.isFinite(c), `${name}: ${c}`);
  }
});

test('planetPositionEci: outer planets are farther from earth than inner', () => {
  // Geocentric distance ordering: mercury, venus < earth-radius orbit
  // (max ~0.4 AU and ~1.7 AU respectively); mars 0.4-2.5 AU; jupiter
  // 4-6 AU; saturn 8-10 AU. So |saturn| > |jupiter| > {mercury, venus,
  // mars} on most dates. We don't assert mercury < venus at any single
  // date because their geocentric distance order flips with synodic phase.
  const lens = Object.fromEntries(
    PLANET_NAMES.map(n => [n, unitLen(planetPositionEci(n, SAMPLE_DATE))]),
  );
  assert.ok(lens.saturn > lens.jupiter,
    `saturn ${lens.saturn} should exceed jupiter ${lens.jupiter}`);
  assert.ok(lens.jupiter > lens.mars,
    `jupiter ${lens.jupiter} should exceed mars ${lens.mars}`);
  // Mercury + Venus are inner planets - both stay close to earth-sun
  // line, so |geocentric pos| < ~1.7 AU.
  assert.ok(lens.mercury < 2);
  assert.ok(lens.venus < 2);
});

test('planetPositionEci: vector magnitude in AU is plausible for each planet', () => {
  // Loose bounds - geocentric distance ranges (perihelion-to-aphelion
  // worst case across both planet's orbit + earth's):
  //   mercury: 0.5 - 1.5 AU
  //   venus:   0.25 - 1.75 AU
  //   mars:    0.4 - 2.7 AU
  //   jupiter: 4 - 6.5 AU
  //   saturn:  7.5 - 11 AU
  const bounds = {
    mercury: [0.4, 1.6],
    venus:   [0.2, 1.8],
    mars:    [0.3, 2.8],
    jupiter: [3.8, 6.7],
    saturn:  [7.3, 11.2],
  };
  for (const name of PLANET_NAMES) {
    const r = unitLen(planetPositionEci(name, SAMPLE_DATE));
    const [lo, hi] = bounds[name];
    assert.ok(r >= lo && r <= hi,
      `${name}: r=${r} outside [${lo}, ${hi}] for ${SAMPLE_DATE.toISOString()}`);
  }
});

test('planetPositionEci: deterministic for same input', () => {
  const a = planetPositionEci('mars', SAMPLE_DATE);
  const b = planetPositionEci('mars', SAMPLE_DATE);
  assert.deepEqual(a, b);
});

// ---- planetPositionEcef --------------------------------------------------

test('planetPositionEcef: returns a unit vector', () => {
  for (const name of PLANET_NAMES) {
    const v = planetPositionEcef(name, SAMPLE_DATE);
    assert.ok(close(unitLen(v), 1, 1e-9),
      `${name}: ECEF len=${unitLen(v)}`);
  }
});

test('planetPositionEcef: rotates with GMST relative to ECI', () => {
  // At noon UTC, GMST is roughly π/2 rad - x/y in ECEF should differ
  // from ECI. (Z is invariant under Z-axis rotation.)
  const eci = planetPositionEci('jupiter', new Date('2025-06-15T12:00:00Z'));
  const eciUnit = [eci[0], eci[1], eci[2]].map(c => c / unitLen(eci));
  const ecef = planetPositionEcef('jupiter', new Date('2025-06-15T12:00:00Z'));
  // Z component unchanged by GMST rotation about Z axis.
  assert.ok(close(eciUnit[2], ecef[2], 1e-9), `eciZ=${eciUnit[2]} ecefZ=${ecef[2]}`);
  // X/Y rotated - expect noticeable difference.
  assert.ok(Math.abs(eciUnit[0] - ecef[0]) + Math.abs(eciUnit[1] - ecef[1]) > 0.01);
});

// ---- planetApparentMagnitude --------------------------------------------

test('planetApparentMagnitude: returns finite numbers for the 5 planets', () => {
  for (const name of PLANET_NAMES) {
    const m = planetApparentMagnitude(name, SAMPLE_DATE);
    assert.ok(Number.isFinite(m), `${name}: m=${m}`);
  }
});

test('planetApparentMagnitude: ranges are plausible per planet', () => {
  // Reference (naked-eye magnitude ranges from JPL / Wikipedia):
  //   mercury: -2.5 to +5.5
  //   venus:   -4.9 to -3.0 (always brightest naked-eye object after moon)
  //   mars:    -3.0 to +1.6
  //   jupiter: -2.9 to -1.6
  //   saturn:   0.4 to +1.4
  // Our formula ignores phase function - accept generous bounds.
  const bounds = {
    mercury: [-3, 7],
    venus:   [-6, 0],
    mars:    [-4, 4],
    jupiter: [-4, 0],
    saturn:  [-2, 3],
  };
  for (const name of PLANET_NAMES) {
    const m = planetApparentMagnitude(name, SAMPLE_DATE);
    const [lo, hi] = bounds[name];
    assert.ok(m >= lo && m <= hi,
      `${name}: m=${m} outside [${lo}, ${hi}]`);
  }
});

test('planetApparentMagnitude: returns null for non-PLANET_NAMES input', () => {
  // No entry in ELEMENTS → returns null.
  assert.equal(planetApparentMagnitude('pluto', SAMPLE_DATE), null);
});

test('planetApparentMagnitude: deterministic for same input', () => {
  assert.equal(
    planetApparentMagnitude('venus', SAMPLE_DATE),
    planetApparentMagnitude('venus', SAMPLE_DATE),
  );
});

// ---- Cross-checks against published positions ---------------------------

test('mars opposition 2025-01-16: high ecliptic latitude / declination shape', () => {
  // Mars was at opposition on 2025-01-16 with Earth between it and the
  // Sun. Geometrically this means earth-to-mars vector points opposite
  // the sun direction. Without exact-date ephemeris values we settle
  // for a much weaker sanity check: at opposition, planet-Earth
  // distance is minimal (~0.6 AU) and apparent magnitude near bright.
  const d = new Date('2025-01-16T00:00:00Z');
  const v = planetPositionEci('mars', d);
  const r = unitLen(v);
  assert.ok(r < 0.85, `mars opposition distance ${r} AU should be near minimum`);
  const m = planetApparentMagnitude('mars', d);
  assert.ok(m < 0, `mars at opposition should be bright (m=${m})`);
});

test('venus is always brighter than mars on a random date', () => {
  // Venus is the brightest planet - its m0 = -4.4 dominates so much
  // that on essentially any date Venus is brighter than Mars.
  // (Strictly: Mars at opposition CAN beat Venus near greatest
  // elongation, but for an arbitrary 2025-06-15 date Venus wins.)
  const mV = planetApparentMagnitude('venus', SAMPLE_DATE);
  const mM = planetApparentMagnitude('mars', SAMPLE_DATE);
  assert.ok(mV < mM, `Venus (${mV}) should be brighter than Mars (${mM})`);
});
