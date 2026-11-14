// lib/mcp/reception.mjs - SatNOGS reception for the MCP tools: the tally
// index from deps (never a throw: no data reads as before), a satellite's
// recency class, and the attribution line responses carry.
import { receptionFor, RECENCY } from '../reception/tally.mjs';

export const RECEPTION_SOURCE = 'SatNOGS Network observations (network.satnogs.org), CC BY-SA 4.0. Counts are observations, so two stations hearing one pass count twice.';

/** The reception index (lib/reception/tally.mjs indexTally), or null when
 *  there is none or it cannot be read. */
export async function receptionIndex(deps) {
  if (typeof deps?.reception !== 'function') return null;
  try {
    const ix = await deps.reception();
    return ix?.tally ? ix : null;
  } catch {
    return null;
  }
}

/** The best (lowest) recency class among a satellite's downlinks, and the
 *  reception it comes from; RECENCY.UNKNOWN and null without data. */
export function satRecency(index, noradId, downlinks, nowMs) {
  if (!index) return { recency: RECENCY.UNKNOWN, reception: null };
  let best = null;
  for (const d of downlinks ?? []) {
    const r = receptionFor(index, noradId, d, nowMs);
    if (!best || r.recency < best.recency) best = r;
  }
  return best ? { recency: best.recency, reception: best } : { recency: RECENCY.UNKNOWN, reception: null };
}

/** A reception as a row shows it (no internal rank). */
export function receptionView(r) {
  if (!r) return null;
  const { recency, ...view } = r;
  return view;
}
