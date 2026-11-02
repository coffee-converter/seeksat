import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootprintLayer, drawsGlobeCap, FOOTPRINT_GLOBE_LAYER, GLOBE_FULL_ZOOM } from '../lib/map/footprint-layer.mjs';

test('the cap draws on a full globe only', () => {
  assert.equal(drawsGlobeCap({ view: 'globe', zoom: 2 }), true);
  assert.equal(drawsGlobeCap({ view: 'globe', zoom: GLOBE_FULL_ZOOM }), true);
  // Past this MapLibre starts to morph the globe toward Mercator.
  assert.equal(drawsGlobeCap({ view: 'globe', zoom: GLOBE_FULL_ZOOM + 0.01 }), false);
  assert.equal(drawsGlobeCap({ view: 'globe', zoom: 14 }), false);
  assert.equal(drawsGlobeCap({ view: 'flat', zoom: 2 }), false);
});

test('a layer that failed to compile hands the fill back to GeoJSON', () => {
  assert.equal(drawsGlobeCap({ view: 'globe', zoom: 2, failed: true }), false);
});

test('the layer is a 2d custom layer', () => {
  const layer = createFootprintLayer();
  assert.equal(layer.id, FOOTPRINT_GLOBE_LAYER);
  assert.equal(layer.type, 'custom');
  assert.equal(layer.renderingMode, '2d');
});

test('setFootprint repaints only when what is drawn changes', () => {
  const layer = createFootprintLayer();
  let repaints = 0;
  layer.onAdd({ triggerRepaint: () => repaints++ });
  const fp = (lon, lat, radiusDeg = 20, color = '#ff9b54') => ({ center: [lon, lat], radiusDeg, color });
  layer.setFootprint(fp(10, 80));
  assert.equal(repaints, 1);
  layer.setFootprint(fp(10.005, 80.005)); // under 0.01 degrees: same mesh
  assert.equal(repaints, 1);
  layer.setFootprint(fp(10.02, 80));
  assert.equal(repaints, 2);
  layer.setFootprint(fp(10.02, 80, 21));
  assert.equal(repaints, 3);
  layer.setFootprint(fp(10.02, 80, 21, '#7fe5d1'));
  assert.equal(repaints, 4);
  layer.setFootprint(null);
  assert.equal(repaints, 5);
  layer.setFootprint(null);
  assert.equal(repaints, 5);
});

test('a move across the date line counts as small', () => {
  const layer = createFootprintLayer();
  let repaints = 0;
  layer.onAdd({ triggerRepaint: () => repaints++ });
  layer.setFootprint({ center: [179.998, 0], radiusDeg: 20, color: '#ffffff' });
  layer.setFootprint({ center: [-179.998, 0], radiusDeg: 20, color: '#ffffff' });
  assert.equal(repaints, 1);
});

test('a shader that does not compile logs once, calls onFail once and draws nothing', () => {
  let fails = 0;
  let draws = 0;
  const logged = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, deleteShader() {},
    getShaderParameter: () => false, getShaderInfoLog: () => 'bad shader',
    drawElements: () => draws++,
  };
  const layer = createFootprintLayer({ onFail: () => fails++ });
  layer.onAdd({ triggerRepaint() {} });
  layer.setFootprint({ center: [0, 80], radiusDeg: 20, color: '#ffffff' });
  const args = {
    shaderData: { variantName: 'globe', vertexShaderPrelude: '', define: '#define GLOBE' },
    defaultProjectionData: { projectionTransition: 1 },
  };
  const error = console.error;
  console.error = (m) => logged.push(m);
  try {
    layer.render(gl, args);
    layer.render(gl, args);
  } finally {
    console.error = error;
  }
  assert.equal(fails, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /bad shader/);
  assert.equal(draws, 0);
});

test('nothing draws while the globe morphs toward Mercator', () => {
  let compiled = 0;
  const gl = { createShader: () => compiled++ };
  const layer = createFootprintLayer();
  layer.onAdd({ triggerRepaint() {} });
  layer.setFootprint({ center: [0, 80], radiusDeg: 20, color: '#ffffff' });
  layer.render(gl, {
    shaderData: { variantName: 'globe', vertexShaderPrelude: '', define: '' },
    defaultProjectionData: { projectionTransition: 0.99 },
  });
  assert.equal(compiled, 0);
});
