// lib/pass-finder/heatmap.js — pure compute for the regional
// pass-quality heatmap. Builds a grid of virtual single observers
// around the user's stations, scores each one's ISS passes over a
// forecast window by reusing the existing pass-finder math, and
// aggregates per cell. No Cesium, no DOM — unit-testable.

// Region (center + half-extents in degrees) covering the user's
// observers. Empty/sparse observer sets fall back to a default radius
// so a single station still gets a sensible "reasonable drive" box.
export function regionForObservers(observers, opts = {}) {
  const defaultRadiusDeg = opts.defaultRadiusDeg ?? 2.5;
  const padDeg = opts.padDeg ?? 0.75;
  if (!observers || observers.length === 0) {
    return { centerLat: 0, centerLon: 0, halfLatDeg: defaultRadiusDeg, halfLonDeg: defaultRadiusDeg };
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const o of observers) {
    if (o.latDeg < minLat) minLat = o.latDeg;
    if (o.latDeg > maxLat) maxLat = o.latDeg;
    if (o.lonDeg < minLon) minLon = o.lonDeg;
    if (o.lonDeg > maxLon) maxLon = o.lonDeg;
  }
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  let halfLatDeg = (maxLat - minLat) / 2 + padDeg;
  let halfLonDeg = (maxLon - minLon) / 2 + padDeg;
  if (halfLatDeg < defaultRadiusDeg) halfLatDeg = defaultRadiusDeg;
  if (halfLonDeg < defaultRadiusDeg) halfLonDeg = defaultRadiusDeg;
  return { centerLat, centerLon, halfLatDeg, halfLonDeg };
}

// Build an n×n grid of cell CENTERS over the region. row 0 / col 0 is
// the south-west corner. Returns the corner bounds too (for the Cesium
// rectangle) and per-cell {id, row, col, latDeg, lonDeg}.
export function buildGrid(region, n) {
  const { centerLat, centerLon, halfLatDeg, halfLonDeg } = region;
  const south = centerLat - halfLatDeg;
  const west = centerLon - halfLonDeg;
  const north = centerLat + halfLatDeg;
  const east = centerLon + halfLonDeg;
  const dLat = (2 * halfLatDeg) / n;
  const dLon = (2 * halfLonDeg) / n;
  const cells = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      cells.push({
        id: `hm-${row}-${col}`,
        row,
        col,
        latDeg: south + (row + 0.5) * dLat,
        lonDeg: west + (col + 0.5) * dLon,
      });
    }
  }
  return { n, dLat, dLon, south, west, north, east, cells };
}
