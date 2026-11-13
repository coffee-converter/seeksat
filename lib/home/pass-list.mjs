// lib/home/pass-list.mjs - the home pass list: rows by start time under day headings.
import { compass } from '../sat/pass-rows.mjs';
import { clockFormat } from '../clock.mjs';

export const ROW_LIMIT = 12;

const MINUTE = 60_000;
const HOUR = 3_600_000;

// Building an Intl.DateTimeFormat is slow, and the list asks for several per
// row on every one-second render: keep one per (kind, zone).
const formats = new Map();
function format(kind, timeZone) {
  const key = `${kind}|${timeZone ?? ''}`;
  let f = formats.get(key);
  if (!f) {
    f = kind === 'day'
      ? new Intl.DateTimeFormat('en-CA', { timeZone })
      : new Intl.DateTimeFormat('en-US', { weekday: kind, timeZone });
    formats.set(key, f);
  }
  return f;
}

/** "2026-11-13" in the place's zone. */
function dayKey(ms, timeZone) {
  return format('day', timeZone).format(ms);
}

/** Whole calendar days from nowMs's day to ms's day, in timeZone. */
function dayGap(ms, nowMs, timeZone) {
  return Math.round((Date.parse(dayKey(ms, timeZone)) - Date.parse(dayKey(nowMs, timeZone))) / 86_400_000);
}

/** "Today", "Tomorrow", else the weekday ("Friday"). */
export function dayLabel(ms, nowMs, timeZone) {
  const gap = dayGap(ms, nowMs, timeZone);
  if (gap <= 0) return 'Today';
  if (gap === 1) return 'Tomorrow';
  return format('long', timeZone).format(ms);
}

/** Under way at nowMs: flagged by the engine, or started since the cards were made. */
export function passUnderWay(pass, nowMs) {
  return Boolean(pass.inProgress) || pass.startMs <= nowMs;
}

/** A row's key: the satellite and the pass's rise to the minute (a refresh
 *  moves it by seconds, and a new key would close an open row). A satellite
 *  has one pass under way at a time, so one whose rise is unknown is "now". */
export function passKey(noradId, pass) {
  return `${noradId}:${pass.riseUnknown ? 'now' : Math.round((pass.riseMs ?? pass.startMs) / MINUTE)}`;
}

/**
 * { time: "4:12 AM", sub: "Now" | "in 42 min" | "in 3 h" | "Fri" }, the time
 * being the rise. A pass up since before its rise could be found reads
 * { time: "Now", sub: "to 6:40 AM" }, or "stays up" past the search.
 */
export function rowWhen(pass, nowMs, timeZone, locale) {
  const clock = clockFormat(locale, timeZone);
  if (pass.riseUnknown) {
    return { time: 'Now', sub: pass.runsPastEnd ? 'stays up' : `to ${clock.format(pass.endMs)}` };
  }
  const time = clock.format(pass.riseMs ?? pass.startMs);
  if (passUnderWay(pass, nowMs)) return { time, sub: 'Now' };
  if (dayGap(pass.startMs, nowMs, timeZone) <= 0) {
    const ms = Math.max(0, pass.startMs - nowMs);
    return { time, sub: ms < HOUR ? `in ${Math.max(1, Math.floor(ms / MINUTE))} min` : `in ${Math.round(ms / HOUR)} h` };
  }
  return { time, sub: format('short', timeZone).format(pass.startMs) };
}

/** "54° · 5 min · SW→NE"; the direction is left out when an azimuth is null. */
export function rowDetail(pass) {
  const parts = [
    `${Math.round(pass.maxElevDeg)}°`,
    `${Math.max(1, Math.round(pass.durationMs / MINUTE))} min`,
  ];
  if (pass.startAzDeg != null && pass.endAzDeg != null) {
    parts.push(`${compass(pass.startAzDeg)}→${compass(pass.endAzDeg)}`);
  }
  return parts.join(' · ');
}

/**
 * The lines at the end of the list for satellites without a pass row, one per
 * reason: no pass in 48 h, a stationary one below the horizon, orbit data
 * that can't be used, an id not in the catalog.
 */
export function quietLines({ none = [], neverUp = [], unusable = [], missing = [] }) {
  const lines = [];
  if (none.length) lines.push(`No passes in the next 48 h: ${none.join(', ')}`);
  if (neverUp.length) lines.push(`Never rises here: ${neverUp.join(', ')}`);
  if (unusable.length) lines.push(`Can't predict passes from this orbit data: ${unusable.join(', ')}`);
  if (missing.length) lines.push(`Not in the catalog right now: ${missing.map((id) => `NORAD ${id}`).join(', ')}`);
  return lines;
}

/**
 * Pass cards flattened into rows (under way first, then by start), capped at
 * `limit` and grouped under day headings in the place's zone. Passes already
 * over are left out. Stationary cards above the horizon go to `always`;
 * satellites without passes go to `quiet`, sorted by reason (see quietLines).
 */
export function passList({ cards, nowMs, timeZone, limit = ROW_LIMIT }) {
  const all = [];
  const always = [];
  /** @type {{ none: string[], neverUp: string[], unusable: string[], missing: number[] }} */
  const quiet = { none: [], neverUp: [], unusable: [], missing: [] };
  for (const card of cards) {
    if (card.kind === 'pass') {
      for (const pass of card.upcoming ?? card.passes ?? [card.pass]) {
        if (pass.endMs <= nowMs) continue;
        all.push({
          key: passKey(card.noradId, pass),
          noradId: card.noradId,
          name: card.name,
          pass,
          now: passUnderWay(pass, nowMs),
        });
      }
    } else if (card.kind === 'stationary') {
      if (card.visible) always.push(card);
      else quiet.neverUp.push(card.name);
    } else if (card.kind === 'unavailable') {
      quiet.unusable.push(card.name);
    } else if (card.kind === 'missing') {
      quiet.missing.push(card.noradId);
    } else {
      quiet.none.push(card.name);
    }
  }
  all.sort((a, b) => Number(b.now) - Number(a.now) || a.pass.startMs - b.pass.startMs);

  const groups = [];
  for (const row of all.slice(0, limit)) {
    // A pass already under way belongs to today, whenever it began.
    const at = row.now ? nowMs : row.pass.startMs;
    const key = dayKey(at, timeZone);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(at, nowMs, timeZone), rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return { groups, more: Math.max(0, all.length - limit), always, quiet };
}
