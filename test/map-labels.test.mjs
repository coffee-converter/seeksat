import { test } from 'node:test';
import assert from 'node:assert/strict';
import places from '../lib/map/places.json' with { type: 'json' };
import { REGIONS } from '../lib/map/regions.mjs';
import { makeProjection, PROJECTIONS } from '../lib/map/projections.mjs';
import { EN52VE } from './fixtures/orbits.mjs';
import {
  graticuleStep, formatLat, formatLon, graticuleLabels, pickPlaceLabels, placeBox, graticuleBox,
  satBoxes, seasAllowed, maxRegionLabels, CHAR_PX,
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

test('graticuleStep is at least 60 below 500 px wide', () => {
  assert.equal(graticuleStep(1, 499), 60);
  assert.equal(graticuleStep(8, 390), 60);
  assert.equal(graticuleStep(1, 500), 30);
  assert.equal(graticuleStep(8, 900), 5);
});

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
      const labels = graticuleLabels(proj(id, width, height), { width, height, step: 30, projectionId: id });
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
  assert.equal(a[0].x, width / 2);
  assert.equal(a[0].y, height / 2 + 24);

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
    const labels = graticuleLabels(proj('equirectangular', width, height), { width, height, step: 30, projectionId: 'equirectangular' });
    assert.equal(labels.filter((l) => l.text === '180°').length, 1, `${width}x${height}`);
  }
});

for (const [id, rimLat] of [['polar-north', -20], ['polar-south', 20]]) {
  test(`${id} meridian labels sit on the rim`, () => {
    const width = 900;
    const height = 450;
    const p = proj(id, width, height);
    const [rl, rp] = p.rotate();
    const c = p([-rl, -rp]);
    const rim = p([0, rimLat]);
    const R = Math.hypot(rim[0] - c[0], rim[1] - c[1]);
    const labels = graticuleLabels(p, { width, height, step: 30, projectionId: id });
    const meridians = labels.filter((l) => l.line === 'meridian');
    assert.ok(meridians.length >= 10, `only ${meridians.length} of 12 meridians: ${meridians.map((l) => l.text)}`);
    for (const l of meridians) {
      const r = Math.hypot(l.x - c[0], l.y - c[1]);
      assert.ok(r >= 0.9 * R, `${l.text} at r/R ${(r / R).toFixed(2)}`);
    }
    assert.ok(labels.some((l) => l.line === 'parallel'), 'no parallel labels');
  });
}

test('azimuthal meridian labels are at distinct points', () => {
  for (const [width, height] of SIZES) {
    const labels = graticuleLabels(proj('azimuthal', width, height), { width, height, step: 30, projectionId: 'azimuthal' });
    const meridians = labels.filter((l) => l.line === 'meridian');
    assert.ok(meridians.length >= 2, `${width}x${height}: ${meridians.length} meridian labels`);
    for (let i = 0; i < meridians.length; i++) {
      for (let j = i + 1; j < meridians.length; j++) {
        const d = Math.hypot(meridians[i].x - meridians[j].x, meridians[i].y - meridians[j].y);
        assert.ok(d >= 20, `${width}x${height}: ${meridians[i].text} and ${meridians[j].text} are ${d.toFixed(1)} px apart`);
      }
    }
  }
});

test('place labels avoid the lat/lon labels', () => {
  for (const { id } of PROJECTIONS) {
    for (const [width, height] of SIZES) {
      for (const zoom of [1, 4]) {
        const p = proj(id, width, height, { zoom });
        const avoid = graticuleLabels(p, { width, height, step: 30, projectionId: id }).map(graticuleBox);
        const labels = pickPlaceLabels(p, { width, height, zoom, places, regions: REGIONS, avoid });
        assert.ok(labels.length >= 1, `${id} ${width}x${height} z${zoom}: no labels`);
        for (const l of labels) {
          const box = placeBox(l);
          assert.ok(!avoid.some((a) => overlaps(a, box)), `${id} ${width}x${height} z${zoom}: ${l.text} hits a lat/lon label`);
        }
      }
    }
  }
});

