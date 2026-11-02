// lib/map/maplibre-overlays.mjs - put the overlay images, sources and layers
// (lib/map/overlays.mjs) on a MapLibre map. Idempotent: safe on every style.load.

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
    if (source) source.setData(geojson);
    else map.addSource(id, { type: 'geojson', data: geojson });
  }
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  const before = map.getLayer(CUSTOM_BEFORE) ? CUSTOM_BEFORE : undefined;
  for (const layer of custom) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }
}

/** New data for the overlay sources the map has; others are skipped. */
export function setOverlayData(map, data) {
  for (const [id, geojson] of Object.entries(data)) map.getSource(id)?.setData(geojson);
}
