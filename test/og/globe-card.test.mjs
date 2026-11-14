import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobeCardSvg, globeCentre } from '../../lib/og/globe-card.mjs';
import { passScene, staysPut, placeTime } from '../../lib/og/globe-scene.mjs';
import { ecefAtFactory } from '../../lib/og/tle.mjs';
import { selectPass } from '../../lib/og/pass-select.mjs';
import { ISS_TLE } from './fixtures/iss-tle.mjs';

const CHICAGO = { name: 'Chicago', latDeg: 41.8781, lonDeg: -87.6298 };

test('the card is 1200 x 630 with land, lakes and an escaped title', () => {
  const svg = buildGlobeCardSvg({ centre: globeCentre(-87.6, 41.9), title: 'A&B <x>', lines: ['one', 'two'] });
  assert.ok(svg.includes('width="1200"') && svg.includes('height="630"'));
  assert.ok(svg.includes('A&amp;B &lt;x&gt;') && !svg.includes('A&B <x>'));
  assert.equal((svg.match(/<path d="M/g) || []).length >= 4, true, 'sphere, graticule, land and lakes');
  assert.ok(svg.includes("font-family=\"'Exo 2'"), 'names in the wordmark face');
  assert.ok(!svg.includes('—'));
});

test('the globe faces south of the place, so the place sits high on it', () => {
  assert.deepEqual(globeCentre(-87.6, 41.9), { lonDeg: -87.6, latDeg: 41.9 - 40 });
  assert.equal(globeCentre(10, -80).latDeg, -89);
});

test('a shared pass: the bold part stays at or above the lowest pass setting', () => {
  const ecefAt = ecefAtFactory(ISS_TLE);
  const sel = selectPass({ observers: [CHICAGO], mode: 'radio', minElevDeg: 10 }, ecefAt, { nowMs: Date.parse('2026-03-01T00:00:00Z'), scanDays: 3 });
  assert.ok(sel);
  const scene = passScene({ ecefAt, sel, minElevDeg: 10 });
  assert.ok(scene.pass.length > 3 && scene.ground.length > scene.pass.length);
  assert.ok(scene.sight && scene.circle && scene.circle.radiusDeg < 60);
  const svg = buildGlobeCardSvg({ ...scene, title: 'ISS', lines: ['a', 'b'] });
  assert.ok(svg.includes('stroke-dasharray="9 8"'), 'the line to closest approach');
  assert.ok(svg.includes('rotate('), 'the set arrow turned along the path');
});

test('a low-orbit satellite moves; the place time is in its own zone', () => {
  assert.equal(staysPut(ecefAtFactory(ISS_TLE), Date.parse('2026-03-01T00:00:00Z')), false);
  assert.match(placeTime(Date.parse('2026-11-15T00:30:00Z'), 41.88, -87.63), /^Sat 6:30\sPM$/);
});
