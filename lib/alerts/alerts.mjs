// lib/alerts/alerts.mjs - pass reminders: a small list in localStorage and the
// pure logic that decides what to notify next. Works only while SeekSat is open.
import { countdown } from '../home/next-up.mjs';

export const ALERTS_KEY = 'seeksat.alerts.v1';
export const MAX_ALERTS = 50;
export const DEFAULT_LEAD_MIN = 10;
/** The largest delay setTimeout accepts. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

const MIN = 60_000;

const isAlert = (a) => a && typeof a === 'object'
  && typeof a.id === 'string'
  && Number.isFinite(a.noradId) && Number.isFinite(a.startMs) && Number.isFinite(a.peakMs)
  && Number.isFinite(a.maxElevDeg) && Number.isFinite(a.leadMin)
  && typeof a.name === 'string' && typeof a.url === 'string';

/** The url if it stays on this origin, else "/". */
export function safeUrl(url, origin) {
  try {
    return new URL(url, origin).origin === origin ? url : '/';
  } catch {
    return '/';
  }
}

/** True while the pass has not started, so a reminder can still be useful. */
export function canRemind(pass, nowMs) {
  return Number.isFinite(pass?.startMs) && pass.startMs > nowMs;
}

/** The stored list; anything unreadable is an empty list. With an origin, off-origin urls become "/". */
export function parseAlerts(raw, origin) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const ok = v.filter(isAlert);
    return origin ? ok.map((a) => ({ ...a, url: safeUrl(a.url, origin) })) : ok;
  } catch {
    return [];
  }
}

export function makeAlert({ noradId, name, pass, url, leadMin = DEFAULT_LEAD_MIN }) {
  return {
    id: `${noradId}:${pass.startMs}`,
    noradId,
    name,
    startMs: pass.startMs,
    peakMs: pass.peakMs,
    maxElevDeg: pass.maxElevDeg,
    leadMin,
    url,
  };
}

/** Adds (replacing the same id), keeping the newest 50. */
export function addAlert(list, alert) {
  return [...list.filter((a) => a.id !== alert.id), alert].slice(-MAX_ALERTS);
}

export function removeAlert(list, id) {
  return list.filter((a) => a.id !== id);
}

/** Drops passes that have already started. */
export function pruneAlerts(list, nowMs) {
  return list.filter((a) => a.startMs >= nowMs);
}

export const fireAt = (a) => a.startMs - a.leadMin * MIN;

/** True while the pass is still ahead. A timer that fires late (the laptop
 *  slept, the tab was throttled) after the pass started shows nothing. */
export function shouldNotify(alert, nowMs) {
  return Number.isFinite(alert?.startMs) && alert.startMs > nowMs;
}

/** The pending alert (pass still ahead) with the earliest notify time, overdue ones first, or null. */
export function nextDue(list, nowMs) {
  let best = null;
  for (const a of list) {
    if (a.startMs <= nowMs) continue;
    if (!best || fireAt(a) < fireAt(best)) best = a;
  }
  return best;
}

export function alertText(alert, nowMs) {
  return `${alert.name} in ${countdown(Math.max(0, alert.startMs - nowMs))}, max ${Math.round(alert.maxElevDeg)}°`;
}

/** What to wait for: the delay to the next notify time (capped) and its alert. */
export function planTimer(list, nowMs) {
  const alert = nextDue(list, nowMs);
  if (!alert) return null;
  return { delayMs: Math.min(Math.max(0, fireAt(alert) - nowMs), MAX_TIMER_MS), alert };
}
