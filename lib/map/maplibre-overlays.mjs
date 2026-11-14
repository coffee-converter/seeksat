// lib/map/maplibre-overlays.mjs - put the overlay images, sources and layers
// (lib/map/overlays.mjs) on a MapLibre map. Idempotent: safe on every style.load.

// What each source was last given, keyed by the source object (a new style
// makes new sources, which start empty here).
const sent = new WeakMap();
/** The overlay sources' tiling depth (MapLibre's default is 18). */
const OVERLAY_MAX_ZOOM = 12;

/** Custom (WebGL) layers go below this one, so the tracks draw over them. */
const CUSTOM_BEFORE = 'ss-track-past';

/**
 * Adds each image, source and layer the map lacks; a source it already has
 * gets the new data instead. Layers go on top, in the order given; custom
 * layers go below the past track (or on top if the map has none).
 */
export function addOverlays(map, { images = [], layers = [], data = {}, custom = [] }) {
  for (const { id, width, height, data: pixels, sdf } of images) {
    if (!map.hasImage(id)) map.addImage(id, { width, height, data: pixels }, { sdf: !!sdf });
  }
  for (const [id, geojson] of Object.entries(data)) {
    const source = map.getSource(id);
    if (source) {
      source.setData(geojson);
      sent.set(source, JSON.stringify(geojson));
    } else {
      // Tiled to zoom 12 and drawn larger beyond it: about a metre of
      // precision, and far less re-tiling for each update when zoomed in.
      map.addSource(id, { type: 'geojson', data: geojson, maxzoom: OVERLAY_MAX_ZOOM });
    }
  }
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  const before = map.getLayer(CUSTOM_BEFORE) ? CUSTOM_BEFORE : undefined;
  for (const layer of custom) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }
}

/** New data for the overlay sources the map has; others are skipped, and so
 *  is data the same as the source already holds: each setData has MapLibre's
 *  worker re-tile the source and the map rebuild its tiles, and many pushes
 *  resend sources that have not changed (your location, a paused pass). */
export function setOverlayData(map, data) {
  for (const [id, geojson] of Object.entries(data)) {
    const source = map.getSource(id);
    if (!source) continue;
    const json = JSON.stringify(geojson);
    if (sent.get(source) === json) continue;
    sent.set(source, json);
    source.setData(geojson);
  }
}
