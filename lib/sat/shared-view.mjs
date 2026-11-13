// lib/sat/shared-view.mjs - the shared view on a satellite page: the sender's
// places and settings, laid over the visitor's prefs without changing them.
// Pure, so the server render and the first client render agree.

import { MIN_ELEV_MAX } from '../home/view.mjs';

const MAX_EXTRA = 3;
// The engine clamps a pass that is already up to the search time, so its row
// starts after the sender's start time. A LEO pass lasts well under this.
const IN_PROGRESS_LOOKBACK_MS = 30 * 60_000;

// decoded: decodeStateBlob's result. null when there is no one to view from.
export function sharedSettings(decoded) {
  const list = Array.isArray(decoded?.observers) ? decoded.observers : [];
  if (!list.length) return null;
  const [first, ...rest] = list;
  return {
    observer: { name: first.name, latDeg: first.latDeg, lonDeg: first.lonDeg },
    observers: rest.slice(0, MAX_EXTRA).map((o, i) => ({
      id: `obs-${i + 1}`, name: o.name, latDeg: o.latDeg, lonDeg: o.lonDeg,
    })),
    mode: decoded.mode === 'radio' ? 'radio' : 'visual',
    // Share links allow up to 80°; the page's stepper tops out lower.
    minElevDeg: Math.max(0, Math.min(MIN_ELEV_MAX, Number(decoded.minElevDeg) || 0)),
    passTimeMs: Number.isFinite(decoded.passTimeMs) ? decoded.passTimeMs : null,
    freqHz: Number.isFinite(decoded.downlinkHz) ? decoded.downlinkHz : null,
  };
}

// The settings the page computes from. Reads prefs, never writes them.
export function effectiveSettings(prefs, shared) {
  if (shared) {
    return {
      observer: shared.observer,
      observers: shared.observers,
      mode: shared.mode,
      minElevDeg: shared.minElevDeg,
      isShared: true,
    };
  }
  return {
    observer: prefs.location,
    observers: prefs.observers,
    mode: prefs.mode,
    minElevDeg: prefs.minElevDeg,
    isShared: false,
  };
}

function contains(row, t) {
  const { startMs, endMs } = row.pass;
  if (t >= startMs && t <= endMs) return true;
  return Boolean(row.inProgress) && t < startMs && startMs - t <= IN_PROGRESS_LOOKBACK_MS;
}

// rows: passRows' rows. Formats like pass-rows.mjs, in the given zone.
export function findSharedRow(rows, passTimeMs, nowMs, { timeZone, locale } = {}) {
  if (!Number.isFinite(passTimeMs)) return null;
  const hit = (Array.isArray(rows) ? rows : []).find((r) => contains(r, passTimeMs));
  if (hit) return { kind: 'row', key: hit.key };
  if (passTimeMs >= nowMs) return null;
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  // The viewer's own clock style (12 or 24 hour), as the rest of the app.
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const dayLabel = day.format(passTimeMs).replace(/,/g, '');
  return { kind: 'past', text: `The shared pass on ${dayLabel} at ${clock.format(passTimeMs)} has already happened.` };
}

export function sharedBannerText(shared) {
  const name = shared.observer.name;
  const n = shared.observers.length;
  if (!n) return `You're looking at a shared view from ${name}.`;
  return `You're looking at a shared view from ${name} and ${n} other ${n === 1 ? 'place' : 'places'}.`;
}
