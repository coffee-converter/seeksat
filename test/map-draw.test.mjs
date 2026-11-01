import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';
import {
  subpoint, splitTrack, footprintFeature, nightBands, loadLand,
} from '../lib/map/geometry.mjs';
import { makeProjection } from '../lib/map/projections.mjs';
import { drawMap, hitTest, isVisible, MAP_COLORS, SAT_PALETTE, MAP_PALETTES, SAT_PALETTES } from '../lib/map/draw.mjs';

// Recording stand-in for CanvasRenderingContext2D: logs method calls and
// snapshots fillStyle at each fill so draw order can be asserted.
function recordingCtx() {
  const calls = [];
  const ctx = {};
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'rect', 'fill', 'stroke',
    'fillText', 'strokeText', 'save', 'restore', 'setLineDash', 'clip']) {
    ctx[m] = (...args) => {
      if (m === 'setLineDash') ctx.dash = args[0];
      calls.push({
        m, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha, dash: ctx.dash ?? [], font: ctx.font,
      });
    };
  }
  ctx.globalAlpha = 1;
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
    const split = splitTrack(track, NOW);
    const sub = subpoint(track.ecefAt(new Date(NOW)));
    return {
      noradId: rec.noradId, name, color,
      trackPast: split.past, trackFuture: split.future, trackTicks: split.ticks,
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
  const labels = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]).filter((t) => !t.startsWith('+'));
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

test('isVisible is false for points the projection clips away', () => {
  const sat = { lonDeg: 10, latDeg: 20, altKm: 420 };
  const projection = makeProjection('satellite', { width: W, height: H, sat });
  assert.equal(isVisible(projection, [10, 20]), true);
  assert.equal(isVisible(projection, [-170, -20]), false);
  const polar = makeProjection('polar-north', { width: W, height: H });
  assert.equal(isVisible(polar, [0, 60]), true);
  assert.equal(isVisible(polar, [0, -80]), false);
});

test('hitTest ignores a satellite antipodal to the satellite view subpoint', () => {
  const sat = { lonDeg: 10, latDeg: 20, altKm: 420 };
  const projection = makeProjection('satellite', { width: W, height: H, sat });
  // The antipode projects to the disc centre unless clipping is applied.
  const hidden = { noradId: 4, position: { lonDeg: -170, latDeg: -20 } };
  const [x, y] = projection([-170, -20]);
  assert.equal(hitTest([hidden], projection, x, y), null);
});

test('hitTest ignores a far-southern satellite on the north polar view', () => {
  const projection = makeProjection('polar-north', { width: W, height: H });
  const far = { noradId: 3, position: { lonDeg: 0, latDeg: -80 } };
  const [x, y] = projection([0, -80]);
  assert.equal(hitTest([far], projection, x, y), null);
});

test('drawMap skips the dot, label and observer the satellite view hides', () => {
  const sat = { lonDeg: 10, latDeg: 20, altKm: 420 };
  const projection = makeProjection('satellite', { width: W, height: H, sat });
  const sats = [
    { noradId: 1, name: 'NEAR', color: '#ff9b54', position: { lonDeg: 10, latDeg: 20 } },
    { noradId: 2, name: 'FAR', color: '#7fe5d1', position: { lonDeg: -170, latDeg: -20 } },
  ];
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { projection, width: W, height: H, land: null, sats,
    observer: { latDeg: -20, lonDeg: -170 } });
  const labels = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]);
  assert.deepEqual(labels, ['NEAR']);
  // Only the NEAR dot is drawn as an arc; the hidden observer adds none.
  assert.equal(calls.filter((c) => c.m === 'arc').length, 1);
});

test('hitTest uses a 22 px touch radius by default', () => {
  const projection = makeProjection('equirectangular', { width: W, height: H });
  const a = { noradId: 1, position: { lonDeg: 0, latDeg: 0 } };
  const [x, y] = projection([0, 0]);
  assert.equal(hitTest([a], projection, x + 20, y), 1);
  assert.equal(hitTest([a], projection, x + 23, y), null);
});

const strokes = (calls) => calls.filter((c) => c.m === 'stroke');

test('the footprint outline is dashed [6, 5] and the dash is reset to []', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const i = calls.findIndex((c) => c.m === 'setLineDash' && c.args[0].join() === '6,5');
  assert.ok(i >= 0);
  const outline = calls.slice(i).find((c) => c.m === 'stroke');
  assert.equal(outline.strokeStyle, '#ff9b54');
  assert.equal(outline.lineWidth, 1.5);
  assert.deepEqual(outline.dash, [6, 5]);
  assert.deepEqual(calls.slice(i + 1).find((c) => c.m === 'setLineDash').args[0], []);
  const fill = calls.find((c) => c.m === 'fill' && c.globalAlpha === 0.18);
  assert.equal(fill.fillStyle, '#ff9b54');
  assert.equal(MAP_COLORS.footprint, undefined);
});

