// lib/map/maplibre-overlays.mjs - put the overlay images, sources and layers
// (lib/map/overlays.mjs) on a MapLibre map. Idempotent: safe on every style.load.

/**
 * Adds each image, source and layer the map lacks; a source it already has
 * gets the new data instead. Layers go on top, in the order given.
 */
export function addOverlays(map, { images = [], layers = [], data = {} }) {
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
}

/** New data for the overlay sources the map has; others are skipped. */
export function setOverlayData(map, data) {
  for (const [id, geojson] of Object.entries(data)) map.getSource(id)?.setData(geojson);
}
