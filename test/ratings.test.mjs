import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpRatingStop, ratingCssColor, ratingCssColorWithSkill,
  twilightFactor, altitudeFactor, coordinationFactor,
  forecastSkill, effectivePClear, peakElevFactor,
  radioDurationFactor, magnitudeAt,
} from '../lib/pass-finder/ratings.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;

// ---- Rating-stop interpolation -------------------------------------------

test('interpRatingStop: score 0 is red', () => {
  const c = interpRatingStop(0);
  assert.deepEqual(c, { r: 248, g: 113, b: 113 });
});

test('interpRatingStop: score 1/3 is yellow', () => {
  const c = interpRatingStop(1 / 3);
  assert.equal(c.r, 250);
  assert.equal(c.g, 204);
  assert.equal(c.b, 21);
});

test('interpRatingStop: score 2/3 is green', () => {
  const c = interpRatingStop(2 / 3);
  assert.deepEqual(c, { r: 52, g: 211, b: 153 });
});

test('interpRatingStop: score 1 saturates at green', () => {
  const c = interpRatingStop(1);
  assert.deepEqual(c, { r: 52, g: 211, b: 153 });
});

test('interpRatingStop: clamps negative scores to red', () => {
  assert.deepEqual(interpRatingStop(-5), interpRatingStop(0));
});

test('interpRatingStop: clamps >1 scores to green', () => {
  assert.deepEqual(interpRatingStop(2), interpRatingStop(1));
});

test('interpRatingStop: midpoint between red and yellow is orange-ish', () => {
  const c = interpRatingStop(1 / 6); // halfway from 0 to 1/3
  // Halfway between (248,113,113) and (250,204,21):
  //   r = round(249.0) = 249
  //   g = round(158.5) = 159  (Math.round rounds .5 up)
  //   b = round(67.0)  = 67
  assert.deepEqual(c, { r: 249, g: 159, b: 67 });
});

test('ratingCssColor: returns rgb() string', () => {
  assert.equal(ratingCssColor(0), 'rgb(248, 113, 113)');
  assert.equal(ratingCssColor(1), 'rgb(52, 211, 153)');
});

// ---- Skill-blended color -------------------------------------------------

test('ratingCssColorWithSkill: ageDays=0 returns full-saturation color', () => {
  assert.equal(ratingCssColorWithSkill(1, 0), 'rgb(52, 211, 153)');
});

test('ratingCssColorWithSkill: large ageDays floors at 1/3 toward gray', () => {
  // Skill is floored at 1/3 even at age=Infinity, so the color stays
  // 1/3 saturated. With score=1 (green = 52,211,153) and gray = (106,122,154):
  //   c.r = 52*1/3 + 106*2/3 = round(88) = 88
  //   c.g = 211*1/3 + 122*2/3 = round(151.666...) = 152
  //   c.b = 153*1/3 + 154*2/3 = round(153.666...) = 154
  assert.equal(ratingCssColorWithSkill(1, 1000), 'rgb(88, 152, 154)');
});

test('ratingCssColorWithSkill: ageDays=4 ≈ skill 0.37 mostly desaturated', () => {
  // With score=1 and skill ≈ e^-1 ≈ 0.368:
  //   c.r ≈ 52*0.368 + 106*0.632 ≈ 86
  //   c.g ≈ 211*0.368 + 122*0.632 ≈ 155
  //   c.b ≈ 153*0.368 + 154*0.632 ≈ 154
  const out = ratingCssColorWithSkill(1, 4);
  const m = out.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  assert.ok(m, `unexpected: ${out}`);
  assert.ok(close(+m[1], 86, 2), `r=${m[1]}`);
  assert.ok(close(+m[2], 155, 2), `g=${m[2]}`);
  assert.ok(close(+m[3], 154, 2), `b=${m[3]}`);
});

// ---- Twilight factor -----------------------------------------------------

test('twilightFactor: sun above horizon is 0 (daylight)', () => {
  assert.equal(twilightFactor(5), 0);
  assert.equal(twilightFactor(0), 0);
  assert.equal(twilightFactor(45), 0);
});

test('twilightFactor: sun at -6° (civil twilight) is 0.5', () => {
  assert.equal(twilightFactor(-6), 0.5);
});

test('twilightFactor: sun at -12° (nautical twilight) saturates at 1', () => {
  assert.equal(twilightFactor(-12), 1);
});

test('twilightFactor: sun far below horizon clamps at 1', () => {
  assert.equal(twilightFactor(-18), 1);
  assert.equal(twilightFactor(-90), 1);
});

