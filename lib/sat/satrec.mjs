// lib/sat/satrec.mjs - the single place a server-side record becomes a satrec.
// OMM wins when present (works for 6-digit NORAD IDs); TLE lines are the fallback.

import * as sat from 'satellite.js';

export function satrecFromRecord(record) {
  if (record && record.omm) return sat.json2satrec(record.omm);
  if (record && record.line1 && record.line2) {
    return sat.twoline2satrec(record.line1.trim(), record.line2.trim());
  }
  throw new Error('record has neither OMM nor TLE lines');
}
