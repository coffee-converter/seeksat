import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  altAzToSvg, skyShadeRgb, skyShadeForSunAlt, chartPalette,
  naturalSkyLimMag, starAltAzForObs,
} from '../lib/pass-finder/sky-helpers.js';

const close = (a, b, eps) => Math.abs(a - b) < eps;

// ---- altAzToSvg: alt/az → SVG polar projection ---------------------------

test('altAzToSvg: zenith (alt=90) projects to center', () => {
  const [x, y] = altAzToSvg(90, 0); // defaults cx=50, cy=50, R=45
  assert.equal(x, 50);
  assert.equal(y, 50);
});

test('altAzToSvg: horizon at North (alt=0, az=0) hits top edge', () => {
  const [x, y] = altAzToSvg(0, 0);
  assert.equal(x, 50);
  assert.equal(y, 5); // cy - R = 50 - 45 = 5
});

test('altAzToSvg: horizon at South (alt=0, az=180) hits bottom edge', () => {
  const [x, y] = altAzToSvg(0, 180);
  assert.ok(close(x, 50, 1e-9));
  assert.ok(close(y, 95, 1e-9));
});

test('altAzToSvg: East (az=90) projects to LEFT (sky-chart convention)', () => {
  const [x, y] = altAzToSvg(0, 90);
  assert.ok(close(x, 5, 1e-9), `x=${x}`);
  assert.ok(close(y, 50, 1e-9));
});

test('altAzToSvg: West (az=270) projects to RIGHT', () => {
  const [x, y] = altAzToSvg(0, 270);
  assert.ok(close(x, 95, 1e-9));
  assert.ok(close(y, 50, 1e-9));
});

test('altAzToSvg: altitude 45° at any az sits halfway between center and edge', () => {
  // r = ((90 - 45) / 90) * R = 0.5 * 45 = 22.5 from center
  const [x] = altAzToSvg(45, 90); // east
  assert.ok(close(x, 50 - 22.5, 1e-9));
});

test('altAzToSvg: respects custom cx/cy/R (modal config)', () => {
  const [x, y] = altAzToSvg(90, 0, 100, 100, 90); // modal-sized
  assert.equal(x, 100);
  assert.equal(y, 100);
});

// ---- skyShadeRgb: twilight color ramp -----------------------------------

test('skyShadeRgb: midday returns top stop (daylight blue)', () => {
  assert.deepEqual(skyShadeRgb(45), [95, 168, 214]);
});

test('skyShadeRgb: horizon (alt=0) hits sunset color', () => {
  assert.deepEqual(skyShadeRgb(0), [60, 100, 150]);
});

test('skyShadeRgb: civil twilight (alt=-6) is bridge color', () => {
  assert.deepEqual(skyShadeRgb(-6), [35, 55, 100]);
});

test('skyShadeRgb: astronomical twilight (-18) is near-black', () => {
  assert.deepEqual(skyShadeRgb(-18), [8, 12, 24]);
});

test('skyShadeRgb: deep night clamps to bottom stop', () => {
  assert.deepEqual(skyShadeRgb(-90), [4, 8, 20]);
  assert.deepEqual(skyShadeRgb(-100), [4, 8, 20]); // clamps below floor
});

test('skyShadeRgb: linear interpolation between stops', () => {
  // Halfway between 0 (60,100,150) and -6 (35,55,100): alt=-3
  const c = skyShadeRgb(-3);
  assert.equal(c[0], Math.round((60 + 35) / 2));
  assert.equal(c[1], Math.round((100 + 55) / 2));
  assert.equal(c[2], Math.round((150 + 100) / 2));
});

test('skyShadeForSunAlt: returns CSS rgb() string', () => {
  const css = skyShadeForSunAlt(0);
  assert.equal(css, 'rgb(60, 100, 150)');
});

// ---- chartPalette: luminance-aware line colors --------------------------

test('chartPalette: dark sky → light grays for grid', () => {
  const p = chartPalette(-90);
  // bgLuma very low → dark === false branch (luma < 128) → delta -45?
  // Actually code: dark = bgLuma >= 128. At sunAlt=-90, bg=(4,8,20) →
  // luma ≈ 0.21*4 + 0.71*8 + 0.07*20 ≈ 7.9 → dark=false → gridDelta=+30,
  // arcDelta=+130. So grid gray ~ 38, arc gray ~ 138.
  const m = p.grid.match(/rgb\((\d+), (\d+), (\d+)\)/);
  assert.ok(m, p.grid);
  const gridGray = +m[1];
  assert.ok(gridGray < 60, `grid gray ${gridGray} should be low on dark sky`);
  const am = p.arc.match(/rgb\((\d+), (\d+), (\d+)\)/);
  const arcGray = +am[1];
  assert.ok(arcGray > gridGray, `arc ${arcGray} should outrank grid ${gridGray}`);
});