// ---- Altitude factor -----------------------------------------------------

test('altitudeFactor: below 5° is 0 (horizon haze)', () => {
  assert.equal(altitudeFactor(0), 0);
  assert.equal(altitudeFactor(4.9), 0);
  assert.equal(altitudeFactor(-5), 0);
});

test('altitudeFactor: at 25° saturates at 1', () => {
  assert.equal(altitudeFactor(25), 1);
  assert.equal(altitudeFactor(45), 1);
  assert.equal(altitudeFactor(90), 1);
});

test('altitudeFactor: mid-range checkpoints', () => {
  assert.ok(close(altitudeFactor(15), 0.5, 1e-9));
  assert.ok(close(altitudeFactor(20), 0.75, 1e-9));
  assert.ok(close(altitudeFactor(10), 0.25, 1e-9));
});

// ---- Coordination factor -------------------------------------------------

test('coordinationFactor: 0s pass returns 0', () => {
  assert.equal(coordinationFactor(0), 0);
});

test('coordinationFactor: 60s pass returns 0.5', () => {
  assert.equal(coordinationFactor(60), 0.5);
});

test('coordinationFactor: monotonically increases with duration', () => {
  assert.ok(coordinationFactor(30) < coordinationFactor(60));
  assert.ok(coordinationFactor(60) < coordinationFactor(120));
  assert.ok(coordinationFactor(120) < coordinationFactor(240));
});

test('coordinationFactor: asymptotes below 1 for finite durations', () => {
  assert.ok(coordinationFactor(99999) < 1);
  assert.ok(coordinationFactor(99999) > 0.999);
});

// ---- Forecast skill ------------------------------------------------------

test('forecastSkill: age 0 returns 1 (full trust)', () => {
  assert.equal(forecastSkill(0), 1);
});

test('forecastSkill: negative ageDays returns 1 (no past-prediction penalty)', () => {
  assert.equal(forecastSkill(-1), 1);
  assert.equal(forecastSkill(-100), 1);
});

test('forecastSkill: 4-day decay ≈ 0.37 (1/e)', () => {
  assert.ok(close(forecastSkill(4), Math.exp(-1), 1e-9));
});

test('forecastSkill: 10-day decay ≈ 0.082', () => {
  assert.ok(close(forecastSkill(10), Math.exp(-2.5), 1e-9));
});

// ---- Effective P(clear) --------------------------------------------------

test('effectivePClear: null forecast returns neutral 0.5', () => {
  assert.equal(effectivePClear(null, 0), 0.5);
  assert.equal(effectivePClear(null, 4), 0.5);
});

test('effectivePClear: 0% clouds today returns 1 (full clear, full skill)', () => {
  assert.ok(close(effectivePClear(0, 0), 1, 1e-9));
});

test('effectivePClear: 100% clouds today returns 0 (fully socked in)', () => {
  assert.ok(close(effectivePClear(100, 0), 0, 1e-9));
});

test('effectivePClear: 50% clouds today returns 0.5 (matches neutral)', () => {
  assert.ok(close(effectivePClear(50, 0), 0.5, 1e-9));
});

test('effectivePClear: 0% clouds at 4-day forecast blends toward 0.5', () => {
  // direct=1, skill=e^-1 ≈ 0.368, so 0.368*1 + 0.632*0.5 = 0.684
  const v = effectivePClear(0, 4);
  assert.ok(close(v, 0.368 + 0.316, 0.01), `v=${v}`);
});

test('effectivePClear: 100% clouds far-future blends toward 0.5', () => {
  // direct=0, skill→0, so result→0.5
  assert.ok(close(effectivePClear(100, 100), 0.5, 0.01));
});

// ---- Peak elevation factor (radio) ---------------------------------------

test('peakElevFactor: below 5° is 0', () => {
  assert.equal(peakElevFactor(0), 0);
  assert.equal(peakElevFactor(4), 0);
});

test('peakElevFactor: at 55° saturates at 1', () => {
  assert.equal(peakElevFactor(55), 1);
  assert.equal(peakElevFactor(90), 1);
});

test('peakElevFactor: 30° → 0.5', () => {
  assert.ok(close(peakElevFactor(30), 0.5, 1e-9));
});

// ---- Radio duration factor -----------------------------------------------

test('radioDurationFactor: 0s returns 0', () => {
  assert.equal(radioDurationFactor(0), 0);
});

