import test from 'node:test';
import assert from 'node:assert/strict';
import tzlookup from '@photostructure/tz-lookup';
import { zoneFrom, sameClock, zoneNote, shownInNote } from '../lib/time/zone.mjs';

const NOV = Date.UTC(2026, 10, 12, 18, 0);
const JUL = Date.UTC(2026, 6, 1, 18, 0);

test('a place gets its own zone', () => {
  assert.equal(zoneFrom(tzlookup, 35.68, 139.69, 'America/Chicago'), 'Asia/Tokyo');
  assert.equal(zoneFrom(tzlookup, 41.9, -87.6, 'UTC'), 'America/Chicago');
  assert.equal(zoneFrom(tzlookup, -33.9, 151.2, 'UTC'), 'Australia/Sydney');
});

test('no lookup, a bad place or an unknown answer falls back', () => {
  assert.equal(zoneFrom(null, 35.68, 139.69, 'America/Chicago'), 'America/Chicago');
  assert.equal(zoneFrom(tzlookup, NaN, 0, 'UTC'), 'UTC');
  assert.equal(zoneFrom(tzlookup, 95, 0, 'UTC'), 'UTC', 'the lookup throws');
  assert.equal(zoneFrom(() => 'Mars/Olympus', 0, 0, 'UTC'), 'UTC');
});

test('zones with the same clock agree, whatever their names', () => {
  assert.equal(sameClock('America/Chicago', 'America/Menominee', NOV), true);
  assert.equal(sameClock('America/Chicago', 'America/Denver', NOV), false);
  // Phoenix keeps standard time: with Denver in winter, not in summer.
  assert.equal(sameClock('America/Phoenix', 'America/Denver', NOV), true);
  assert.equal(sameClock('America/Phoenix', 'America/Denver', JUL), false);
});

test('a note only when the place keeps a different clock', () => {
  assert.equal(zoneNote('America/Chicago', 'America/Chicago', NOV), null);
  assert.equal(zoneNote('America/Menominee', 'America/Chicago', NOV), null);
  assert.equal(zoneNote('Asia/Tokyo', 'America/Chicago', NOV), 'Times are Tokyo time (UTC+9).');
  assert.equal(zoneNote('Asia/Kolkata', 'America/Chicago', NOV), 'Times are Kolkata time (UTC+5:30).');
  assert.equal(zoneNote('America/St_Johns', 'America/Chicago', NOV), "Times are St Johns time (UTC-3:30).");
  assert.equal(zoneNote('Europe/London', 'America/Chicago', NOV), 'Times are London time (UTC).');
  assert.equal(zoneNote('Etc/GMT-11', 'America/Chicago', NOV), 'Times are UTC+11.');
  assert.equal(zoneNote('Asia/Tokyo', undefined, NOV), null);
});

test('a place row names the clock its times are in, only when it differs', () => {
  assert.equal(shownInNote('America/Chicago', 'America/Chicago', NOV), null);
  assert.equal(shownInNote('America/Menominee', 'America/Chicago', NOV), null);
  assert.equal(shownInNote('Asia/Tokyo', 'America/Chicago', NOV), 'Times shown in Tokyo time (UTC+9)');
  assert.equal(shownInNote('America/St_Johns', 'America/Chicago', NOV), 'Times shown in St Johns time (UTC-3:30)');
  assert.equal(shownInNote('Etc/GMT-11', 'America/Chicago', NOV), 'Times shown in UTC+11');
  assert.equal(shownInNote('Asia/Tokyo', undefined, NOV), null);
  assert.equal(shownInNote('Mars/Olympus', 'America/Chicago', NOV), null);
});