test('the past strokes dotted [2, 4] at alpha 0.5', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const past = strokes(calls).filter((c) => c.dash.join() === '2,4' && c.strokeStyle === '#ff9b54');
  assert.ok(past.length >= 1);
  for (const c of past) { assert.equal(c.globalAlpha, 0.5); assert.equal(c.lineWidth, 1.5); }
});

test('the future is 8 solid chunks with alpha falling from 1 to 0.25', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene().slice(0, 1)));
  const fut = strokes(calls).filter((c) => c.lineWidth === 2 && c.dash.length === 0
    && c.strokeStyle === '#ff9b54' && c.globalAlpha < 1.0001 && c.globalAlpha >= 0.25 && c.args.length === 0);
  const alphas = [];
  for (const c of fut) if (!alphas.length || alphas.at(-1) !== c.globalAlpha) alphas.push(c.globalAlpha);
  const chunk = alphas.slice(-8);
  assert.equal(chunk.length, 8);
  assert.equal(chunk[0], 1);
  assert.ok(Math.abs(chunk[7] - 0.25) < 1e-9);
  for (let i = 1; i < 8; i++) assert.ok(chunk[i] < chunk[i - 1]);
});

test('labels draw before satellites', () => {
  const { ctx, calls } = recordingCtx();
  const labels = {
    graticule: [{ text: '30°N', x: 10, y: 10, align: 'left', baseline: 'top', line: 'parallel' }],
    places: [
      { text: 'ATLANTIC', x: 100, y: 100, kind: 'region', align: 'center' },
      { text: 'Paris', x: 200, y: 100, kind: 'city', align: 'left' },
    ],
  };
  drawMap(ctx, { ...args(scene()), zoom: 1, labels });
  const order = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]).filter((t) => !t.startsWith('+'));
  assert.deepEqual(order.slice(0, 3), ['30°N', 'ATLANTIC', 'Paris']);
  assert.deepEqual(order.slice(3).sort(), ['GOES 16', 'ISS']);
});

test('place labels with a point draw where the current projection puts it', () => {
  const { ctx, calls } = recordingCtx();
  const a = args([]);
  const paris = [2.35, 48.86];
  const labels = { graticule: [], places: [{ text: 'Paris', x: 1, y: 1, kind: 'city', align: 'left', lonLat: paris }] };
  drawMap(ctx, { ...a, land: null, nightBands: [], observer: null, labels });
  const [x, y] = a.projection(paris);
  const dot = calls.find((c) => c.m === 'arc' && c.args[2] === 2.5);
  assert.ok(Math.abs(dot.args[0] - x) < 1e-9 && Math.abs(dot.args[1] - y) < 1e-9);
  const text = calls.find((c) => c.m === 'fillText' && c.args[0] === 'Paris');
  assert.ok(Math.abs(text.args[1] - (x + 5)) < 1e-9);
});

test('the graticule step changes with zoom', () => {
  const count = (zoom) => {
    const { ctx, calls } = recordingCtx();
    drawMap(ctx, { ...args([]), land: null, nightBands: [], observer: null, zoom });
    return calls.filter((c) => c.m === 'lineTo' || c.m === 'moveTo').length;
  };
  assert.ok(count(8) > count(1));
});

test('ticks are labelled +10m and +20m for the selected satellite only', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, args(scene()));
  const texts = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]);
  assert.ok(texts.includes('+10m') && texts.includes('+20m'));
  assert.ok(!texts.includes('+30m'));
  assert.ok(!texts.includes('+1h'));
});

// Emphasis: focus, normal, ghost and hidden.
function emphasisScene() {
  const [iss, goes] = scene();
  return { iss, goes };
}

test('a ghost is a 3 px dot at alpha 0.35 with no track or label', () => {
  const { iss, goes } = emphasisScene();
  const ghost = { ...goes, emphasis: 'ghost', selected: false, footprint: null };
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { ...args([ghost]), observer: null, land: null, nightBands: [] });
  const arcs = calls.filter((c) => c.m === 'arc');
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].args[2], 3);
  const fill = calls[calls.indexOf(arcs[0]) + 1];
  assert.equal(fill.m, 'fill');
  assert.equal(fill.fillStyle, goes.color);
  assert.equal(fill.globalAlpha, 0.35);
  assert.deepEqual(calls.filter((c) => c.m === 'fillText'), []);
  assert.ok(!strokes(calls).some((c) => c.strokeStyle === goes.color));
  void iss;
});

