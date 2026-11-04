// lib/radio/bands.mjs - the bands a listener's radio covers, and which of a
// satellite's downlinks fall in them. Pure; shared by client and server.

/** The bands offered, in frequency order. Anything outside them is 'other'. */
export const BANDS = Object.freeze([
  { id: 'hf', label: 'HF', lo: 3e6, hi: 30e6 },
  { id: 'wx', label: '137 MHz', lo: 136e6, hi: 138e6 },
  { id: '2m', label: '2 m', lo: 144e6, hi: 148e6 },
  { id: '70cm', label: '70 cm', lo: 420e6, hi: 450e6 },
  { id: 'l', label: 'L band', lo: 1e9, hi: 2e9 },
  { id: 's', label: 'S band', lo: 2e9, hi: 4e9 },
  { id: 'other', label: 'Other', lo: null, hi: null },
]);
export const BAND_IDS = Object.freeze(BANDS.map((b) => b.id));

/** The band a frequency (Hz) is in. */
export function bandOf(hz) {
  for (const b of BANDS) if (b.lo != null && hz >= b.lo && hz < b.hi) return b.id;
  return 'other';
}

/** A saved bands pref as a list of known ids, or null for every band. */
export function parseBands(v) {
  if (!Array.isArray(v)) return null;
  const ids = BAND_IDS.filter((id) => v.includes(id));
  return ids.length === BAND_IDS.length ? null : ids;
}

/** The downlinks in the bands (null: all), with the default kept when it is
 *  among them, else moved to the first that is. */
export function inBands(downlinks, bands) {
  const list = Array.isArray(downlinks) ? downlinks : [];
  if (bands == null) return list;
  const kept = list.filter((d) => bands.includes(bandOf(d.hz)));
  if (kept.length === 0 || kept.some((d) => d.default)) return kept;
  return kept.map((d, i) => (i === 0 ? { ...d, default: true } : d));
}

/** The distinct bands of some downlinks, in BANDS order. */
export function bandsOf(downlinks) {
  const seen = new Set((Array.isArray(downlinks) ? downlinks : []).map((d) => bandOf(d.hz)));
  return BAND_IDS.filter((id) => seen.has(id));
}
