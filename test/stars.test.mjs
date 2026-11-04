import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starField, projectStars, bvToKelvin, bvToRgb, starStyle } from '../lib/map/stars.mjs';
import { STARS, STAR_COUNT } from '../lib/map/star-data.mjs';
import { gmstFromDate } from '../lib/coords.js';

const field = starField(STARS);
const cam = { width: 1000, height: 800, fovDeg: 36.87 };

test('the catalogue: complete to magnitude 5.5, brightest first, Sirius leading', () => {
  assert.equal(field.n, STAR_COUNT);
  assert.ok(STAR_COUNT > 2800 && STAR_COUNT < 3000);
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