test('chartPalette: bright sky → dark grays for grid (still contrast against bg)', () => {
  const p = chartPalette(45); // midday
  // bg=(95,168,214) → luma ≈ 0.21*95 + 0.71*168 + 0.07*214 ≈ 154 → dark=true
  // gridDelta = -45 → gridGray ~ 109. arcDelta = -150 → arcGray ~ 4 (clamped 0).
  const m = p.grid.match(/rgb\((\d+),/);
  assert.ok(m);
  const gridGray = +m[1];
  assert.ok(gridGray > 80, `grid gray ${gridGray} should sit mid-low on bright bg`);
});

test('chartPalette: grid/spoke/minorSpoke all share the same gray', () => {
  const p = chartPalette(-30);
  assert.equal(p.grid, p.spoke);
  assert.equal(p.spoke, p.minorSpoke);
});

// ---- naturalSkyLimMag: limiting magnitude vs sun altitude ---------------

test('naturalSkyLimMag: daylight is extremely shallow (~mag -4)', () => {
  assert.equal(naturalSkyLimMag(45), -4.0);
  assert.equal(naturalSkyLimMag(10), -4.0);
});

test('naturalSkyLimMag: horizon ≈ mag -2.5 (Venus visible, not much else)', () => {
  assert.equal(naturalSkyLimMag(0), -2.5);
});

test('naturalSkyLimMag: civil twilight (-6) ≈ mag 1.5', () => {
  assert.equal(naturalSkyLimMag(-6), 1.5);
});

test('naturalSkyLimMag: nautical (-12) ≈ mag 3.5', () => {
  assert.equal(naturalSkyLimMag(-12), 3.5);
});

test('naturalSkyLimMag: astronomical (-18) ≈ mag 5', () => {
  assert.equal(naturalSkyLimMag(-18), 5.0);
});

test('naturalSkyLimMag: deep night caps near naked-eye limit (~6)', () => {
  assert.equal(naturalSkyLimMag(-90), 6.0);
});

test('naturalSkyLimMag: monotonically increases as sun drops', () => {
  const samples = [10, 0, -3, -6, -9, -12, -15, -18, -40, -90];
  for (let i = 0; i < samples.length - 1; i++) {
    const earlier = naturalSkyLimMag(samples[i]);
    const later = naturalSkyLimMag(samples[i + 1]);
    assert.ok(later >= earlier,
      `${samples[i]}°→${earlier}, ${samples[i+1]}°→${later} should not decrease`);
  }
});

// ---- starAltAzForObs: ECEF unit vector → observer alt/az ----------------

test('starAltAzForObs: zenith from equator/0 - vector along +x → alt 90', () => {
  // Observer at (lat=0, lon=0). Local up at that point is +x in ECEF.
  // A star direction of (1,0,0) is straight overhead.
  const { alt, az } = starAltAzForObs(
    { latDeg: 0, lonDeg: 0 },
    [1, 0, 0],
  );
  assert.ok(close(alt, 90, 1e-9), `alt=${alt}`);
});

test('starAltAzForObs: horizon north - vector (0,0,1) is +z (rotation axis)', () => {
  // For lat=0, lon=0, north (the local +y? actually local north points to
  // +z in this convention because Earth's axis is +z). Actually let me trace:
  //   e (east)  = -sin(lon)*dx + cos(lon)*dy  → for lon=0: dy
  //   n (north) = -sin(lat)*cos(lon)*dx - sin(lat)*sin(lon)*dy + cos(lat)*dz
  //   For lat=0, lon=0: n = dz
  //   u (up) = cos(lat)*cos(lon)*dx + ... + sin(lat)*dz → for lat=0,lon=0: dx
  // Star vector (0,0,1): e=0, n=1, u=0 → alt=atan2(0, hypot(0,1))=0, az=atan2(0,1)=0.
  const { alt, az } = starAltAzForObs(
    { latDeg: 0, lonDeg: 0 },
    [0, 0, 1],
  );
  assert.ok(close(alt, 0, 1e-9));
  assert.ok(close(az, 0, 1e-9));
});

test('starAltAzForObs: horizon east - vector (0,1,0) is +y', () => {
  // lat=0, lon=0: e=dy=1, n=dz=0, u=dx=0. alt=0, az=atan2(1,0)=90.
  const { alt, az } = starAltAzForObs(
    { latDeg: 0, lonDeg: 0 },
    [0, 1, 0],
  );
  assert.ok(close(alt, 0, 1e-9));
  assert.ok(close(az, 90, 1e-9));
});

test('starAltAzForObs: below horizon (-x at equator) returns negative alt', () => {
  const { alt } = starAltAzForObs(
    { latDeg: 0, lonDeg: 0 },
    [-1, 0, 0],
  );
  assert.ok(close(alt, -90, 1e-9));
});

test('starAltAzForObs: az wraps to [0, 360)', () => {
  // Vector pointing west (negative y at lat=0, lon=0): e=-1, n=0, u=0 →
  // raw atan2(-1, 0) = -90 → wrap to 270.
  const { az } = starAltAzForObs(
    { latDeg: 0, lonDeg: 0 },
    [0, -1, 0],
  );
  assert.ok(close(az, 270, 1e-9), `az=${az}`);
});
