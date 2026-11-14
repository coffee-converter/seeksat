import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSvgRoot, serialize } from '../lib/og/dom.mjs';
import { paintRadioChart } from '../lib/pass-finder/radio-chart.js';
import { paintPolarModalStatic } from '../lib/pass-finder/polar-modal-frame.js';
import { radioPassSamples } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';
import { buildGlobeCardSvg, globeCentre } from '../lib/og/globe-card.mjs';
import { buildSatCardSvg } from '../lib/og/sat-card.mjs';

const FACE = /@font-face\s*\{[^}]*font-family:\s*'Atkinson Hyperlegible Next'[^}]*data:font\/woff2;base64,/;

test('radio chart export embeds Atkinson Hyperlegible Next and uses it for text', () => {
  const E = geodeticToEcef(90, 0, 0);
  const T0 = Date.UTC(2026, 8, 7, 9, 25, 0);
  const stateAt = (d) => {
    const t = (d.getTime() - T0) / 1000;
    const p = [7500 * t, 0, E[2] + 739800];
    return { rTeme: [...p], vTeme: [7500, 0, 0], rEcef: [...p], gmst: 0 };
  };
  const series = radioPassSamples({ latDeg: 90, lonDeg: 0 }, { startMs: T0 - 182000, endMs: T0 + 182000 },
    { satStateAt: stateAt, obsEcef: E, upEcef: [0, 0, 1] }, { freqHz: 437.8e6, stepMs: 2000 });
  const svg = newSvgRoot('0 0 320 250');
  paintRadioChart(svg, series, { satelliteName: 'ISS', observerName: 'Home', tz: 'UTC', minElevDeg: 10 });
  const s = serialize(svg);
  assert.match(s, FACE);
  assert.match(s, /\.rc-label[^}]*font-family: 'Atkinson Hyperlegible Next'/);
  assert.doesNotMatch(s, /font-weight: 700/);
});

test('sky chart export embeds Atkinson Hyperlegible Next and uses it for text', () => {
  const svg = newSvgRoot('-24 -68 248 278');
  paintPolarModalStatic(svg, { name: 'Home', latDeg: 41.9, lonDeg: -87.6 }, Date.UTC(2026, 2, 1, 3), -30,
    { modalGeom: { cx: 100, cy: 100, R: 90 }, tzRefMs: Date.UTC(2026, 2, 1, 3) });
  const s = serialize(svg);
  assert.match(s, FACE);
  assert.match(s, /\.cardinal[^}]*font-family: 'Atkinson Hyperlegible Next'/);
  assert.doesNotMatch(s, /font-weight: 700/);
});

test('OG cards name Atkinson Hyperlegible Next for their text', () => {
  const site = buildGlobeCardSvg({ centre: globeCentre(0, 0), lines: ['Satellite passes over you'] });
  assert.match(site, /font-family="'Atkinson Hyperlegible Next'/);
  const sat = buildSatCardSvg({ name: 'ISS (ZARYA)', noradId: 25544, intlDesignator: '98067A', elements: null, ageText: '2 hours old' });
  assert.match(sat, /font-family="'Atkinson Hyperlegible Next'/);
  assert.doesNotMatch(site + sat, /Arimo/);
});
