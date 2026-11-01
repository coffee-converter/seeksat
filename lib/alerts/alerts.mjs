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

/** The stored list; anything unreadable is an empty list. */
export function parseAlerts(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isAlert) : [];
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

/** The alert whose notify time is soonest and not yet past, or null. */
export function nextDue(list, nowMs) {
  let best = null;
  for (const a of list) {
    if (fireAt(a) < nowMs) continue;
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
