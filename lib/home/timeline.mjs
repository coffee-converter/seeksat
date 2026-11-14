// lib/home/timeline.mjs - pure helpers for the "next 24 hours" timeline.
import { sunAltitudeDeg } from '../pass-finder/visibility.js';

import { TIMELINE_HOURS } from './next-up.mjs';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Rows for satellites with a pass in the window. */
export function timelineRows(cards, nowMs, hours = TIMELINE_HOURS) {
  const end = nowMs + hours * HOUR;
  const rows = [];
  for (const c of cards) {
    if (c.kind !== 'pass') continue;
    const passes = (c.passes ?? [c.pass]).filter((p) => p.startMs < end);
    if (passes.length) rows.push({ noradId: c.noradId, name: c.name, passes });
  }
  return rows;
}

/**
 * A lane for each span so that no two in a lane overlap. Each span counts as
 * drawn: at least `minW` wide about its middle, kept inside [0, 1] (as the
 * bars' CSS does). Returns the lane per span, in input order, and the number
 * of lanes.
 */
export function stripLanes(spans, minW = 0) {
  const ends = [];
  const order = spans.map((s, i) => {
    const w = Math.min(1, Math.max(s.x1 - s.x0, minW));
    const a = Math.min(Math.max((s.x0 + s.x1) / 2 - w / 2, 0), 1 - w);
    return { i, a, b: a + w };
  }).sort((p, q) => p.a - q.a);
  const lanes = new Array(spans.length);
  for (const { i, a, b } of order) {
    let lane = ends.findIndex((end) => end <= a);
    if (lane === -1) lane = ends.length;
    ends[lane] = b;
    lanes[i] = lane;
  }
  return { lanes, count: Math.max(1, ends.length) };
}

/** Pass as fractions of the window, clipped to [0, 1]; null if outside it. */
export function barSpan(pass, nowMs, hours = TIMELINE_HOURS) {
  const span = hours * HOUR;
  const x0 = Math.max(0, (pass.startMs - nowMs) / span);
  const x1 = Math.min(1, (pass.endMs - nowMs) / span);
  return x1 > x0 ? { x0, x1 } : null;
}

// Formatters by zone and locale: the timeline asks for times every second.
const formatters = new Map();
function partsFormat(timeZone, locale) {
  const key = `${timeZone}|${locale ?? ''}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      timeZone, hourCycle: 'h23', numberingSystem: 'latn', hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric',
    });
    formatters.set(key, f);
  }
  return f;
}

function localParts(ms, timeZone, locale) {
  const parts = partsFormat(timeZone, locale).formatToParts(ms);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { hour: get('hour'), minute: get('minute'), day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** The zone if the runtime knows it, else UTC. */
function knownZone(timeZone) {
  try { partsFormat(timeZone); return timeZone; } catch { return 'UTC'; }
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "21:07": a fixed 24-hour HH:MM in the observer's zone, whatever the locale. */
export function clockLabel(ms, timeZone, locale) {
  const p = localParts(ms, knownZone(timeZone), locale);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Whether the locale reads a 12-hour clock, as the cards' clock does. */
function twelveHour(locale) {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h12' || cycle === 'h11';
}

/** Whole-hour ticks (multiples of `every`) in the observer's zone, labelled
 *  "3 PM" for a 12-hour locale and "15:00" otherwise, in Latin digits. */
export function hourTicks(nowMs, timeZone, { every = 3, hours = TIMELINE_HOURS, locale } = {}) {
  timeZone = knownZone(timeZone);
  const twelve = twelveHour(locale);
  // Short: "3a", "12p" on a 12-hour clock, "15:00" on a 24-hour one. Midnight
  // is named by its weekday instead, since it starts a new day.
  const hourLabel = (h) => (twelve ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : `${pad2(h)}:00`);
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
    ticks.push({ x: (t - nowMs) / (hours * HOUR), label: dayLabel ?? hourLabel(p.hour), dayLabel });
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
