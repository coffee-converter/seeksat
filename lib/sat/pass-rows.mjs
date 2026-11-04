// lib/sat/pass-rows.mjs - turns a pass-engine result into the rows and
// messages the satellite page shows.
import { accuracyNote, ACCURACY_WARNING_DAYS, DEFAULT_SEARCH_DAYS } from '../passes/engine.mjs';
import { formatPassDuration } from '../passes/format.mjs';
import { countdown } from '../home/next-up.mjs';
import { clockFormat } from '../clock.mjs';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass(azDeg) {
  const i = Math.round((((azDeg % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

function azText(az) {
  const deg = ((Math.round(az) % 360) + 360) % 360;
  return `${compass(az)} ${deg}°`;
}

/** "Rises in the N at 352°, sets in the SE at 131°". */
export function directionText(pass) {
  const deg = (az) => ((Math.round(az) % 360) + 360) % 360;
  return `Rises in the ${compass(pass.startAzDeg)} at ${deg(pass.startAzDeg)}°, sets in the ${compass(pass.endAzDeg)} at ${deg(pass.endAzDeg)}°`;
}

/** The rows' clock: the site's one clock ("4:12 AM" or "04:12"), in the observer's zone. */
function rowClock(timeZone, locale) {
  return clockFormat(locale, timeZone);
}

// How far (deg, the larger of the elevation and azimuth ranges over a day) a
// geosynchronous satellite may move and still read as fixed, or nearly fixed.
// Station-kept ones hold within about 0.1 deg; past a few degrees a dish has
// to follow it.
const FIXED_SPAN_DEG = 0.5;
const NEARLY_FIXED_SPAN_DEG = 3;

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
      // Station-kept, it holds within a fraction of a degree; inclined
      // geosynchronous ones (SDO, old comsats) trace a loop that a dish must follow.
      const azSpan = p.azMinDeg == null ? 0 : ((p.azMaxDeg - p.azMinDeg) % 360 + 360) % 360;
      const span = Math.max(p.elMaxDeg - p.elMinDeg, azSpan);
      if (span <= NEARLY_FIXED_SPAN_DEG) {
        return {
          kind: 'stationary',
          text: `${span <= FIXED_SPAN_DEG ? 'Fixed' : 'Nearly fixed'} in your sky at azimuth ${f(p.azDeg)}°, elevation ${f(p.elDeg)}°. Over a day it stays between ${f(p.elMinDeg)}° and ${f(p.elMaxDeg)}° up.`,
        };
      }
      return {
        kind: 'stationary',
        text: `Always up here, but not fixed: over a day it moves between azimuth ${f(p.azMinDeg)}° and ${f(p.azMaxDeg)}°, and between ${f(p.elMinDeg)}° and ${f(p.elMaxDeg)}° up, so a dish has to follow it.`,
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
  const clock = rowClock(timeZone, locale);
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

/** The pass list's one accuracy caveat, on the first row whose elements will
 *  be old by then (later rows are older still): { key, text }, or null. */
export function rowAccuracyNote(rows) {
  const noted = rows.find((r) => r.accuracy);
  return noted
    ? { key: noted.key, text: `From this pass on, the elements are over ${ACCURACY_WARNING_DAYS} days old, so times may be off by a minute or more.` }
    : null;
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

// Intl.DateTimeFormat is costly to build and the pass list renders every
// second, so formatters are made once per zone, locale and shape.
const formatters = new Map();
function formatter(name, timeZone, locale, opts) {
  const key = `${name}|${timeZone ?? ''}|${locale ?? ''}`;
  let f = formatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { ...opts, timeZone }); formatters.set(key, f); }
  return f;
}

/** [year, month, day] of `ms` as a calendar date in `timeZone`. */
function dateParts(ms, timeZone) {
  const parts = formatter('date', timeZone, 'en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms);
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
  return formatter('heading', timeZone, locale, { weekday: 'short', day: 'numeric', month: 'short' })
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

/** The time words alone, "in 27 min" or "up now"; null once the pass has ended. */
export function nextPassWhen(pass, nowMs) {
  if (nowMs >= pass.endMs) return null;
  return pass.startMs <= nowMs ? 'up now' : `in ${countdown(pass.startMs - nowMs)}`;
}

/** The satellite page's next pass line, in the rows' day headings and
 *  clock: "in 7 h 12 min, Tomorrow 04:12, SW to SE", or "up now, until
 *  04:20, SW to SE" for a pass already up. Null once the pass has ended. */
export function nextPassText(pass, nowMs, timeZone, locale) {
  if (nowMs >= pass.endMs) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { timeZone = 'UTC'; }
  const hm = (ms) => rowClock(timeZone, locale).format(ms);
  const when = pass.startMs <= nowMs
    ? `${nextPassWhen(pass, nowMs)}, until ${hm(pass.endMs)}`
    : `${nextPassWhen(pass, nowMs)}, ${dayHeading(pass.startMs, nowMs, timeZone, locale)} ${hm(pass.startMs)}`;
  return `${when}, ${compass(pass.startAzDeg)} to ${compass(pass.endAzDeg)}`;
}

/** Whether a row's extra actions show. The shared row starts open, so a
 *  toggle on it means closed; any other row is open once toggled. */
export function isRowOpen(key, sharedKey, toggled) {
  return (key === sharedKey) !== toggled.has(key);
}
