// lib/sat/next-pass-tile.mjs - the satellite page's "Next pass" tile text.
import { countdown } from '../home/next-up.mjs';
import { DEFAULT_SEARCH_DAYS } from '../passes/engine.mjs';

export const FINDING = 'Finding passes...';

/**
 * next: PassSection's report. undefined while searching, else
 * { kind: 'pass', pass } | { kind: 'none' } | { kind: 'stationary', visible }
 * | { kind: 'failed' } | { kind: 'unavailable' }.
 * Returns { value, note? }. The note says what was searched.
 */
export function nextPassTile(next, { nowMs, located, hydrated, mode, minElevDeg }) {
  if (next?.kind === 'unavailable') return { value: "No passes: elements can't be used" };
  if (!located) return hydrated ? { value: 'Set your location', note: 'to list passes below' } : { value: FINDING };
  if (next === undefined) return { value: FINDING };
  const searched = mode === 'visual' ? 'visible passes only' : `passes above ${minElevDeg}°`;
  switch (next.kind) {
    case 'failed': return { value: 'Search failed' };
    case 'stationary': return { value: next.visible ? 'Fixed in your sky' : 'Never rises here' };
    case 'none': return {
      value: `none in the next ${DEFAULT_SEARCH_DAYS} days`,
      note: mode === 'visual' ? 'visible passes only' : `radio passes above ${minElevDeg}°`,
    };
    case 'pass': {
      const { pass } = next;
      const note = typeof pass.maxElevDeg === 'number'
        ? `max ${Math.round(pass.maxElevDeg)}° up, ${searched}`
        : searched;
      if (nowMs < pass.startMs) return { value: `in ${countdown(pass.startMs - nowMs)}`, note };
      if (nowMs < pass.endMs) return { value: `up now, ${countdown(pass.endMs - nowMs)} left`, note };
      return { value: FINDING };
    }
    default: return { value: FINDING };
  }
}
