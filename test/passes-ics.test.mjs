import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passToIcs, icsFileName } from '../lib/passes/ics.mjs';

const PASS = { startMs: Date.parse('2026-03-01T13:16:05.400Z'), endMs: Date.parse('2026-03-01T13:21:23.400Z'),
  peakMs: Date.parse('2026-03-01T13:18:45.400Z'), maxElevDeg: 34.6, startAzDeg: 204.4, endAzDeg: 75.2 };
const BASE = { satName: 'ISS', noradId: 25544, observer: { name: 'EN52ve', latDeg: 42.1875, lonDeg: -88.2083 },
  pass: PASS, mode: 'radio', nowMs: Date.parse('2026-03-01T12:00:00Z') };
test('full output for one pass', () => {
  assert.equal(passToIcs(BASE),
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SeekSat//Passes//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n' +
    'BEGIN:VEVENT\r\nUID:25544-1772370965400-en52ve@seeksat.app\r\nDTSTAMP:20260301T120000Z\r\n' +
    'DTSTART:20260301T131605Z\r\nDTEND:20260301T132123Z\r\nSUMMARY:ISS pass\\, max 35°\r\nLOCATION:EN52ve\r\n' +
    'GEO:42.1875;-88.2083\r\nDESCRIPTION:Radio pass. Rises at azimuth 204°\\, peaks at 35° at 13:18:45 \r\n' +
    ' UTC\\, sets at azimuth 75°.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
});
test('commas and semicolons in names are escaped', () => {
  const ics = passToIcs({ ...BASE, observer: { ...BASE.observer, name: 'Elgin, IL; home' } });
  assert.ok(ics.includes('LOCATION:Elgin\\, IL\\; home'));
});
test('long lines fold at 75 octets without splitting characters', () => {
  const ics = passToIcs({ ...BASE, satName: 'Ä'.repeat(200) });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(ics.replace(/\r\n /g, '').includes(`SUMMARY:${'Ä'.repeat(200)} pass\\, max 35°`));
  assert.ok(!/[^\r]\n/.test(ics));
});
test('a URL line appears only when given', () => {
  assert.ok(!passToIcs(BASE).includes('URL:'));
  assert.ok(passToIcs({ ...BASE, url: 'https://seeksat.app/?s=x' }).includes('\r\nURL:https://seeksat.app/?s=x\r\n'));
});
test('icsFileName', () => {
  assert.equal(icsFileName('ISS', 'EN52ve', Date.parse('2026-03-01T13:16:05Z')), 'iss-pass-en52ve-20260301T1316Z.ics');
});

const descOf = (extra) => passToIcs({ ...BASE, ...extra }).replace(/\r\n /g, '').match(/DESCRIPTION:(.*)\r\n/)[1];
test('joint pass description names the observer count and peak', () => {
  assert.equal(descOf({ observerCount: 3 }),
    'Joint radio pass for 3 observers. All see it above 35° at the peak\\, 13:18:45 UTC. '
    + 'Azimuths for EN52ve: 204° at the start\\, 75° at the end.');
});
test('in-progress description does not claim a rise', () => {
  assert.equal(descOf({ inProgress: true }),
    'Radio pass\\, already in progress. Peaks at 35° at 13:18:45 UTC\\, ends at azimuth 75°.');
});
test('visual description says appears and disappears', () => {
  assert.equal(descOf({ mode: 'visual' }),
    'Visual pass. Appears at azimuth 204°\\, peaks at 35° at 13:18:45 UTC\\, disappears at azimuth 75°.');
});
test('joint takes precedence over in-progress and visual', () => {
  assert.match(descOf({ observerCount: 2, inProgress: true, mode: 'visual' }), /^Joint visual pass for 2 observers\./);
});

test('the link is also the last DESCRIPTION line', () => {
  const d = descOf({ url: 'https://seeksat.app/?s=x,y' });
  assert.ok(d.endsWith('\\nDetails: https://seeksat.app/?s=x\\,y'));
  assert.ok(!descOf({}).includes('Details:'));
});
