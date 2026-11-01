import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseElements, ElementsError } from '../lib/sat/elements.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { MOLNIYA_LINE2 } from './fixtures/orbits.mjs';

test('parses 2LE and 3LE, including CRLF, trailing spaces and a "0 " name line', () => {
  const r2 = parseElements(`${ISS_LINE1}\n${ISS_LINE2}`);
  assert.equal(r2.noradId, 25544);
  assert.equal(r2.name, '25544');
  assert.equal(r2.epochMs, Date.parse('2026-03-01T12:00:00Z'));
  assert.equal(r2.source, 'pasted');
  const r3 = parseElements(`0 ISS (ZARYA)  \r\n${ISS_LINE1}  \r\n${ISS_LINE2}\r\n`);
  assert.equal(r3.name, 'ISS (ZARYA)');
  assert.equal(r3.line1, ISS_LINE1);
});
test('rejects bad input with the exact copy', () => {
  const bad = ISS_LINE2.slice(0, 68) + String((Number(ISS_LINE2[68]) + 1) % 10);
  assert.throws(() => parseElements(`${ISS_LINE1}\n${bad}`), { message: 'Line 2 fails its checksum. Check for a copy or paste error.' });
  assert.throws(() => parseElements(''), { message: 'Paste two TLE lines, or three with a name line first.' });
  assert.throws(() => parseElements(`${ISS_LINE1}\n${MOLNIYA_LINE2}`), { message: 'The two lines are for different satellites.' });
  assert.throws(() => parseElements(`${ISS_LINE2}\n${ISS_LINE1}`), { message: 'Line 1 must start with "1 " and line 2 with "2 ".' });
  assert.throws(() => parseElements(`${ISS_LINE1.slice(0, 60)}\n${ISS_LINE2}`), { message: 'Each TLE line must be 69 characters long.' });
  assert.throws(() => parseElements('nonsense'), ElementsError);
});
