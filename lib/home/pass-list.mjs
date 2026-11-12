// lib/home/pass-list.mjs - the home pass list: rows by start time under day headings.
import { compass } from '../sat/pass-rows.mjs';
import { clockFormat } from '../clock.mjs';

export const ROW_LIMIT = 12;

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** "2026-11-13" in the place's zone. */
function dayKey(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(ms);
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
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(ms);
}

/** { time: "4:12 AM", sub: "Now" | "in 42 min" | "in 3 h" | "Fri" }. */
export function rowWhen(pass, nowMs, timeZone, locale) {
  const time = clockFormat(locale, timeZone).format(pass.startMs);
  if (pass.inProgress) return { time, sub: 'Now' };
  if (dayGap(pass.startMs, nowMs, timeZone) <= 0) {
    const ms = Math.max(0, pass.startMs - nowMs);
    return { time, sub: ms < HOUR ? `in ${Math.max(1, Math.floor(ms / MINUTE))} min` : `in ${Math.round(ms / HOUR)} h` };
  }
  return { time, sub: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(pass.startMs) };
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

/** "No passes in the next 48 h: X, Y", or null when there is nothing to say. */
export function quietLine(names) {
  return names.length ? `No passes in the next 48 h: ${names.join(', ')}` : null;
}

/**
 * Pass cards flattened into rows (in-progress first, then by start), capped at
 * `limit` and grouped under day headings in the place's zone. Stationary cards
 * above the horizon go to `always`; satellites without passes (a stationary
 * one below the horizon included) go to `quiet` by name.
 */
export function passList({ cards, nowMs, timeZone, limit = ROW_LIMIT }) {
  const all = [];
  const always = [];
  const quiet = [];
  for (const card of cards) {
    if (card.kind === 'pass') {
      for (const pass of card.upcoming ?? card.passes ?? [card.pass]) {
        all.push({
          // To the minute: a refresh moves startMs by seconds, and a new key
          // would close the row if it is open.
          key: `${card.noradId}:${Math.round(pass.startMs / 60_000)}`,
          noradId: card.noradId,
          name: card.name,
          pass,
          now: Boolean(pass.inProgress),
        });
      }
    } else if (card.kind === 'stationary' && card.visible) {
      always.push(card);
    } else {
      quiet.push(card.name);
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
