import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPassChartPng } from '../lib/mcp/pass-chart.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const ENTRY = { noradId: 25544, name: 'ISS (ZARYA)', standardMag: -1.8 };
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 };
const NOW = Date.parse('2024-01-01T00:00:00Z');

test('renders a PNG + summary for an upcoming pass', async () => {
  const observer = { name: 'Equator', latDeg: 0, lonDeg: 0 };
  const res = await renderPassChartPng({ entry: ENTRY, record: REC, observer, mode: 'radio', nowMs: NOW });
  assert.ok(typeof res.pngBase64 === 'string' && res.pngBase64.length > 100, 'non-empty base64 png');
  assert.match(res.summary, /ISS/);
});

test('returns text-only when there is no pass (lat 85, incl 51.6)', async () => {
  const observer = { name: 'Arctic', latDeg: 85, lonDeg: 0 };
  const res = await renderPassChartPng({ entry: ENTRY, record: REC, observer, mode: 'radio', nowMs: NOW });
  assert.equal(res.pngBase64, undefined);
  assert.match(res.summary, /No upcoming/);
});

test('omits the magnitude from the summary when standardMag is unknown', async () => {
  const observer = { name: 'Sydney-ish', latDeg: -30, lonDeg: 150 };
  const known = await renderPassChartPng({ entry: ENTRY, record: REC, observer, mode: 'visual', nowMs: NOW });
  assert.match(known.summary, /mag/, 'fixture yields a visual pass with a magnitude');
  const entry = { noradId: 25485, name: '25485', shortName: null, standardMag: null };
  const res = await renderPassChartPng({ entry, record: REC, observer, mode: 'visual', nowMs: NOW });
  assert.ok(res.pngBase64);
  assert.doesNotMatch(res.summary, /mag/);
});

test('shades the chart arc only when the standard magnitude is known', async () => {
  const observer = { name: 'Sydney-ish', latDeg: -30, lonDeg: 150 };
  const chart = async (standardMag) => (await renderPassChartPng({
    entry: { noradId: 25544, name: 'ISS (ZARYA)', shortName: 'ISS', standardMag },
    record: REC, observer, mode: 'visual', nowMs: NOW,
  })).pngBase64;
  assert.notEqual(await chart(-1.8), await chart(null));
});

test('titles a synthesized satellite with the record name', async () => {
  const observer = { name: 'Equator', latDeg: 0, lonDeg: 0 };
  const entry = { noradId: 25485, name: '25485', shortName: null, standardMag: null };
  const res = await renderPassChartPng({ entry, record: { ...REC, noradId: 25485, name: 'SYNTH SAT' }, observer, mode: 'radio', nowMs: NOW });
  assert.match(res.summary, /^SYNTH SAT over Equator/);
});
