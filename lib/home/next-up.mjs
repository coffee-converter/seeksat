// lib/home/next-up.mjs - turn followed satellites into ordered "Next up" cards.
import { findPasses } from '../passes/engine.mjs';

export const NEXT_UP_HOURS = 48;

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Card for one followed satellite, from its first pass in the next 48 h. */
function cardFor(track, observer, mode, minElevDeg, nowMs) {
  const base = { noradId: track.noradId, name: track.shortName };
  const r = findPasses({
    track,
    observers: [{ id: 'home', ...observer }],
    mode,
    minElevDeg,
    startMs: nowMs,
    endMs: nowMs + NEXT_UP_HOURS * HOUR,
  });
  if (r.kind === 'unavailable') return { kind: 'unavailable', ...base };
  if (r.kind === 'stationary') {
    return { kind: 'stationary', ...base, pointing: r.pointing[0], visible: r.visible };
  }
  // The mode rides on the card so its headline says what was searched for.
  if (r.passes.length === 0) return { kind: 'none', ...base, mode };
  return { kind: 'pass', ...base, pass: r.passes[0] };
}

/**
 * One card per followed id, ordered: in-progress passes, upcoming passes by
 * start, stationary-visible, none, stationary-not-visible, unavailable, missing.
 */
export function nextUp({ tracks, missing, observer, mode, minElevDeg, nowMs }) {
  const cards = [];
  for (const track of tracks.values()) cards.push(cardFor(track, observer, mode, minElevDeg, nowMs));
  const seen = new Set(tracks.keys());
  for (const id of missing) {
    if (seen.has(id)) continue;
    seen.add(id);
    cards.push({ kind: 'missing', noradId: id, name: String(id) });
  }

  const rank = (c) => {
    switch (c.kind) {
      case 'pass': return c.pass.inProgress ? 0 : 1;
      case 'stationary': return c.visible ? 2 : 4;
      case 'none': return 3;
      case 'unavailable': return 5;
      default: return 6;
    }
  };
  // Array.sort is stable, so ties keep input order.
  return cards.sort((a, b) => rank(a) - rank(b) || (a.pass && b.pass ? a.pass.startMs - b.pass.startMs : 0));
}

/** "42 min", "2 h 5 min", "1 day 3 h". */
export function countdown(ms) {
  if (ms < MINUTE) return 'under a minute';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < 24 * HOUR) {
    const min = Math.floor((ms % HOUR) / MINUTE);
    return min ? `${Math.floor(ms / HOUR)} h ${min} min` : `${Math.floor(ms / HOUR)} h`;
  }
  const days = Math.floor(ms / (24 * HOUR));
  const hours = Math.floor((ms % (24 * HOUR)) / HOUR);
  const dayPart = `${days} ${days === 1 ? 'day' : 'days'}`;
  return hours ? `${dayPart} ${hours} h` : dayPart;
}

export function cardHeadline(card, nowMs) {
  const { name } = card;
  switch (card.kind) {
    case 'pass': {
      const max = Math.round(card.pass.maxElevDeg);
      return card.pass.inProgress
        ? `${name} now, max ${max}°`
        : `${name} in ${countdown(card.pass.startMs - nowMs)}, max ${max}°`;
    }
    case 'stationary':
      return card.visible
        ? `${name} fixed at azimuth ${Math.round(card.pointing.azDeg)}°, ${Math.round(card.pointing.elDeg)}° up`
        : `${name} never rises here`;
    case 'none': return card.mode === 'visual'
      ? `${name}: no visible passes in the next 2 days`
      : `${name}: no passes in the next 2 days`;
    case 'unavailable': return `${name}: these elements can't be used to compute passes`;
    default: return `Satellite ${card.noradId} isn't in the catalog right now`;
  }
}
