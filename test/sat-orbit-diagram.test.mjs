import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { orbitDiagram } from '../lib/sat/orbit-diagram.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE1, MOLNIYA_LINE2, GOES16_LINE1, GOES16_LINE2, recordFrom } from './fixtures/orbits.mjs';

const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const ISS_T0 = Date.parse('2026-03-01T12:00:00Z');
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const molniya = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));

test('Molniya: the dot sits at perigee when the mean anomaly is zero, at apogee half a period later', () => {
  const m = makeTrack(recordFrom(MOLNIYA_LINE1, MOLNIYA_LINE2, 'M'));
  const atPerigee = m.epochMs + ((2 * Math.PI - m.satrec.mo) / m.satrec.no) * 60_000;
  const d0 = orbitDiagram(m, atPerigee);
  assert.ok(Math.hypot(d0.dot.x - d0.perigee.x, d0.dot.y - d0.perigee.y) < 1);
  const d1 = orbitDiagram(m, atPerigee + m.periodMs / 2);
  assert.ok(Math.hypot(d1.dot.x - d1.apogee.x, d1.dot.y - d1.apogee.y) < 1);
});
test('ISS: a near circle hugging Earth', () => {
  const d = orbitDiagram(iss, ISS_T0);
  assert.ok(Math.abs(d.ellipse.rx - d.ellipse.ry) / d.ellipse.rx < 0.001);
  assert.ok(d.earth.r / d.ellipse.rx > 0.9);
});
test('every orbit class fits its box', () => {
  for (const t of [iss, goes, molniya]) {
    const d = orbitDiagram(t, Date.now(), { size: 240, pad: 16 });
    const { cx, cy, rx, ry } = d.ellipse;
    assert.ok(cx - rx >= 15.9 && cx + rx <= 224.1 && cy - ry >= 15.9 && cy + ry <= 224.1);
    assert.ok(d.earth.cx - d.earth.r >= 15.9 && d.earth.cx + d.earth.r <= 224.1);
  }
});
test('motion is counterclockwise on screen (y flipped)', () => {
  const t0 = molniya.epochMs;
  const a = orbitDiagram(molniya, t0), b = orbitDiagram(molniya, t0 + 60_000);
  // cross product of (pos - earth) changes sign positive in math coords => negative in SVG coords
  const ax = a.dot.x - a.earth.cx, ay = a.dot.y - a.earth.cy;
  const bx = b.dot.x - a.earth.cx, by = b.dot.y - a.earth.cy;
  assert.ok(ax * by - ay * bx < 0);
});
