import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polarModalFileNameFor } from '../lib/pass-finder/polar-png.js';

// svgToPngBlob is DOM-coupled (XMLSerializer + canvas + Image) so it
// only runs in a browser. Only the filename builder is testable here.

const ms = Date.UTC(2025, 5, 15, 22, 35, 41); // 2025-06-15 22:35:41 UTC

test('polarModalFileNameFor: untz observer → Z suffix (time formatted in runner-local tz)', () => {
  // Without an explicit obs.tz the function formats time in the runner's
  // local zone but tags the file with Z (since no real offset is known).
  // We only assert the structural shape; the local-time slug varies by
  // machine, so don't pin its digits.
  const fn = polarModalFileNameFor({ name: 'Chicago' }, ms);
  assert.match(fn, /^iss-pass-chicago-2025-06-\d{2}T\d{6}Z\.png$/);
});

test('polarModalFileNameFor: with IANA tz formats local date+time + offset', () => {
  // America/Chicago in mid-June is UTC-5 (CDT). 22:35:41 UTC → 17:35:41 CDT.
  const fn = polarModalFileNameFor(
    { name: 'Chicago', tz: 'America/Chicago' }, ms,
  );
  assert.equal(fn, 'iss-pass-chicago-2025-06-15T173541-0500.png');
});

test('polarModalFileNameFor: positive-offset tz drops the +', () => {
  // Asia/Tokyo is UTC+9. 22:35:41 UTC → 07:35:41 JST next day.
  const fn = polarModalFileNameFor(
    { name: 'Tokyo', tz: 'Asia/Tokyo' }, ms,
  );
  // Offset tag becomes "+0900" - the replace strips "GMT" + ":".
  assert.equal(fn, 'iss-pass-tokyo-2025-06-16T073541+0900.png');
});

test('polarModalFileNameFor: half-hour offset tz preserves minutes', () => {
  // Asia/Kolkata is UTC+5:30. 22:35:41 UTC → 04:05:41 IST next day.
  const fn = polarModalFileNameFor(
    { name: 'Mumbai', tz: 'Asia/Kolkata' }, ms,
  );
  assert.equal(fn, 'iss-pass-mumbai-2025-06-16T040541+0530.png');
});

test('polarModalFileNameFor: observer name slugified (lowercase, hyphens)', () => {
  const fn = polarModalFileNameFor({ name: 'My Backyard 2!' }, ms);
  assert.ok(fn.startsWith('iss-pass-my-backyard-2-'), fn);
});

test('polarModalFileNameFor: leading/trailing punctuation in name is stripped', () => {
  const fn = polarModalFileNameFor({ name: '...zenith?' }, ms);
  assert.ok(fn.startsWith('iss-pass-zenith-'), fn);
});

test('polarModalFileNameFor: missing obs name falls back to "observer"', () => {
  const fn = polarModalFileNameFor({}, ms);
  assert.ok(fn.startsWith('iss-pass-observer-'), fn);
});

test('polarModalFileNameFor: null obs returns observer-prefixed name', () => {
  const fn = polarModalFileNameFor(null, ms);
  assert.ok(fn.startsWith('iss-pass-observer-'), fn);
});

test('polarModalFileNameFor: invalid tz falls back to Z (no throw)', () => {
  const fn = polarModalFileNameFor({ name: 'X', tz: 'Not/A_Real_Zone' }, ms);
  // The tz lookup is wrapped in try/catch - offsetSlug stays "Z" and
  // the timezone-formatted date may use the runtime's local zone OR
  // throw inside Intl.DateTimeFormat earlier. We just check the file
  // ends with .png and starts with iss-pass-x-.
  assert.ok(fn.startsWith('iss-pass-x-'), fn);
  assert.ok(fn.endsWith('.png'), fn);
});

test('polarModalFileNameFor: filename is Windows-safe (no colons)', () => {
  const fn = polarModalFileNameFor(
    { name: 'Chicago', tz: 'America/Chicago' }, ms,
  );
  assert.ok(!fn.includes(':'), `filename contains colon: ${fn}`);
});
