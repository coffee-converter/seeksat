import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starField, projectStars, bvToKelvin, bvToRgb, starStyle } from '../lib/map/stars.mjs';
import { STARS, STAR_COUNT } from '../lib/map/star-data.mjs';
import { gmstFromDate } from '../lib/coords.js';

const field = starField(STARS);
const cam = { width: 1000, height: 800, fovDeg: 36.87 };

test('the catalogue: complete to magnitude 6, brightest first, Sirius leading', () => {
  assert.equal(field.n, STAR_COUNT);
  assert.ok(STAR_COUNT > 5000 && STAR_COUNT < 5200);
  assert.equal(Math.round(field.mag[0] * 100) / 100, -1.46);
  for (let i = 1; i < field.n; i++) assert.ok(field.mag[i] >= field.mag[i - 1]);
});

test('colour follows temperature: blue-white hot stars, orange cool ones', () => {
  assert.ok(Math.abs(bvToKelvin(0.65) - 5800) < 200, `${bvToKelvin(0.65)}`); // the Sun
  const [rb, , bb] = bvToRgb(-0.2); // a B star
  const [rm, , bm] = bvToRgb(1.85); // Betelgeuse
  assert.ok(bb > rb && rm > bm);
});

test('brighter stars are bigger and more opaque', () => {
  assert.ok(starStyle(-1.46).r > starStyle(5).r);
  assert.ok(starStyle(0).alpha > starStyle(5).alpha);
});

// A star straight behind the Earth lands in the centre of the frame.
test('projection: behind the Earth is the frame centre, east is right, north is up', () => {
  const t = new Date('2026-11-04T00:00:00Z');
  const gmst = gmstFromDate(t);
  // Camera over lon 0, lat 0 looks along -x (Earth-fixed): the star whose
  // Earth-fixed direction is -x sits at RA = gmst + 180 deg, Dec 0.
  const raH = (((gmst / Math.PI) * 12 + 12) % 24 + 24) % 24;
  const one = (raH, decDeg) => starField([Math.round(raH * 1000), Math.round(decDeg * 100), 100, 65]);
  const at = (f) => projectStars(f, { ...cam, lonDeg: 0, latDeg: 0, gmstRad: gmst })[0];
  const c = at(one(raH, 0));
  assert.ok(Math.abs(c.x - 500) < 2 && Math.abs(c.y - 400) < 2, JSON.stringify(c));
  // North (declination up) is up the frame.
  const n = at(one(raH, 5));
  assert.ok(n.y < 400 && Math.abs(n.x - 500) < 2, JSON.stringify(n));
  // A star in front of the camera (toward the viewer) is not drawn.
  const front = projectStars(one((raH + 12) % 24, 0), { ...cam, lonDeg: 0, latDeg: 0, gmstRad: gmst });
  assert.equal(front.length, 0);
});

test('projection: the sky turns with sidereal time', () => {
  const t0 = new Date('2026-11-04T00:00:00Z');
  const t1 = new Date(t0.getTime() + 600_000);
  const p0 = projectStars(field, { ...cam, lonDeg: -90, latDeg: 30, gmstRad: gmstFromDate(t0) });
  const p1 = projectStars(field, { ...cam, lonDeg: -90, latDeg: 30, gmstRad: gmstFromDate(t1) });
  const common = p0.filter((a) => p1.some((b) => b.i === a.i));
  assert.ok(common.length > 20);
  const moved = common.map((a) => { const b = p1.find((q) => q.i === a.i); return b.x - a.x; });
  const mean = moved.reduce((s, v) => s + v, 0) / moved.length;
  assert.ok(Math.abs(mean) > 10, `${mean} px in 10 minutes`);
});

import { skyBodies, cameraDistanceKm, PLANET_MAG_LIMIT } from '../lib/map/stars.mjs';

// Camera over lon 0, lat 0 looking along -x: directions near -x are in view.
const view = { lonDeg: 0, latDeg: 0, fovDeg: 36.87, width: 1000, height: 800 };
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

test('camera distance from MapLibre pixels: centre distance plus the globe radius', () => {
  const worldSize = 2 * Math.PI * 300; // globe radius 300 px at the equator
  assert.ok(Math.abs(cameraDistanceKm(900, worldSize, 0) - 4 * 6371) < 1e-6);
});

test('the Moon: phase from the Sun-Moon-camera angle, lit limb toward the Sun', () => {
  const moonEcef = unit([-1, 0.25, 0]);
  const base = { moonEcef, moonKm: 384_400, camDistKm: 4 * 6371, planets: [] };
  // Sun behind the camera (full), beside the Moon (half), beyond it (new).
  const full = skyBodies({ ...base, sunEcef: unit([1, -0.25, 0]) }, view).find((b) => b.kind === 'moon');
  assert.ok(full.lit > 0.99, `${full.lit}`);
  const half = skyBodies({ ...base, sunEcef: [0, 0, 1] }, view).find((b) => b.kind === 'moon');
  assert.ok(Math.abs(half.lit - 0.5) < 0.05, `${half.lit}`);
  // Sun toward +z (north, up the frame): the lit limb points up (canvas angle -90 deg).
  assert.ok(Math.abs(half.limb + Math.PI / 2) < 0.1, `${half.limb}`);
  // About half a degree across: ~10 px at this field of view.
  assert.ok(half.r > 4 && half.r < 6, `${half.r}`);
});

test('the Moon shifts against the stars as the camera comes closer (parallax)', () => {
  const sky = { moonEcef: unit([-1, 0.25, 0]), moonKm: 384_400, sunEcef: [0, 0, 1], planets: [] };
  const far = skyBodies({ ...sky, camDistKm: 1e9 }, view).find((b) => b.kind === 'moon');
  const near = skyBodies({ ...sky, camDistKm: 6 * 6371 }, view).find((b) => b.kind === 'moon');
  assert.ok(Math.abs(near.x - far.x) > 10, `${far.x} -> ${near.x}`);
});

test('planets fainter than the faintest star, and bodies behind the camera, are left out', () => {
  const sky = { moonEcef: unit([1, 0, 0]), moonKm: 384_400, camDistKm: 4 * 6371, sunEcef: unit([1, 0.1, 0]),
    planets: [
      { name: 'jupiter', dirEcef: unit([-1, -0.1, 0.05]), mag: -2.0, color: '#dec79c' },
      { name: 'faint', dirEcef: unit([-1, 0.1, 0.05]), mag: PLANET_MAG_LIMIT + 0.5, color: '#fff' },
    ] };
  const b = skyBodies(sky, view);
  assert.deepEqual(b.map((x) => x.kind + (x.name ? `:${x.name}` : '')), ['planet:jupiter']);
});

import { drawStars, GLOW_MAG } from '../lib/map/stars.mjs';

test('drawStars: a halo only for the brightest, then every dot, bright ones last', () => {
  const calls = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() {}, fill() {},
    arc(x, y, r) { calls.push({ x, r }); },
  };
  const f = starField([6752, -1672, -146, 0, 5000, 1000, 300, 65, 5100, 1100, 550, 120]);
  const placed = [{ i: 0, x: 1, y: 0 }, { i: 1, x: 2, y: 0 }, { i: 2, x: 3, y: 0 }];
  drawStars(ctx, f, placed);
  // Two faint dots, then Sirius's halo and dot.
  assert.deepEqual(calls.map((c) => c.x), [3, 2, 1, 1]);
  assert.ok(calls[2].r > calls[3].r * 2.5);
  assert.ok(f.mag[0] < GLOW_MAG && f.mag[1] > GLOW_MAG);
});
