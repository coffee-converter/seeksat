// lib/home/timeline.mjs - pure helpers for the "next 24 hours" timeline.
import { sunAltitudeDeg } from '../pass-finder/visibility.js';

import { TIMELINE_HOURS } from './next-up.mjs';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * Rows for satellites with a pass in the window, plus how many followed
 * satellites were left out (none, or nothing within the window).
 */
export function timelineRows(cards, nowMs, hours = TIMELINE_HOURS) {
  const end = nowMs + hours * HOUR;
  const rows = [];
  let leftOut = 0;
  for (const c of cards) {
    if (c.kind === 'none') { leftOut++; continue; }
    if (c.kind !== 'pass') continue;
    const passes = (c.passes ?? [c.pass]).filter((p) => p.startMs < end);
    if (passes.length) rows.push({ noradId: c.noradId, name: c.name, passes });
    else leftOut++;
  }
  return { rows, leftOut };
}

/** Pass as fractions of the window, clipped to [0, 1]; null if outside it. */
export function barSpan(pass, nowMs, hours = TIMELINE_HOURS) {
  const span = hours * HOUR;
  const x0 = Math.max(0, (pass.startMs - nowMs) / span);
  const x1 = Math.min(1, (pass.endMs - nowMs) / span);
  return x1 > x0 ? { x0, x1 } : null;
}

function localParts(ms, timeZone, locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone, hourCycle: 'h23', numberingSystem: 'latn', hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(ms);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { hour: get('hour'), minute: get('minute'), day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Whole-hour ticks (multiples of `every`) in the observer's zone. */
export function hourTicks(nowMs, timeZone, { every = 3, hours = TIMELINE_HOURS, locale } = {}) {
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { timeZone = 'UTC'; }
  const step = 15 * MINUTE; // covers zones on :30 and :45 offsets
  const endMs = nowMs + hours * HOUR;
  const ticks = [];
  let prevDay = localParts(nowMs, timeZone, locale).day;
  for (let t = Math.ceil(nowMs / step) * step; t <= endMs; t += step) {
    const p = localParts(t, timeZone, locale);
    if (p.minute !== 0 || p.hour % every !== 0) continue;
    const dayLabel = p.day !== prevDay
      ? new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(t)
      : null;
    prevDay = p.day;
    ticks.push({ x: (t - nowMs) / (hours * HOUR), label: `${String(p.hour).padStart(2, '0')}:00`, dayLabel });
  }
  return ticks;
}

/** Stretches of the window where the Sun is below `belowDeg`. */
export function nightSpans(observer, nowMs, { hours = TIMELINE_HOURS, stepMin = 10, belowDeg = -6 } = {}) {
  const obs = { latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const span = hours * HOUR;
  const spans = [];
  let start = null;
  for (let off = 0; off <= span; off += stepMin * MINUTE) {
    const dark = sunAltitudeDeg(obs, new Date(nowMs + off)) < belowDeg;
    if (dark && start === null) start = off;
    if (!dark && start !== null) { spans.push({ x0: start / span, x1: off / span }); start = null; }
  }
  if (start !== null) spans.push({ x0: start / span, x1: 1 });
  return spans;
}