test('a hidden satellite is not drawn at all', () => {
  const { goes } = emphasisScene();
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { ...args([{ ...goes, emphasis: 'hidden' }]), observer: null, land: null, nightBands: [] });
  assert.equal(calls.filter((c) => c.m === 'arc').length, 0);
  assert.deepEqual(calls.filter((c) => c.m === 'fillText'), []);
  assert.ok(!strokes(calls).some((c) => c.strokeStyle === goes.color));
});

test('focus draws its footprint, labelled ticks and a dot 1 px larger; normal has no footprint', () => {
  const { iss, goes } = emphasisScene();
  const focus = { ...iss, emphasis: 'focus', selected: true };
  const normal = { ...goes, emphasis: 'normal', selected: false, footprint: footprintFeature(
    { lonDeg: goes.position.lonDeg, latDeg: goes.position.latDeg }, 35786, 0) };
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { ...args([normal, focus]), observer: null });
  const radii = calls.filter((c) => c.m === 'arc').map((c) => [c.fillStyle, c.args[2]]);
  assert.ok(calls.some((c) => c.m === 'fill' && c.globalAlpha === 0.18 && c.fillStyle === iss.color));
  assert.ok(!calls.some((c) => c.m === 'fill' && c.globalAlpha === 0.18 && c.fillStyle === goes.color));
  const texts = calls.filter((c) => c.m === 'fillText').map((c) => c.args[0]);
  assert.ok(texts.includes('+10m'));
  assert.ok(texts.includes('ISS') && texts.includes('GOES 16'));
  void radii;
  const dots = calls.filter((c) => c.m === 'arc' && c.args[2] >= 4).map((c) => c.args[2]);
  assert.deepEqual(dots.sort(), [4, 5]);
});

test('ghosts draw under normal and focus dots', () => {
  const { iss, goes } = emphasisScene();
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { ...args([{ ...iss, emphasis: 'focus' }, { ...goes, emphasis: 'ghost', footprint: null }]), observer: null });
  const radii = calls.filter((c) => c.m === 'arc').map((c) => c.args[2]);
  assert.deepEqual(radii, [3, 5]);
});

test('hitTest skips hidden satellites and finds ghosts', () => {
  const projection = makeProjection('equirectangular', { width: W, height: H });
  const [x, y] = projection([0, 0]);
  assert.equal(hitTest([{ noradId: 1, emphasis: 'hidden', position: { lonDeg: 0, latDeg: 0 } }], projection, x, y), null);
  assert.equal(hitTest([{ noradId: 2, emphasis: 'ghost', position: { lonDeg: 0, latDeg: 0 } }], projection, x, y), 2);
});

test('the light run fills the ocean light and uses no dark-palette colour', () => {
  const { ctx, calls } = recordingCtx();
  drawMap(ctx, { ...args(scene().map((s, i) => ({ ...s, color: SAT_PALETTES.light[i] }))), palette: MAP_PALETTES.light });
  const first = calls.find((c) => c.m === 'fill');
  assert.equal(first.fillStyle, '#dfe8f3');
  const dark = new Set([...Object.values(MAP_PALETTES.dark), ...SAT_PALETTES.dark]);
  for (const c of calls) {
    for (const v of [c.fillStyle, c.strokeStyle]) assert.ok(!dark.has(v), `dark colour ${v} used in the light run`);
  }
  assert.equal(SAT_PALETTES.light.length, 8);
  assert.equal(MAP_PALETTES.dark.ocean, MAP_COLORS.ocean);
});

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('every light satellite colour has 3:1 contrast on the light ocean', () => {
  for (const c of SAT_PALETTES.light) {
    assert.ok(ratio(c, MAP_PALETTES.light.ocean) >= 3, `${c} is ${ratio(c, MAP_PALETTES.light.ocean).toFixed(2)}`);
  }
});

test('light night shading is gentle and region text stays readable in the deepest band', () => {
  const p = MAP_PALETTES.light;
  assert.equal(p.night, 'rgba(20, 30, 60, 0.07)');
  assert.equal(p.regionText, 'rgba(27, 35, 51, 0.5)');
  // Composite 4 night bands, then text, over the ocean.
  const mix = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  let bg = [0xdf, 0xe8, 0xf3];
  for (let i = 0; i < 4; i++) bg = mix([20, 30, 60], 0.07, bg);
  const text = mix([27, 35, 51], 0.5, bg);
  const hex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  assert.ok(ratio(hex(text), hex(bg)) >= 2.5, `ratio ${ratio(hex(text), hex(bg)).toFixed(2)}`);
});