test('radioDurationFactor: 60s ≈ 0.49 (just below half)', () => {
  assert.ok(close(radioDurationFactor(60), 1 - Math.exp(-60/90), 1e-9));
});

test('radioDurationFactor: 300s ≈ 0.96', () => {
  const v = radioDurationFactor(300);
  assert.ok(close(v, 0.96, 0.01), `v=${v}`);
});

test('radioDurationFactor: asymptotes at 1', () => {
  assert.ok(radioDurationFactor(10000) > 0.9999);
});

// ---- Visual magnitude ----------------------------------------------------

test('magnitudeAt: returns null when ISS is between observer and sun (back-lit)', () => {
  // Observer at (lat=0, lon=0, alt=0) = ECEF roughly (6378137, 0, 0).
  // Place ISS at (6378137 + 400_000, 0, 0) - directly above observer.
  // Sun direction = -x (sun at the antisun side, away from ISS-observer).
  // dx = obsEcef.x - issEcef.x = -400_000 (toward earth from ISS)
  // sunDir = (-1, 0, 0)
  // cosAlpha = dx*sunDir.x / range = -400_000*(-1) / 400_000 = 1
  // F = 1 → bright. NOT this case. Let me invert.
  // Actually for "back-lit" we want sunDir pointing TOWARD the observer
  // (i.e. observer-to-ISS vector aligned with sun-to-ISS vector → ISS lit
  // on the side AWAY from observer).
  // observer→ISS = (400_000, 0, 0), so vector from ISS to observer is
  // (-400_000, 0, 0), which is dx,dy,dz.
  // If the sun is at sunDir = (-1, 0, 0) - pointing toward earth from
  // ISS - then ISS is lit on the +x side; we look from -x. Lit side away.
  // cosAlpha = dx*sunDir.x = (-400_000)*(-1)/400_000 = 1 → F=1 (BRIGHT).
  // For F=0 we need cosAlpha = -1 → dx and sunDir opposite signs.
  // sunDir = (+1,0,0): cosAlpha = -400_000 * 1 / 400_000 = -1 → F=0.
  const obs = { latDeg: 0, lonDeg: 0 };
  const issEcef = [6378137 + 400_000, 0, 0];
  const sunDir = [1, 0, 0];
  const m = magnitudeAt(obs, issEcef, sunDir);
  assert.equal(m, null);
});

test('magnitudeAt: bright fully-lit overhead pass is mag ~-1 to -2', () => {
  // Observer at equator, ISS directly overhead at 400 km, sun behind
  // observer (so ISS is fully lit toward observer).
  const obs = { latDeg: 0, lonDeg: 0 };
  const issEcef = [6378137 + 400_000, 0, 0];
  // observer→ISS = (+400_000, 0, 0). For full illumination we want
  // sun direction such that ISS-to-sun aligns with ISS-to-observer:
  // sunDir from ISS = -ISS-to-observer = -(observer-iss) direction =
  // (+1, 0, 0)? Let me re-derive.
  // dx = obs - iss = -400_000, sunDir = ? for cosAlpha=+1 we need
  // dx*sunDir.x = +400_000 → sunDir.x = -1.
  const sunDir = [-1, 0, 0];
  const m = magnitudeAt(obs, issEcef, sunDir);
  assert.ok(m !== null);
  // ISS overhead at 400 km: range = 400 km = 400_000 m.
  // m_std=-1.8, log10(400_000/1_000_000) = log10(0.4) ≈ -0.398.
  // m = -1.8 + 5*(-0.398) - 2.5*log10(1) = -1.8 - 1.99 = -3.79
  assert.ok(close(m, -3.79, 0.01), `m=${m}`);
});

test('magnitudeAt: returns null when observer at ISS position (range 0)', () => {
  const obs = { latDeg: 0, lonDeg: 0 };
  const obsEcef = [6378137, 0, 0];
  const m = magnitudeAt(obs, obsEcef, [1, 0, 0]);
  assert.equal(m, null);
});

test('magnitudeAt: range matters - further → dimmer (higher m)', () => {
  const obs = { latDeg: 0, lonDeg: 0 };
  const sunDir = [-1, 0, 0]; // fully lit
  const closer = magnitudeAt(obs, [6378137 + 400_000, 0, 0], sunDir);
  const farther = magnitudeAt(obs, [6378137 + 800_000, 0, 0], sunDir);
  assert.ok(closer !== null && farther !== null);
  assert.ok(farther > closer, `farther=${farther} should be > closer=${closer}`);
});
