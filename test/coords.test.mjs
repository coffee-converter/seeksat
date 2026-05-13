import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDmsToDecimal,
  parseRaToHours,
  parseDecToDegrees,
} from '../coords.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('parseDmsToDecimal: pure decimal passes through', () => {
  assert.ok(close(parseDmsToDecimal('42.1544'), 42.1544));
  assert.ok(close(parseDmsToDecimal('-88.2'), -88.2));
});

test('parseDmsToDecimal: coffee lat with N hemisphere', () => {
  // 42°09'15.9"N = 42 + 9/60 + 15.9/3600
  const v = parseDmsToDecimal(`42°09'15.9"N`);
  assert.ok(close(v, 42.154417, 1e-5), `got ${v}`);
});

test('parseDmsToDecimal: coffee lon with W hemisphere is negative', () => {
  const v = parseDmsToDecimal(`88°11'59.9"W`);
  assert.ok(close(v, -88.199972, 1e-5), `got ${v}`);
});

test('parseDmsToDecimal: smart quotes work', () => {
  const v = parseDmsToDecimal(`43°05′33.6″N`);
  assert.ok(close(v, 43.092667, 1e-5), `got ${v}`);
});

test('parseRaToHours: HMS string', () => {
  // 5h 30m 52.4110s = 5 + 30/60 + 52.411/3600 = 5.51455861...
  const v = parseRaToHours('5h 30m 52.4110s');
  assert.ok(close(v, 5.5145586, 1e-6), `got ${v}`);
});

test('parseRaToHours: space-separated', () => {
  const v = parseRaToHours('5 48 47.7690');
  assert.ok(close(v, 5.8132692, 1e-6), `got ${v}`);
});

test('parseDecToDegrees: degrees minutes seconds', () => {
  // 41° 51' 10.0489" = 41 + 51/60 + 10.0489/3600
  const v = parseDecToDegrees(`41° 51' 10.0489"`);
  assert.ok(close(v, 41.852791, 1e-5), `got ${v}`);
});

test('parseDecToDegrees: negative declination', () => {
  const v = parseDecToDegrees(`-12 30 45`);
  assert.ok(close(v, -12.5125, 1e-5), `got ${v}`);
});

test('parseDmsToDecimal: minutes >= 60 throws', () => {
  assert.throws(() => parseDmsToDecimal(`42°75'0"N`), /out of range/);
});

test('parseDmsToDecimal: seconds >= 60 throws', () => {
  assert.throws(() => parseDmsToDecimal(`42°09'60.0"N`), /out of range/);
});

test('parseDmsToDecimal: negative degrees + S/W hemisphere throws', () => {
  assert.throws(() => parseDmsToDecimal(`-42°09'15.9"S`), /ambiguous sign/);
});

import {
  raDecToEciDir,
  altAzToEnuDir,
  geodeticToEcef,
  gmstFromDate,
  eciToEcefRotate,
  enuToEcefRotate,
} from '../coords.js';

test('raDecToEciDir: RA=0 Dec=0 points at +X', () => {
  const v = raDecToEciDir(0, 0);
  assert.ok(close(v[0], 1) && close(v[1], 0) && close(v[2], 0));
});

test('raDecToEciDir: Dec=90 points at +Z', () => {
  const v = raDecToEciDir(12, 90);
  assert.ok(close(v[2], 1, 1e-9) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('raDecToEciDir: RA=6h Dec=0 points at +Y', () => {
  const v = raDecToEciDir(6, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0));
});

test('altAzToEnuDir: alt=90 points straight up', () => {
  const v = altAzToEnuDir(90, 0);
  assert.ok(close(v[2], 1) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('altAzToEnuDir: alt=0 az=90 points east', () => {
  const v = altAzToEnuDir(0, 90);
  assert.ok(close(v[0], 1) && close(v[1], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('altAzToEnuDir: alt=0 az=0 points north', () => {
  const v = altAzToEnuDir(0, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('geodeticToEcef: equator prime meridian sea level ~= (a, 0, 0)', () => {
  const [x, y, z] = geodeticToEcef(0, 0, 0);
  assert.ok(close(x, 6378137, 1), `x=${x}`);
  assert.ok(close(y, 0, 1) && close(z, 0, 1));
});

test('geodeticToEcef: north pole ~= (0, 0, b)', () => {
  const [x, y, z] = geodeticToEcef(90, 0, 0);
  // Polar radius b = a(1-f) = 6356752.3142
  assert.ok(close(x, 0, 1) && close(y, 0, 1));
  assert.ok(close(z, 6356752.3142, 1), `z=${z}`);
});

test('enuToEcefRotate: up at (0,0) points along +X', () => {
  const v = enuToEcefRotate([0, 0, 1], 0, 0);
  assert.ok(close(v[0], 1) && close(v[1], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('enuToEcefRotate: up at north pole points +Z', () => {
  const v = enuToEcefRotate([0, 0, 1], 90, 0);
  assert.ok(close(v[2], 1) && close(v[0], 0, 1e-9) && close(v[1], 0, 1e-9));
});

test('enuToEcefRotate: east at (0,0) points +Y', () => {
  const v = enuToEcefRotate([1, 0, 0], 0, 0);
  assert.ok(close(v[1], 1) && close(v[0], 0, 1e-9) && close(v[2], 0, 1e-9));
});

test('gmstFromDate: J2000 epoch GMST ~= 18.697374558 hours', () => {
  // 2000-01-01 12:00 UTC
  const g = gmstFromDate(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)));
  const hours = (g / (2 * Math.PI)) * 24;
  assert.ok(close(hours, 18.697374558, 1e-3), `got ${hours} hours`);
});

test('eciToEcefRotate: zero GMST is identity', () => {
  const v = eciToEcefRotate([1, 2, 3], 0);
  assert.ok(close(v[0], 1) && close(v[1], 2) && close(v[2], 3));
});

test('eciToEcefRotate: GMST=pi/2 rotates +X to -Y', () => {
  const v = eciToEcefRotate([1, 0, 0], Math.PI / 2);
  assert.ok(close(v[0], 0, 1e-9));
  assert.ok(close(v[1], -1, 1e-9), `y=${v[1]}`);
});
