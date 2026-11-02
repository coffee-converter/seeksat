import test from 'node:test';
import assert from 'node:assert/strict';
import { geoDistance } from 'd3-geo';
import { capMesh, mercToLonLat } from '../lib/map/cap-mesh.mjs';

const DEG = 180 / Math.PI;

test('counts match rings and segments', () => {
  for (const [rings, segments] of [[12, 120], [3, 8], [1, 6]]) {
    const { positions, indices } = capMesh([10, 20], 15, { rings, segments });
    const vertices = 1 + rings * segments;
    assert.equal(positions.length, vertices * 2);
    assert.equal(indices.length, 3 * (segments + 2 * segments * (rings - 1)));
    assert.ok(indices.every((i) => i < vertices));
  }
});

test('defaults stay within Uint16 indices', () => {
  const { positions, indices } = capMesh([0, 0], 20);
  assert.equal(positions.length / 2, 1441);
  assert.ok(indices instanceof Uint16Array);
  assert.ok(positions instanceof Float32Array);
});

test('outer ring sits at the cap radius', () => {
  for (const [centre, r] of [[[0, 0], 20], [[-40, 78], 18]]) {
    const rings = 12;
    const segments = 120;
    const { positions } = capMesh(centre, r, { rings, segments });
    const start = 1 + (rings - 1) * segments;
    for (let i = start; i < start + segments; i++) {
      const p = mercToLonLat(positions[i * 2], positions[i * 2 + 1]);
      assert.ok(Math.abs(geoDistance(centre, p) * DEG - r) < 0.05, `vertex ${i} off radius`);
    }
  }
});

test('no mercator blow-up near the pole', () => {
  for (const centre of [[-40, 78], [-40, 70]]) {
    const { positions } = capMesh(centre, 18);
    for (let i = 0; i < positions.length; i += 2) {
      assert.ok(Number.isFinite(positions[i]) && Number.isFinite(positions[i + 1]));
      const [, lat] = mercToLonLat(positions[i], positions[i + 1]);
      assert.ok(Math.abs(lat) <= 89.9 + 1e-3, `lat ${lat}`);
    }
  }
});

test('longitude is continuous over the date line', () => {
  const rings = 12;
  const segments = 120;
  const { positions } = capMesh([179, 0], 10, { rings, segments });
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < segments; s++) {
      const a = 1 + k * segments + s;
      const b = 1 + k * segments + ((s + 1) % segments);
      assert.ok(Math.abs(positions[a * 2] - positions[b * 2]) < 0.5);
    }
  }
  for (let i = 1; i < positions.length / 2; i++) {
    assert.ok(Math.abs(positions[i * 2] - positions[0]) < 0.5);
  }
});
