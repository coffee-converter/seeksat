import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';
import {
  subpoint, groundTrack, footprintFeature, nightBands, loadLand,
} from '../lib/map/geometry.mjs';
import { makeProjection } from '../lib/map/projections.mjs';
import { drawMap, hitTest, MAP_COLORS, SAT_PALETTE } from '../lib/map/draw.mjs';

// Recording stand-in for CanvasRenderingContext2D: logs method calls and
// snapshots fillStyle at each fill so draw order can be asserted.
function recordingCtx() {
  const calls = [];
  const ctx = {};
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'rect', 'fill', 'stroke',
    'fillText', 'strokeText', 'save', 'restore', 'setLineDash', 'clip']) {
    ctx[m] = (...args) => { calls.push({ m, args, fillStyle: ctx.fillStyle, lineWidth: ctx.lineWidth }); };
  }
  return { ctx, calls };
}

const NOW = Date.parse('2026-03-01T12:00:00Z');
const W = 800;
const H = 400;

function scene() {
  const specs = [
    [ISS_LINE1, ISS_LINE2, 'ISS', '#ff9b54'],
    [GOES16_LINE1, GOES16_LINE2, 'GOES 16', '#7fe5d1'],
  ];
  return specs.map(([l1, l2, name, color], i) => {
    const rec = recordFrom(l1, l2, name);
    const track = makeTrack(rec);
    const sub = subpoint(track.ecefAt(new Date(NOW)));
    return {
      noradId: rec.noradId, name, color,
      track: groundTrack(track, NOW),
      position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
      footprint: i === 0 ? footprintFeature(sub, sub.altKm, 0) : null,
      selected: i === 0,
    };
  });
}

function args(sats) {
  return {
    projection: makeProjection('equirectangular', { width: W, height: H }),
    width: W, height: H, land: loadLand(), nightBands: nightBands(new Date(NOW)),
    sats, observer: { name: 'EN52ve', latDeg: EN52VE.latDeg, lonDeg: EN52VE.lonDeg },
  };
}

test('SAT_PALETTE has the scene colours', () => {
  assert.equal(SAT_PALETTE.length, 8);
  assert.equal(SAT_PALETTE[0], '#ff9b54');
});

test('drawMap runs on equirectangular with ISS and GOES-16', () => {
  const { ctx, calls } = recordingCtx();
  assert.doesNotThrow(() => drawMap(ctx, args(scene())));
  assert.ok(calls.some((c) => c.m === 'stroke'));
});

test('the first fill is the sphere, in the ocean colour', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const first = calls.find((c) => c.m === 'fill');
  assert.equal(first.fillStyle, MAP_COLORS.ocean);
});

test('night bands fill once each with the night colour', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const night = calls.filter((c) => c.m === 'fill' && c.fillStyle === MAP_COLORS.night);
  assert.equal(night.length, 4);
});

test('fillText is called once per satellite label', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const labels = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]);
  assert.deepEqual(labels.sort(), ['GOES 16', 'ISS']);
});

test('drawMap tolerates no sats and no observer', () => {
  const { ctx } = recordingCtx();
  assert.doesNotThrow(() => drawMap(ctx, { ...args([]), observer: null }));
});

test('hitTest finds the ISS at its projected point, null 50 px away', () => {
  const sats = scene();
  const projection = makeProjection('equirectangular', { width: W, height: H });
  const iss = sats[0];
  const [x, y] = projection([iss.position.lonDeg, iss.position.latDeg]);
  assert.equal(hitTest(sats, projection, x, y), iss.noradId);
  assert.equal(hitTest(sats, projection, x + 5, y + 5), iss.noradId);
  assert.equal(hitTest(sats, projection, x + 50, y), null);
});

test('hitTest picks the nearest of two overlapping dots', () => {
  const projection = makeProjection('equirectangular', { width: W, height: H });
  const a = { noradId: 1, position: { lonDeg: 0, latDeg: 0 } };
  const b = { noradId: 2, position: { lonDeg: 1, latDeg: 0 } };
  const [x, y] = projection([1, 0]);
  assert.equal(hitTest([a, b], projection, x, y), 2);
});

test('hitTest ignores satellites the projection clips away', () => {
  const projection = makeProjection('polar-north', { width: W, height: H });
  const far = { noradId: 3, position: { lonDeg: 0, latDeg: -80 } };
  assert.equal(hitTest([far], projection, W / 2, H / 2), null);
});
