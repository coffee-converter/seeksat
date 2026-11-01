import { test } from 'node:test';
import assert from 'node:assert/strict';
import places from '../lib/map/places.json' with { type: 'json' };
import { REGIONS } from '../lib/map/regions.mjs';
import { makeProjection, PROJECTIONS } from '../lib/map/projections.mjs';
import { EN52VE } from './fixtures/orbits.mjs';
import {
  graticuleStep, formatLat, formatLon, graticuleLabels, pickPlaceLabels, placeBox, graticuleBox,
} from '../lib/map/labels.mjs';

const SAT = { latDeg: 30, lonDeg: -80, altKm: 420 };
const SIZES = [[360, 240], [900, 450]];

function proj(id, width, height, extra = {}) {
  return makeProjection(id, { width, height, observer: EN52VE, sat: SAT, ...extra });
}

function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function assertFits(boxes, width, height, what) {
  for (const b of boxes) {
    assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= width && b.y1 <= height, `${what}: ${b.text} outside canvas`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], boxes[j]), `${what}: ${boxes[i].text} overlaps ${boxes[j].text}`);
    }
  }
}

test('graticuleStep tightens with zoom', () => {
  assert.equal(graticuleStep(1), 30);
  assert.equal(graticuleStep(1.9), 30);
  assert.equal(graticuleStep(2), 15);
  assert.equal(graticuleStep(3.9), 15);
  assert.equal(graticuleStep(4), 10);
  assert.equal(graticuleStep(5.9), 10);
  assert.equal(graticuleStep(6), 5);
  assert.equal(graticuleStep(8), 5);
});

test('formatLat and formatLon', () => {
  assert.equal(formatLat(30), '30°N');
  assert.equal(formatLat(0), '0°');
  assert.equal(formatLat(-45), '45°S');
  assert.equal(formatLon(-60), '60°W');
  assert.equal(formatLon(0), '0°');
  assert.equal(formatLon(120), '120°E');
  assert.equal(formatLon(180), '180°');
  assert.equal(formatLon(-180), '180°');
});

test('every projection: place labels fit the canvas without overlapping', () => {
  for (const { id } of PROJECTIONS) {
    for (const [width, height] of SIZES) {
      for (const zoom of [1, 4]) {
        const labels = pickPlaceLabels(proj(id, width, height, { zoom }), { width, height, zoom, places, regions: REGIONS });
        assert.ok(labels.length >= 1, `${id} ${width}x${height} z${zoom}: no labels`);
        assertFits(labels.map((l) => ({ ...placeBox(l), text: l.text })), width, height, `${id} ${width}x${height} z${zoom}`);
      }
    }
  }
});

test('every projection: graticule labels fit the canvas without overlapping', () => {
  for (const { id } of PROJECTIONS) {
    for (const [width, height] of SIZES) {
      const labels = graticuleLabels(proj(id, width, height), { width, height, step: 30 });
      assert.ok(labels.length >= 1, `${id} ${width}x${height}: no graticule labels`);
      assertFits(labels.map((l) => ({ ...graticuleBox(l), text: l.text })), width, height, `${id} ${width}x${height}`);
    }
  }
});

test('satellite view over open ocean still gets a reference label', () => {
  const width = 900;
  const height = 450;
  const pacific = makeProjection('satellite', { width, height, sat: { lonDeg: -150, latDeg: 0, altKm: 420 } });
  const a = pickPlaceLabels(pacific, { width, height, zoom: 1, places, regions: REGIONS });
  assert.ok(a.length >= 1);
  assert.equal(a[0].text, 'Pacific Ocean');
  assert.equal(a[0].kind, 'region');

  const south = makeProjection('satellite', { width, height, sat: { lonDeg: 0, latDeg: -80, altKm: 800 } });
  const b = pickPlaceLabels(south, { width, height, zoom: 1, places, regions: REGIONS });
  assert.ok(b.length >= 1);
});

test('zooming in shows at least as many cities', () => {
  const width = 900;
  const height = 450;
  const count = (zoom) => pickPlaceLabels(makeProjection('equirectangular', { width, height, zoom }), {
    width, height, zoom, places, regions: REGIONS,
  }).filter((l) => l.kind === 'city').length;
  assert.ok(count(4) >= count(1), `zoom 4 ${count(4)} < zoom 1 ${count(1)}`);
});

test('equirectangular graticule labels show 180° exactly once', () => {
  for (const [width, height] of SIZES) {
    const labels = graticuleLabels(proj('equirectangular', width, height), { width, height, step: 30 });
    assert.equal(labels.filter((l) => l.text === '180°').length, 1, `${width}x${height}`);
  }
});

test('polar-north graticule labels include parallels and never label the pole', () => {
  const labels = graticuleLabels(proj('polar-north', 900, 450), { width: 900, height: 450, step: 30 });
  assert.ok(labels.some((l) => /°N$/.test(l.text)), 'no parallel labels');
  assert.ok(!labels.some((l) => l.text === '90°N' || l.text === '90°S'));
});
