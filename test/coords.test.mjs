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
