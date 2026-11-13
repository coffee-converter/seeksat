// lib/map/sight-path.mjs - The live sight line as an SVG path in screen
// pixels. The map draws it over the canvas, projected in the same frame as
// the satellite's marker, so its end stays on the dot: a GeoJSON line goes
// through MapLibre's worker and lands a frame or more behind.

/**
 * An SVG path through projected points ({ x, y, hidden }), broken where a
 * point is hidden (behind the globe), with the first `trimPx` of the line left
 * off so it starts at the edge of the observer's icon rather than across it.
 */
export function sightPathD(points, trimPx = 0) {
  let skip = trimPx;
  let d = '';
  let open = false;
  let prev = null;
  for (const p of points) {
    if (p.hidden || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      open = false;
      prev = null;
      skip = 0;
      continue;
    }
    let { x, y } = p;
    if (skip > 0) {
      if (!prev) {
        prev = p;
        continue;
      }
      const seg = Math.hypot(x - prev.x, y - prev.y);
      if (seg <= skip) {
        skip -= seg;
        prev = p;
        continue;
      }
      // The trim ends inside this segment: start from there.
      const t = skip / seg;
      d += `M${(prev.x + (x - prev.x) * t).toFixed(1)} ${(prev.y + (y - prev.y) * t).toFixed(1)}`;
      skip = 0;
      open = true;
    }
    d += `${open ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    open = true;
    prev = p;
  }
  return d;
}
