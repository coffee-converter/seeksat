// lib/home/actions.mjs - pure prefs transitions and load bookkeeping behind
// the home store. No DOM, no storage, no Zustand, so node can test it.

import { ElementsError, parseElements } from '../sat/elements.mjs';
import { MAX_CUSTOM, MAX_EXTRA_OBSERVERS, MAX_FOLLOWING } from './prefs.mjs';

export const STALE_AFTER_MS = 60 * 60 * 1000;

/** True when there is no successful load yet, or it is over 60 min old. */
export function isStale(lastLoadedMs, nowMs) {
  if (lastLoadedMs === null || lastLoadedMs === undefined) return true;
  return nowMs - lastLoadedMs > STALE_AFTER_MS;
}

const FOLLOW_LIMIT_MESSAGE = `You can follow up to ${MAX_FOLLOWING} satellites. Unfollow one first.`;

/** Why following id would do nothing (the cap is reached), else null. */
export function followBlockedMessage(following, id) {
  return !following.includes(id) && following.length >= MAX_FOLLOWING ? FOLLOW_LIMIT_MESSAGE : null;
}

export function followIn(prefs, id) {
  if (prefs.following.includes(id) || prefs.following.length >= MAX_FOLLOWING) return prefs;
  return { ...prefs, following: [...prefs.following, id] };
}

export function unfollowIn(prefs, id) {
  return {
    ...prefs,
    following: prefs.following.filter((f) => f !== id),
    custom: prefs.custom.filter((c) => c.noradId !== id),
  };
}

/** Returns { prefs, result }; prefs is unchanged unless result.ok. */
export function addCustomTo(prefs, text) {
  let rec;
  try {
    rec = parseElements(text);
  } catch (e) {
    if (e instanceof ElementsError) return { prefs, result: { ok: false, message: e.message } };
    throw e;
  }
  const others = prefs.custom.filter((c) => c.noradId !== rec.noradId);
  if (others.length >= MAX_CUSTOM) {
    return { prefs, result: { ok: false, message: `You can paste up to ${MAX_CUSTOM} satellites. Remove one first.` } };
  }
  const following = prefs.following.includes(rec.noradId)
    ? prefs.following
    : [...prefs.following, rec.noradId];
  if (following.length > MAX_FOLLOWING) {
    return { prefs, result: { ok: false, message: FOLLOW_LIMIT_MESSAGE } };
  }
  const entry = { noradId: rec.noradId, name: rec.name, line1: rec.line1, line2: rec.line2 };
  return { prefs: { ...prefs, custom: [...others, entry], following }, result: { ok: true } };
}

/** Returns { prefs } or { error }. The id is obs-<n> with the next unused n. */
export function addObserverTo(prefs, { name, latDeg, lonDeg }) {
  const observers = prefs.observers ?? [];
  if (observers.length >= MAX_EXTRA_OBSERVERS) {
    return { error: `You can add up to ${MAX_EXTRA_OBSERVERS} other places.` };
  }
  let n = 1;
  while (observers.some((o) => o.id === `obs-${n}`)) n += 1;
  return { prefs: { ...prefs, observers: [...observers, { id: `obs-${n}`, name, latDeg, lonDeg }] } };
}

export function removeObserverFrom(prefs, id) {
  return { ...prefs, observers: (prefs.observers ?? []).filter((o) => o.id !== id) };
}

/** Each begin() supersedes earlier ones; only the latest may commit. */
export function createLoadGuard() {
  let seq = 0;
  return {
    begin() {
      const mine = ++seq;
      return () => mine === seq;
    },
  };
}
