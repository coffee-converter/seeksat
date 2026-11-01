// test/fixtures/tle-variants.mjs - valid-checksum TLE pairs for arbitrary 5-digit ids.
import { MOLNIYA_LINE1, MOLNIYA_LINE2 } from './orbits.mjs';

function withId(line, id) {
  const body = line.slice(0, 2) + String(id).padStart(5, '0') + line.slice(7, 68);
  let sum = 0;
  for (const ch of body) sum += ch >= '0' && ch <= '9' ? Number(ch) : ch === '-' ? 1 : 0;
  return body + (sum % 10);
}

export function tleFor(id) {
  return { noradId: id, line1: withId(MOLNIYA_LINE1, id), line2: withId(MOLNIYA_LINE2, id) };
}
