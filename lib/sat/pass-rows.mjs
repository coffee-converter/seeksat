// lib/sat/pass-rows.mjs - turns a pass-engine result into the rows and
// messages the satellite page shows.
import { accuracyNote, DEFAULT_SEARCH_DAYS } from '../passes/engine.mjs';
import { formatPassDuration } from '../passes/format.mjs';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass(azDeg) {
  const i = Math.round((((azDeg % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

function azText(az) {
  const deg = ((Math.round(az) % 360) + 360) % 360;
  return `${compass(az)} ${deg}°`;
}

// names: { [obsId]: place name } for the joint-observer GEO message.
export function passRows(result, { epochMs, nowMs, minElevDeg, mode, timeZone, locale, names = {} }) {
  if (!result || result.kind === 'unavailable') {
    return { kind: 'message', text: "These elements can't be used to compute passes." };
  }
  if (result.kind === 'stationary') {
    const p = result.pointing?.[0];
    if (!p) return { kind: 'message', text: "These elements can't be used to compute passes." };
    const f = (n) => n.toFixed(1);
    if (result.visible) {
      return {
        kind: 'stationary',
        text: `Fixed in your sky at azimuth ${f(p.azDeg)}°, elevation ${f(p.elDeg)}°. Over a day it stays between ${f(p.elMinDeg)}° and ${f(p.elMaxDeg)}° up.`,
      };
    }
    // The first place that cannot see it is the one to name.
    const blocked = result.pointing.find((q) => q.elMaxDeg < minElevDeg) ?? p;
    if (blocked !== p && blocked.obsId !== 'home') {
      const place = names[blocked.obsId] || 'one of your places';
      return { kind: 'stationary', text: `It never rises above ${minElevDeg}° at ${place}.` };
    }
    return {
      kind: 'stationary',
      text: p.elMaxDeg < 0 ? 'It never rises here.' : `It never rises above ${minElevDeg}° here.`,
    };
  }
  if (!result.passes.length) {
    return {
      kind: 'message',
      text: mode === 'visual'
        ? `No visible passes in the next ${DEFAULT_SEARCH_DAYS} days.`
        : `No passes above ${minElevDeg}° in the next ${DEFAULT_SEARCH_DAYS} days.`,
    };
  }
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  const hm = (ms) => clock.format(ms);
  const rows = result.passes.map((pass) => {
    // A pass already up: the engine clamps its start to the search time, so
    // say when it sets and how long is left instead of a start-end range.
    const inProgress = pass.startMs <= nowMs && nowMs < pass.endMs;
    return {
      key: String(pass.startMs),
      dayLabel: day.format(pass.startMs).replace(/,/g, ''),
      startLabel: hm(pass.startMs),
      peakLabel: hm(pass.peakMs),
      endLabel: hm(pass.endMs),
      timesLabel: inProgress ? `up now, until ${hm(pass.endMs)}` : `${hm(pass.startMs)} to ${hm(pass.endMs)}`,
      durationLabel: inProgress
        ? `${formatPassDuration((pass.endMs - nowMs) / 1000)} left`
        : formatPassDuration(pass.durationMs / 1000),
      maxElevLabel: `${Math.round(pass.maxElevDeg)}°`,
      azLabel: `${azText(pass.startAzDeg)} to ${azText(pass.endAzDeg)}`,
      fromLabel: compass(pass.startAzDeg),
      toLabel: compass(pass.endAzDeg),
      visible: Boolean(pass.visible),
      inProgress,
      runsPastEnd: Boolean(pass.runsPastEnd),
      accuracy: Number.isFinite(epochMs) ? (accuracyNote(epochMs, pass.peakMs)?.text ?? null) : null,
      pass,
    };
  });
  return { kind: 'rows', rows };
}

/** The printed sheet's one accuracy caveat, naming the first pass that has
 *  an accuracy note, or null when none does. */
export function printAccuracyNote(rows) {
  const noted = rows.find((r) => r.accuracy);
  return noted
    ? `Passes from ${noted.dayLabel} ${noted.startLabel} on may be off by a minute or more: the elements will be over 3 days old by then.`
    : null;
}

/** "CST (America/Chicago)" for a zone at a moment; "UTC" for UTC or a zone
 *  this runtime does not know. */
export function zoneLabel(timeZone, atMs, locale) {
  if (!timeZone || timeZone === 'UTC' || timeZone === 'Etc/UTC') return 'UTC';
  try {
    const short = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(atMs).find((p) => p.type === 'timeZoneName')?.value;
    return short ? `${short} (${timeZone})` : timeZone;
  } catch {
    return 'UTC';
  }
}

const FIRST_VIEW_MS = 48 * 3_600_000;

/** How many rows to show before "Show all": those starting in the next 48 h,
 *  at least 3, and always through the shared row. */
export function initialRowCount(rows, nowMs, { sharedKey = null } = {}) {
  let n = rows.findIndex((r) => r.pass.startMs >= nowMs + FIRST_VIEW_MS);
  if (n < 0) n = rows.length;
  n = Math.min(rows.length, Math.max(n, 3));
  const shared = sharedKey == null ? -1 : rows.findIndex((r) => r.key === sharedKey);
  return Math.max(n, shared + 1);
}

/** [year, month, day] of `ms` as a calendar date in `timeZone`. */
function dateParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return [get('year'), get('month'), get('day')];
}

/** "Today", "Tomorrow" or "Tue 3 Nov", by calendar day in the observer's zone. */
export function dayHeading(ms, nowMs, timeZone, locale) {
  const [y, m, d] = dateParts(nowMs, timeZone);
  const key = dateParts(ms, timeZone).join('-');
  if (key === [y, m, d].join('-')) return 'Today';
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  if (key === [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()].join('-')) return 'Tomorrow';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone })
    .format(ms).replace(/,/g, '');
}

/** Rows under day headings, in order. A pass already up counts as today. */
export function groupRowsByDay(rows, nowMs, timeZone, locale) {
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { timeZone = 'UTC'; }
  const groups = [];
  for (const row of rows) {
    const heading = dayHeading(Math.max(row.pass.startMs, nowMs), nowMs, timeZone, locale);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.rows.push(row);
    else groups.push({ heading, rows: [row] });
  }
  return groups;
}

/** Whether a row's extra actions show. The shared row starts open, so a
 *  toggle on it means closed; any other row is open once toggled. */
export function isRowOpen(key, sharedKey, toggled) {
  return (key === sharedKey) !== toggled.has(key);
}
