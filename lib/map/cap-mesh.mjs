// Spherical-cap triangle meshes in Web Mercator world coordinates, for the
// globe footprint layer. Pure: no DOM, no WebGL.

const RAD = Math.PI / 180;
const MAX_LAT = 89.9;

function lonLatToMerc(lon, lat) {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD;
  return [(lon + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)];
}

/** Inverse of the mercator mapping above, for tests. Returns [lon, lat] in degrees. */
export function mercToLonLat(x, y) {
  const lon = x * 360 - 180;
  const lat = (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / RAD;
  return [lon, lat];
}

/**
 * Triangle mesh of the spherical cap of angular radius radiusDeg around
 * [lon, lat]. Vertex 0 is the centre, then `rings` rings of `segments`
 * vertices each, at radii (k / rings) * radiusDeg. Longitudes are unwrapped
 * relative to the centre, so x may leave 0..1.
 * @returns {{ positions: Float32Array, indices: Uint16Array }}
 */
export function capMesh([lon, lat], radiusDeg, { rings = 12, segments = 120 } = {}) {
  const vertexCount = 1 + rings * segments;
  if (vertexCount > 65536) throw new RangeError('capMesh: too many vertices for Uint16 indices');
  const positions = new Float32Array(vertexCount * 2);
  const [cx, cy] = lonLatToMerc(lon, lat);
  positions[0] = cx;
  positions[1] = cy;

  const phi1 = lat * RAD;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  for (let k = 1; k <= rings; k++) {
    const delta = ((k / rings) * radiusDeg) * RAD;
    const sinD = Math.sin(delta);
    const cosD = Math.cos(delta);
    for (let s = 0; s < segments; s++) {
      const az = (s / segments) * 2 * Math.PI;
      const sinPhi2 = Math.max(-1, Math.min(1, sinPhi1 * cosD + cosPhi1 * sinD * Math.cos(az)));
      const phi2 = Math.asin(sinPhi2);
      const dLon = Math.atan2(Math.sin(az) * sinD * cosPhi1, cosD - sinPhi1 * sinPhi2) / RAD;
      // atan2 returns (-180, 180]: already the continuous offset from the centre.
      const [x, y] = lonLatToMerc(lon + dLon, phi2 / RAD);
      const v = 1 + (k - 1) * segments + s;
      positions[v * 2] = x;
      positions[v * 2 + 1] = y;
    }
  }

  const indices = new Uint16Array(3 * (segments + 2 * segments * (rings - 1)));
  let n = 0;
  for (let s = 0; s < segments; s++) {
    indices[n++] = 0;
    indices[n++] = 1 + s;
    indices[n++] = 1 + ((s + 1) % segments);
  }
  for (let k = 1; k < rings; k++) {
    const inner = 1 + (k - 1) * segments;
    const outer = 1 + k * segments;
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      indices[n++] = inner + s;
      indices[n++] = outer + s;
      indices[n++] = outer + s2;
      indices[n++] = inner + s;
      indices[n++] = outer + s2;
      indices[n++] = inner + s2;
    }
  }
  return { positions, indices };
}
