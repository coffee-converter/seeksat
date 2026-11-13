// lib/home/best-line.mjs - the one line over the home pass list: the pass up
// now, else the best pass in the next 24 hours.
import { compass } from '../sat/pass-rows.mjs';
import { clockFormat, dayKey } from '../clock.mjs';
import { underWay } from '../passes/under-way.mjs';

/** From this hour, and before MORNING_HOUR, a pass is in the night ("tonight"). */
export const EVENING_HOUR = 17;
export const MORNING_HOUR = 5;

const DAY_MS = 86_400_000;
const MINUTE = 60_000;

const hourFormats = new Map();
/** The hour (0 to 23) of `ms` on the clock in timeZone. */
function localHour(ms, timeZone) {
  const key = timeZone ?? '';
  let f = hourFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone });
    hourFormats.set(key, f);
  }
  return Number.parseInt(f.format(ms), 10) % 24;
}

/** The day before a "2026-11-13" day key. */
function dayBefore(key) {
  return new Date(Date.parse(key) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * "tonight", "today" or "tomorrow" for a pass starting at `passMs`, seen at
 * `nowMs`, on the clock in timeZone. Evening and night (from 17:00 to 05:00
 * the next morning) is "tonight" when it is this evening's night, or the night
 * still running in the small hours; daytime is "today" on today's date. Anything
 * else within the next 24 hours is "tomorrow".
 */
export function bestDayWord(passMs, nowMs, timeZone) {
  const hour = localHour(passMs, timeZone);
  const passDay = dayKey(passMs, timeZone);
  const today = dayKey(nowMs, timeZone);
  const night = hour >= EVENING_HOUR || hour < MORNING_HOUR;
  if (!night) return passDay === today ? 'today' : 'tomorrow';
  // The evening a night belongs to: the small hours count with the day before.
  const evening = hour < MORNING_HOUR ? dayBefore(passDay) : passDay;
  const nowEvening = localHour(nowMs, timeZone) < MORNING_HOUR ? dayBefore(today) : today;
  return evening === nowEvening || evening === today ? 'tonight' : 'tomorrow';
}

/**
 * The best pass line: { label: "Best tonight:", text: "ISS 9:44 PM, 72°, look NW" },
 * the time and direction being where it comes up and the height its peak.
 */
export function bestLine({ name, pass, nowMs, timeZone, locale }) {
  const parts = [
    `${name} ${clockFormat(locale, timeZone).format(pass.startMs)}`,
    `${Math.round(pass.maxElevDeg)}°`,
  ];
  if (pass.startAzDeg != null) parts.push(`look ${compass(pass.startAzDeg)}`);
  return { label: `Best ${bestDayWord(pass.startMs, nowMs, timeZone)}:`, text: parts.join(', ') };
}

/** The pass under way at nowMs across the cards ({ noradId, name, pass }), the
 *  highest when more than one is up; null when none is. */
export function upNowPass(cards, nowMs) {
  let up = null;
  for (const card of cards ?? []) {
    if (card.kind !== 'pass') continue;
    for (const pass of card.upcoming ?? card.passes ?? [card.pass]) {
      if (!pass || !underWay(pass, nowMs)) continue;
      if (up === null || pass.maxElevDeg > up.pass.maxElevDeg) up = { noradId: card.noradId, name: card.name, pass };
    }
  }
  return up;
}

/** "4 min left", "1 h 20 min left"; at least a minute. */
function timeLeft(ms) {
  const min = Math.max(1, Math.floor(ms / MINUTE));
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min left` : `${h} h left`;
}

/**
 * The up now line: { label: "Up now:", text: "ISS, look NE, 4 min left" }.
 * `azDeg` is where the satellite is now; without it the line says where it
 * sets ("heading NE"). A pass that runs past the search has no time left.
 */
export function upNowLine({ name, pass, nowMs, azDeg = null }) {
  const parts = [name];
  if (azDeg != null && Number.isFinite(azDeg)) parts.push(`look ${compass(azDeg)}`);
  else if (pass.endAzDeg != null) parts.push(`heading ${compass(pass.endAzDeg)}`);
  if (!pass.runsPastEnd) parts.push(timeLeft(pass.endMs - nowMs));
  return { label: 'Up now:', text: parts.join(', ') };
}
