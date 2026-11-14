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
    addLayer: (layer, beforeId) => {
      calls.addLayer++;
      if (layers.has(layer.id)) throw new Error(`layer ${layer.id} exists`);
      if (beforeId === undefined) {
        layers.set(layer.id, layer);
        return;
      }
      if (!layers.has(beforeId)) throw new Error(`layer ${beforeId} does not exist`);
      const order = [...layers.entries()];
      layers.clear();
      for (const [id, l] of order) {
        if (id === beforeId) layers.set(layer.id, layer);
        layers.set(id, l);
      }
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
  assert.deepEqual(map.sources.get('src-a').spec, { type: 'geojson', data: empty, maxzoom: 12 });
});

test('setOverlayData updates only sources that exist and are given', () => {
  const map = fakeMap();
  addOverlays(map, input());
  const next = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] };
  setOverlayData(map, { 'src-a': next, 'src-missing': next });
  assert.equal(map.calls.setData, 1);
  assert.equal(map.sources.get('src-a').data, next);
});

test('addOverlays adds a custom layer once, below the past track and its casing', () => {
  const map = fakeMap();
  const custom = { id: 'ss-footprint-globe', type: 'custom', render() {} };
  const withTracks = () => ({
    ...input(),
    layers: [{ id: 'a', type: 'fill', source: 'src-a' }, { id: 'ss-track-past-casing', type: 'line', source: 'src-b' }, { id: 'ss-track-past', type: 'line', source: 'src-b' }],
    custom: [custom],
  });
  addOverlays(map, withTracks());
  addOverlays(map, withTracks());
  assert.equal(map.calls.addLayer, 4);
  assert.deepEqual([...map.layers.keys()], ['a', 'ss-footprint-globe', 'ss-track-past-casing', 'ss-track-past']);
  assert.equal(map.layers.get('ss-footprint-globe'), custom);
});

test('setOverlayData skips data a source already holds', () => {
  const calls = [];
  const source = { setData: (d) => calls.push(d) };
  const map = { getSource: (id) => (id === 'a' ? source : undefined) };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }] };
  setOverlayData(map, { a: fc, b: fc });
  setOverlayData(map, { a: JSON.parse(JSON.stringify(fc)) });
  assert.equal(calls.length, 1);
  setOverlayData(map, { a: { type: 'FeatureCollection', features: [] } });
  assert.equal(calls.length, 2);
});
