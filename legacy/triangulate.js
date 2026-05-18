// triangulate.js -- pure math. N-ray least-squares closest point.
// Input rays: [{ origin: [x,y,z], dir: [x,y,z] (unit) }, ...]
// Returns { point: [x,y,z] | null, residuals: number[] }.

function solve3(A, b) {
  const [a, m01, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = a*(e*i - f*h) - m01*(d*i - f*g) + c*(d*h - e*g);
  if (Math.abs(det) < 1e-30) return null;
  const inv = 1 / det;
  return [
    inv * ( b[0]*(e*i - f*h) - m01*(b[1]*i - f*b[2]) + c*(b[1]*h - e*b[2]) ),
    inv * ( a*(b[1]*i - f*b[2]) - b[0]*(d*i - f*g) + c*(d*b[2] - b[1]*g) ),
    inv * ( a*(e*b[2] - b[1]*h) - m01*(d*b[2] - b[1]*g) + b[0]*(d*h - e*g) ),
  ];
}

export function triangulateRays(rays) {
  const A = [[0,0,0],[0,0,0],[0,0,0]];
  const b = [0, 0, 0];
  for (const { origin: p, dir: d } of rays) {
    // Accumulate (I - d dT).
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        A[i][j] += (i === j ? 1 : 0) - d[i]*d[j];
      }
    }
    // Accumulate (I - d dT) p = p - (d . p) d.
    const dp = d[0]*p[0] + d[1]*p[1] + d[2]*p[2];
    b[0] += p[0] - d[0]*dp;
    b[1] += p[1] - d[1]*dp;
    b[2] += p[2] - d[2]*dp;
  }
  const x = solve3(A, b);
  if (!x) return { point: null, residuals: rays.map(() => Infinity) };
  const residuals = rays.map(({ origin: p, dir: d }) => {
    const vx = x[0]-p[0], vy = x[1]-p[1], vz = x[2]-p[2];
    const along = vx*d[0] + vy*d[1] + vz*d[2];
    const px = vx - d[0]*along, py = vy - d[1]*along, pz = vz - d[2]*along;
    return Math.hypot(px, py, pz);
  });
  return { point: x, residuals };
}
