import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triangulateRays } from '../lib/triangulate.js';

function rayFromTo(p, target) {
  const d = [target[0]-p[0], target[1]-p[1], target[2]-p[2]];
  const L = Math.hypot(...d);
  return { origin: p, dir: [d[0]/L, d[1]/L, d[2]/L] };
}

test('two perfect rays at known point', () => {
  const target = [10, 20, 30];
  const rays = [
    rayFromTo([0, 0, 0], target),
    rayFromTo([5, 0, 0], target),
  ];
  const { point, residuals } = triangulateRays(rays);
  assert.ok(point !== null);
  const err = Math.hypot(point[0]-10, point[1]-20, point[2]-30);
  assert.ok(err < 1e-6, `point error ${err}`);
  assert.ok(residuals.every(r => r < 1e-6));
});

test('three rays from non-coplanar origins', () => {
  const target = [100, -50, 200];
  const rays = [
    rayFromTo([0, 0, 0], target),
    rayFromTo([50, 0, 0], target),
    rayFromTo([0, 50, 10], target),
  ];
  const { point } = triangulateRays(rays);
  const err = Math.hypot(point[0]-100, point[1]+50, point[2]-200);
  assert.ok(err < 1e-6, `point error ${err}`);
});

test('parallel rays produce null (singular system)', () => {
  const rays = [
    { origin: [0, 0, 0], dir: [1, 0, 0] },
    { origin: [0, 1, 0], dir: [1, 0, 0] },
  ];
  const { point } = triangulateRays(rays);
  assert.equal(point, null);
});

test('noisy rays return point near truth with bounded residuals', () => {
  const target = [400000, 200000, 6800000]; // roughly ISS-altitude scale
  const observer1 = [-100000, 0, 6378000];
  const observer2 = [   100000, 0, 6378000];
  const r1 = rayFromTo(observer1, target);
  const r2 = rayFromTo(observer2, target);
  // Add ~2 arc-second noise to each direction via Rodrigues rotation
  // around an arbitrary axis perpendicular to the ray.
  const noise = 2 * (Math.PI / 180) / 3600;
  const tilt = (dir, theta) => {
    const k = [-dir[1], dir[0], 0];
    const kl = Math.hypot(...k);
    if (kl < 1e-9) return dir;
    const kn = [k[0]/kl, k[1]/kl, k[2]/kl];
    const c = Math.cos(theta), s = Math.sin(theta);
    const kd = kn[0]*dir[0] + kn[1]*dir[1] + kn[2]*dir[2];
    return [
      dir[0]*c + (kn[1]*dir[2]-kn[2]*dir[1])*s + kn[0]*kd*(1-c),
      dir[1]*c + (kn[2]*dir[0]-kn[0]*dir[2])*s + kn[1]*kd*(1-c),
      dir[2]*c + (kn[0]*dir[1]-kn[1]*dir[0])*s + kn[2]*kd*(1-c),
    ];
  };
  const rays = [
    { origin: r1.origin, dir: tilt(r1.dir,  noise) },
    { origin: r2.origin, dir: tilt(r2.dir, -noise) },
  ];
  const { point, residuals } = triangulateRays(rays);
  const err = Math.hypot(point[0]-target[0], point[1]-target[1], point[2]-target[2]);
  assert.ok(err < 1000, `point error ${err} m`);
  assert.ok(residuals.every(r => r < 1000));
});
