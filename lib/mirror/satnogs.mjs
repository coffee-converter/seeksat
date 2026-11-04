// lib/mirror/satnogs.mjs - downlink frequencies from SatNOGS DB.
//
// SatNOGS DB (https://db.satnogs.org, data CC BY-SA 4.0) lists radio
// transmitters per NORAD id. The refresh fetches the whole list once a day
// (one ~4 MB request) and keeps, per satellite, the active downlinks in the
// shape lib/catalog.mjs uses. Curated catalog downlinks win where they exist
// (lib/catalog.mjs downlinksFor).
import { SITE_URL } from '../site.mjs';

export const SATNOGS_TRANSMITTERS_URL = 'https://db.satnogs.org/api/transmitters/?format=json';
export const SATNOGS_URL = 'https://db.satnogs.org';
/** How often the refresh asks SatNOGS again. */
export const DOWNLINKS_REFETCH_MS = 24 * 3_600_000;
const TIMEOUT_MS = 60_000;
const MAX_PER_SATELLITE = 12;
const MIN_HZ = 1_000_000;
const MAX_HZ = 300_000_000_000;

/** The transmitter list, or a throw (non-2xx, not a list, timeout). */
export async function fetchTransmitters({ fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`SatNOGS fetch aborted after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await fetchImpl(SATNOGS_TRANSMITTERS_URL, {
      signal: ac.signal,
      headers: { 'User-Agent': `seeksat/1.0 (${SITE_URL})`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`SatNOGS transmitters: HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('SatNOGS transmitters: not a list');
    return list;
  } finally {
    clearTimeout(timer);
  }
}

const isHz = (v) => Number.isFinite(v) && v >= MIN_HZ && v <= MAX_HZ;

/** One transmitter as a downlink, or null when it is not a usable one. */
function downlinkOf(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.status !== 'active' || t.alive !== true || t.unconfirmed === true) return null;
  if (!Number.isInteger(t.norad_cat_id) || t.norad_cat_id <= 0) return null;
  const low = Number(t.downlink_low);
  if (!isHz(low)) return null;
  const high = Number(t.downlink_high);
  const band = isHz(high) && high > low;
  const mode = typeof t.mode === 'string' && t.mode.trim() ? t.mode.trim() : null;
  let label = typeof t.description === 'string' ? t.description.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!label) label = mode ? `${mode} downlink` : 'Downlink';
  return {
    noradId: t.norad_cat_id,
    // A passband (a linear transponder) is listed at its centre.
    hz: band ? Math.round((low + high) / 2) : Math.round(low),
    label: band ? `${label} (passband centre)` : label,
    mode: mode ? mode.toLowerCase() : null,
    amateur: t.service === 'Amateur',
  };
}

// Amateur first, then VHF/UHF (what most listeners can hear), then by frequency.
const rank = (d) => [d.amateur ? 0 : 1, d.hz >= 30e6 && d.hz < 3e9 ? 0 : 1, d.hz];
function compare(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return 0;
}

/** SatNOGS transmitters as { [noradId]: Downlink[] }: active downlinks only,
 *  one per frequency and mode, at most MAX_PER_SATELLITE, the first marked default. */
export function downlinksFromTransmitters(list) {
  if (!Array.isArray(list)) return {};
  const bySat = new Map();
  for (const t of list) {
    const d = downlinkOf(t);
    if (!d) continue;
    const sat = bySat.get(d.noradId) ?? [];
    if (!sat.some((x) => x.hz === d.hz && x.mode === d.mode)) sat.push(d);
    bySat.set(d.noradId, sat);
  }
  const out = {};
  for (const [id, sat] of bySat) {
    out[String(id)] = sat.sort(compare).slice(0, MAX_PER_SATELLITE).map((d, i) => ({
      hz: d.hz,
      label: d.label,
      mode: d.mode,
      source: 'satnogs',
      ...(i === 0 && { default: true }),
    }));
  }
  return out;
}
