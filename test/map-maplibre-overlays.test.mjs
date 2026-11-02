import test from 'node:test';
import assert from 'node:assert/strict';
import { addOverlays, setOverlayData } from '../lib/map/maplibre-overlays.mjs';

/** A stand-in for a MapLibre map that records what is added and updated. */
function fakeMap() {
  const images = new Map();
  const sources = new Map();
  const layers = new Map();
  const calls = { addImage: 0, addSource: 0, addLayer: 0, setData: 0 };
  return {
    calls,
    images,
    sources,
    layers,
    hasImage: (id) => images.has(id),
    addImage: (id, image, options) => {
      calls.addImage++;
      if (images.has(id)) throw new Error(`image ${id} exists`);
      images.set(id, { image, options });
    },
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => {
      calls.addSource++;
      if (sources.has(id)) throw new Error(`source ${id} exists`);
      sources.set(id, { spec, setData: (d) => { calls.setData++; sources.get(id).data = d; } });
    },
    getLayer: (id) => layers.get(id),
    addLayer: (layer) => {
      calls.addLayer++;
      if (layers.has(layer.id)) throw new Error(`layer ${layer.id} exists`);
      layers.set(layer.id, layer);
    },
  };
}

const empty = { type: 'FeatureCollection', features: [] };
const input = () => ({
  images: [{ id: 'dot', width: 2, height: 2, data: new Uint8ClampedArray(16), sdf: true }],
  layers: [{ id: 'a', type: 'fill', source: 'src-a' }, { id: 'b', type: 'line', source: 'src-b' }],
  data: { 'src-a': empty, 'src-b': empty },
});

test('addOverlays is safe to call twice', () => {
  const map = fakeMap();
  addOverlays(map, input());
  assert.deepEqual(map.calls, { addImage: 1, addSource: 2, addLayer: 2, setData: 0 });
  addOverlays(map, input());
  assert.deepEqual(map.calls, { addImage: 1, addSource: 2, addLayer: 2, setData: 2 });
});

test('addOverlays passes the sdf flag and adds layers in order', () => {
  const map = fakeMap();
  addOverlays(map, input());
  const dot = map.images.get('dot');
  assert.deepEqual(dot.options, { sdf: true });
  assert.deepEqual({ width: dot.image.width, height: dot.image.height }, { width: 2, height: 2 });
  assert.deepEqual([...map.layers.keys()], ['a', 'b']);
  assert.deepEqual(map.sources.get('src-a').spec, { type: 'geojson', data: empty });
});

test('setOverlayData updates only sources that exist and are given', () => {
  const map = fakeMap();
  addOverlays(map, input());
  const next = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] };
  setOverlayData(map, { 'src-a': next, 'src-missing': next });
  assert.equal(map.calls.setData, 1);
  assert.equal(map.sources.get('src-a').data, next);
});