test('a phone-sized map shows no seas and at most 2 region names', () => {
  const width = 360;
  const height = 240;
  for (const { id } of PROJECTIONS) {
    const labels = pickPlaceLabels(proj(id, width, height), { width, height, zoom: 1, places, regions: REGIONS });
    const regions = labels.filter((l) => l.kind === 'region');
    const seaNames = new Set(REGIONS.filter((r) => r.kind === 'sea').map((r) => r.name));
    assert.deepEqual(regions.filter((l) => seaNames.has(l.text)).map((l) => l.text), [], `${id}: seas`);
    assert.ok(regions.length <= 2, `${id}: ${regions.length} regions: ${regions.map((l) => l.text)}`);
  }
});

test('seas need zoom 2 or a 600 x 400 canvas; regions are capped by area', () => {
  assert.equal(seasAllowed(360, 240, 1), false);
  assert.equal(seasAllowed(360, 240, 2), true);
  assert.equal(seasAllowed(600, 400, 1), true);
  assert.equal(seasAllowed(599, 400, 1), false);
  assert.equal(maxRegionLabels(360, 240), 2);
  assert.equal(maxRegionLabels(900, 450), 7);
  assert.equal(maxRegionLabels(1060, 844), 15);
});

test('a big map still names seas once the continents and oceans are placed', () => {
  const width = 1400;
  const height = 800;
  const labels = pickPlaceLabels(proj('equirectangular', width, height), { width, height, zoom: 1, places, regions: REGIONS });
  const seaNames = new Set(REGIONS.filter((r) => r.kind === 'sea').map((r) => r.name));
  assert.ok(labels.some((l) => seaNames.has(l.text)), 'no sea labels');
  assert.ok(labels.filter((l) => l.kind === 'region').length <= maxRegionLabels(width, height));
});

test('satBoxes covers the dot and the name, flips near the right edge, skips hidden and names no ghost', () => {
  const width = 900;
  const height = 450;
  const p = proj('equirectangular', width, height);
  const at = (lonDeg, latDeg, extra) => ({ noradId: 1, name: 'ISS', position: { lonDeg, latDeg }, emphasis: 'normal', ...extra });
  const [x, y] = p([0, 0]);
  const [dot, name] = satBoxes(p, [at(0, 0)], width);
  assert.deepEqual(dot, { x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4 });
  assert.equal(name.x0, x + 9);
  assert.equal(name.x1, x + 9 + 3 * CHAR_PX);
  const [xr] = p([175, 0]);
  const flipped = satBoxes(p, [at(175, 0)], width)[1];
  assert.equal(flipped.x1, xr - 9);
  assert.equal(satBoxes(p, [at(0, 0, { emphasis: 'hidden' })], width).length, 0);
  assert.equal(satBoxes(p, [at(0, 0, { emphasis: 'ghost' })], width).length, 1);
});

test('place labels keep clear of satellite dots and names', () => {
  const width = 900;
  const height = 450;
  const p = proj('equirectangular', width, height);
  // Satellites parked on top of busy places.
  const sats = [[-74, 40.7], [2.3, 48.9], [139.7, 35.7], [20, 3], [-150, 25]].map(([lonDeg, latDeg], i) => ({
    noradId: i + 1, name: `Satellite ${i + 1}`, position: { lonDeg, latDeg }, emphasis: 'normal',
  }));
  const avoid = satBoxes(p, sats, width);
  const labels = pickPlaceLabels(p, { width, height, zoom: 1, places, regions: REGIONS, avoid });
  assert.ok(labels.length >= 1);
  for (const l of labels) {
    const box = placeBox(l);
    assert.ok(!avoid.some((a) => overlaps(a, box)), `${l.text} hits a satellite`);
  }
});
