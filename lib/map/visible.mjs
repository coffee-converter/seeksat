// lib/map/visible.mjs - projection clip test shared by draw and labels.
import { geoPath } from 'd3-geo';

/**
 * Whether [lon, lat] survives the projection's clip. Calling projection()
 * directly skips d3's clipping, so far-side points would land inside the disc.
 */
export function isVisible(projection, lonLat) {
  return geoPath(projection)({ type: 'Point', coordinates: lonLat }) != null;
}
