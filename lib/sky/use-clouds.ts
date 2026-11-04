"use client";

import { useEffect, useState } from "react";
import { roundCoord } from "@/lib/sky/round-coords.mjs";

/** Hourly cloud occlusion in percent from startMs, the shape cloudAt() reads. */
export interface Forecast {
  startMs: number;
  hours: number[];
}

const REFRESH_MS = 30 * 60_000;
// A little under the refresh period, so each refresh tick fetches afresh.
const FRESH_MS = REFRESH_MS - 60_000;
const round = roundCoord as (deg: number) => number;

// One request per rounded location: callers at the same time share the
// promise, and a result stays good for FRESH_MS. A failure is dropped at
// once so the next call tries again.
const shared = new Map<string, { at: number; promise: Promise<Forecast | null> }>();

function parse(body: unknown): Forecast | null {
  const b = body as { startMs?: unknown; hours?: unknown } | null;
  if (!b || typeof b.startMs !== "number" || !Number.isFinite(b.startMs)) return null;
  if (!Array.isArray(b.hours) || b.hours.length === 0) return null;
  if (!b.hours.every((h) => typeof h === "number" && Number.isFinite(h))) return null;
  return { startMs: b.startMs, hours: b.hours };
}

function loadForecast(query: string): Promise<Forecast | null> {
  const now = Date.now();
  const hit = shared.get(query);
  if (hit && now - hit.at < FRESH_MS) return hit.promise;
  const promise = fetch(`/api/clouds?${query}`)
    .then((r) => (r.ok ? r.json() : null))
    .then(parse)
    .catch(() => null)
    .then((forecast) => {
      if (!forecast && shared.get(query)?.promise === promise) shared.delete(query);
      return forecast;
    });
  shared.set(query, { at: now, promise });
  return promise;
}

/**
 * The cloud forecast for the observer's area (rounded to 0.1 degree), or null
 * when disabled, while loading, or on any failure. Refreshes every 30 minutes
 * while the page is visible. `enabled` is visual mode: radio never fetches.
 */
export function useClouds(
  observer: { latDeg: number; lonDeg: number } | null,
  enabled: boolean,
): Forecast | null {
  const query = enabled && observer
    ? `lat=${round(observer.latDeg)}&lon=${round(observer.lonDeg)}`
    : null;
  const [state, setState] = useState<{ query: string; forecast: Forecast | null } | null>(null);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      void loadForecast(query).then((forecast) => {
        if (alive) setState({ query, forecast });
      });
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    // Back from a hidden tab: catch up if a refresh was skipped.
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
  }, [query]);

  return query && state?.query === query ? state.forecast : null;
}
