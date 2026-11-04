// lib/sat/elements.mjs - parse pasted 2LE/3LE text into a SatRecord.
// Error messages are user-facing copy.

import * as sat from 'satellite.js';
import { epochMsFromSatrec } from './track.mjs';

export class ElementsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ElementsError';
  }
}

function checksumOk(line) {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line[i];
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

export function parseElements(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 2 && lines.length !== 3) {
    throw new ElementsError('Paste two TLE lines, or three with a name line first.');
  }
  const name = lines.length === 3 ? lines[0].replace(/^0 /, '').trim() : '';
  const [line1, line2] = lines.slice(-2);
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw new ElementsError('Line 1 must start with "1 " and line 2 with "2 ".');
  }
  if (line1.length !== 69 || line2.length !== 69) {
    throw new ElementsError('Each TLE line must be 69 characters long.');
  }
  [line1, line2].forEach((line, i) => {
    if (!checksumOk(line)) {
      throw new ElementsError(`Line ${i + 1} fails its checksum. Check for a copy or paste error.`);
    }
  });
  const cat1 = line1.slice(2, 7);
  const cat2 = line2.slice(2, 7);
  if (cat1 !== cat2) throw new ElementsError('The two lines are for different satellites.');
  if (!/^\d{5}$/.test(cat1)) {
    throw new ElementsError('Catalog numbers with letters (Alpha-5) are not supported yet.');
  }
  const noradId = Number(cat1);
  const satrec = sat.twoline2satrec(line1, line2);
  if (satrec.error) throw new ElementsError('These elements could not be read.');
  return {
    noradId,
    name: name || String(noradId),
    line1,
    line2,
    epochMs: epochMsFromSatrec(satrec),
    source: 'pasted',
    fetchedAtMs: null,
    groups: [],
  };
}
