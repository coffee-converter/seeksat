// lib/mcp/local-time.mjs - the observer's clock for MCP results and time
// inputs. The time zone comes from the offline lat/lon lookup the app uses
// (@photostructure/tz-lookup through lib/time/zone.mjs), so no place is sent
// anywhere. Results keep every time in UTC ISO and add, next to each one,
// the same moment on the observer's clock with its offset:
//   rise: '2026-11-14T23:41:00.000Z', riseLocal: '2026-11-14T17:41:00-06:00'

import tzlookup from '@photostructure/tz-lookup';
import { zoneFrom } from '../time/zone.mjs';

/** The IANA time zone at a place ("America/Chicago"), or "UTC" when the
 *  lookup has no answer. */
export function zoneAt(latDeg, lonDeg) {
  return zoneFrom(tzlookup, latDeg, lonDeg, 'UTC');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** The wall clock in `tz` at `ms`, to the second, and its offset from UTC
 *  in minutes. */
function wallClock(tz, ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(ms);
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  const w = { year: n('year'), month: n('month'), day: n('day'), hour: n('hour'), minute: n('minute'), second: n('second') };
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return { ...w, offsetMin: Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000) };
}

/** "+05:30", "-06:00", "+00:00". */
function offsetText(min) {
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** `ms` on the clock of `tz`, ISO 8601 with its offset, to the second:
 *  "2026-11-14T17:41:00-06:00". */
export function localIso(ms, tz) {
  const w = wallClock(tz, ms);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${offsetText(w.offsetMin)}`;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
/** Times that need no local twin: the element epoch is a fact about the
 *  data, and interpretedAs already gives both clocks. */
const SKIP_KEYS = new Set(['tleEpoch', 'interpretedAs']);

/**
 * A copy of a result with `<key>Local` (see localIso) right after every key
 * that holds a UTC ISO time, at any depth.
 */
export function withLocalTimes(value, tz) {
  if (Array.isArray(value)) return value.map((v) => withLocalTimes(v, tz));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SKIP_KEYS.has(k)) { out[k] = v; continue; }
    out[k] = withLocalTimes(v, tz);
    if (typeof v === 'string' && ISO_UTC.test(v) && !(`${k}Local` in value)) out[`${k}Local`] = localIso(Date.parse(v), tz);
  }
  return out;
}

const WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i;
const NO_ZONE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?$/;

/** The example every time error shows. */
export const TIME_EXAMPLE = 'Use ISO 8601, e.g. "2026-11-14T21:00:00-06:00" or "2026-11-15T03:00:00Z"; a time with no offset, such as "2026-11-14T21:00", is read in the observer\'s time zone.';

/** "+0530" or "+05" as "+05:30" or "+05:00"; "z" as "Z". */
function zoneSuffix(z) {
  if (/^z$/i.test(z)) return 'Z';
  const d = z.replace(':', '');
  return `${d.slice(0, 3)}:${d.slice(3) || '00'}`;
}

/**
 * Read a time input. ISO 8601 with Z or an offset is that moment; one with
 * no offset (a date alone is its midnight) is read on the clock of
 * `timeZone`. Throws an error with an example for anything else.
 * @returns {{ ms: number, interpretedAs: { input: string, utc: string, local: string,
 *   timeZone: string, offsetGiven: boolean, note?: string } }}
 */
export function parseTimeInput(value, { timeZone = 'UTC', name = 'time', zoneLabel = null } = {}) {
  const input = String(value ?? '').trim();
  const bad = () => new Error(`${name} "${input}" is not a time I can read. ${TIME_EXAMPLE}`);
  let ms;
  let offsetGiven;
  let m = WITH_ZONE.exec(input);
  if (m) {
    const [, y, mo, d, h, mi, s = '00', frac = '', z] = m;
    ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${frac.slice(0, 4)}${zoneSuffix(z)}`);
    offsetGiven = true;
  } else if ((m = NO_ZONE.exec(input))) {
    const [, y, mo, d, h = '0', mi = '0', s = '0', frac = ''] = m;
    const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)];
    const wall = Date.UTC(...parts, Math.round(Number(`0${frac || '.0'}`) * 1000));
    // Date.UTC rolls 31 February over into March: refuse what does not round-trip.
    const back = new Date(wall);
    if (back.getUTCMonth() !== parts[1] || back.getUTCDate() !== parts[2] || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) throw bad();
    ms = wall - wallClock(timeZone, wall).offsetMin * 60_000;
    // Once more at the found moment, for a wall time across a DST change.
    ms = wall - wallClock(timeZone, ms).offsetMin * 60_000;
    offsetGiven = false;
  }
  if (!Number.isFinite(ms)) throw bad();
  const interpretedAs = {
    input,
    utc: new Date(ms).toISOString(),
    local: localIso(ms, timeZone),
    timeZone,
    offsetGiven,
    ...(!offsetGiven && { note: `No offset was given, so it was read as ${zoneLabel ?? `${timeZone} time`}.` }),
  };
  return { ms, interpretedAs };
}
