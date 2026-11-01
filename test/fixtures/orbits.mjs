// test/fixtures/orbits.mjs - frozen non-LEO element sets and a test observer.
// Checksums are valid; no network needed.
export const MOLNIYA_LINE1 = '1 25485U 98054A   23178.12725359  .00000103  00000+0  00000+0 0  9997';
export const MOLNIYA_LINE2 = '2 25485  63.3372  91.8251 6791666 291.6975  11.8681  2.36444410187230';
export const GOES16_LINE1 = '1 41866U 16071A   26304.59625927 -.00000095  00000+0  00000+0 0  9993';
export const GOES16_LINE2 = '2 41866   0.6755  83.6414 0002750 164.7985 261.4686  1.00271572 36478';

export const EN52VE = { id: 'en52ve', name: 'EN52ve', latDeg: 42.1875, lonDeg: -88.2083 };

/** A SatRecord-shaped object (the mirror's shape) built from TLE lines. */
export function recordFrom(line1, line2, name) {
  return {
    noradId: Number(line1.slice(2, 7)),
    name,
    line1,
    line2,
    epochMs: null,
    source: 'fixture',
    fetchedAtMs: null,
    groups: [],
  };
}
