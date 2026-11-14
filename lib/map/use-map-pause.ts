// lib/map/use-map-pause.ts - Pause the map at an opened pass's highest point.
// Shared by the home and satellite pages: the page reports its open row, and
// this keeps the map clock (lib/map/map-clock.ts) in step with it.
"use client";

import { useEffect, useMemo, useRef } from "react";
import { passArc, visibilityRing } from "./pass-arc.mjs";
import { subpoint } from "./geometry.mjs";
import { useMapClock } from "./map-clock";
import { passTimeZoned } from "@/components/passes/PassStats";
import type { MapPass } from "@/components/home/useMapSats";

/** The open pass row a page reports: its key and the pass's times. */
export interface OpenPassRow {
  key: string;
  noradId: number;
  pass: { startMs: number; endMs: number; peakMs: number } | null;
  /** The place's time zone, when the page has it here rather than to hand. */
  timeZone?: string;
}

/**
 * Pauses the map at the open row's peak, or clears it when no row with a
 * pass is open, the pass is under way (live already shows it), or `live` is
 * set (a live view is docked). Clears when the page goes. Returns the time
 * the map draws at and the pass to draw.
 */
/** Rise or set times this close are the same moment, rounded apart. */
const SAME_MS = 90_000;

/** The open row, held while a live view is open: the list drops a pass once
 *  it has set, but the live view (and the map with it) stays on that pass. */
export function useLiveHeldRow(open: OpenPassRow | null, liveId: number | null = null): OpenPassRow | null {
  const liveView = useMapClock((s) => s.liveView);
  const last = useRef<OpenPassRow | null>(open);
  if (open) last.current = open;
  if (!liveView) last.current = open;
  // A live view docked for another satellite replaces the open pass on the
  // map, even while its row is still open in the list (its rise and set
  // marks and sight line would otherwise stay up beside the live one).
  const row = open ?? last.current;
  return row && (liveId == null || row.noradId === liveId) ? row : null;
}

type Arc = { riseMs: number; setMs: number; closestMs: number };
const arcOf = passArc as (
  ecefAt: (d: Date) => number[] | null,
  observer: { latDeg: number; lonDeg: number; elevM?: number },
  pass: { startMs: number; endMs: number; peakMs: number },
  minElevDeg: number,
) => Arc;

export function useMapPause(open: OpenPassRow | null, { nowMs, timeZone, live = false, track, observer, minElevDeg = 0 }: {
  nowMs: number | null;
  timeZone?: string;
  live?: boolean;
  /** The open row's satellite, to find the whole arc (rise to set) and its closest point. */
  track?: { ecefAt: (d: Date) => number[] | null } | null;
  observer?: { latDeg: number; lonDeg: number; elevM?: number } | null;
  minElevDeg?: number;
}): { mapNowMs: number | null; mapPass: MapPass | null } {
  const pause = useMapClock((s) => s.pause);
  const clear = useMapClock((s) => s.clear);
  const paused = useMapClock((s) => s.paused);
  // A live view open anywhere (a phone's full-screen one too) keeps it live.
  const liveView = useMapClock((s) => s.liveView);
  live = live || liveView;
  const row = open?.pass ?? null;
  // The whole arc and the closest point. A visual row's times are only the
  // part you can see, which can start or stop mid-sky.
  const obsLat = observer?.latDeg;
  const obsLon = observer?.lonDeg;
  // The site's height: the arc and the circle use it as the pass search does.
  const obsElev = observer?.elevM ?? 0;
  const arc = useMemo<Arc | null>(() => {
    if (!row || !track || obsLat == null || obsLon == null) return null;
    try {
      return arcOf(track.ecefAt, { latDeg: obsLat, lonDeg: obsLon, elevM: obsElev }, row, minElevDeg);
    } catch {
      return null;
    }
    // The row by its times, not its identity (rows rebuild each minute).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, obsLat, obsLon, obsElev, minElevDeg, row?.startMs, row?.endMs, row?.peakMs]);
  const p = row && (arc ? { startMs: arc.riseMs, endMs: arc.setMs, peakMs: arc.closestMs } : row);
  // The visibility circle, traced with the same elevation math, at the
  // satellite's mean height where it rises and sets.
  const rings = useMemo(() => {
    if (!arc || !track || obsLat == null || obsLon == null) return null;
    const alts = [arc.riseMs, arc.setMs]
      .map((ms) => track.ecefAt(new Date(ms)))
      .filter((e): e is number[] => e != null)
      .map((e) => (subpoint as (v: number[]) => { altKm: number })(e).altKm);
    if (!alts.length) return null;
    const alt = alts.reduce((a, b) => a + b, 0) / alts.length;
    const ringAt = visibilityRing as (o: { latDeg: number; lonDeg: number; elevM?: number }, altKm: number, minElevDeg: number) => number[][];
    const site = { latDeg: obsLat, lonDeg: obsLon, elevM: obsElev };
    // With a lowest pass setting above 0, the horizon too, drawn faint: what
    // is physically up, around what the list shows.
    return { ring: ringAt(site, alt, minElevDeg), horizon: minElevDeg > 0 ? ringAt(site, alt, 0) : null };
  }, [arc, track, obsLat, obsLon, obsElev, minElevDeg]);
  const ring = rings?.ring ?? null;
  const ringHorizon = rings?.horizon ?? null;
  const upNow = p != null && nowMs != null && p.startMs <= nowMs && nowMs < p.endMs;
  const key = open && p && !upNow && !live ? open.key : null;
  const peakMs = p?.peakMs ?? null;
  const zone = timeZone ?? open?.timeZone;
  useEffect(() => {
    if (key == null || peakMs == null) clear();
    else pause({ key, atMs: peakMs, label: passTimeZoned(peakMs, zone) });
  }, [key, peakMs, zone, pause, clear]);
  useEffect(() => () => useMapClock.getState().clear(), []);
  const isPaused = paused != null && key != null && paused.key === key;
  const mapPass = open && p ? {
    noradId: open.noradId, startMs: p.startMs, endMs: p.endMs, peakMs: p.peakMs,
    paused: isPaused, ring, ringHorizon,
    // The card's own rise and set when they are the same moment (within a
    // minute and a half, rounding apart), so the map and the card agree.
    riseLabel: passTimeZoned(row && Math.abs(row.startMs - p.startMs) <= SAME_MS ? row.startMs : p.startMs, zone),
    setLabel: passTimeZoned(row && Math.abs(row.endMs - p.endMs) <= SAME_MS ? row.endMs : p.endMs, zone),
  } : null;
  // Paused only while the store is paused for this very row: closing the row
  // (or Back to live) goes live in the same render that brings the other
  // satellites' tracks back, so they never draw a frame at the paused time.
  return { mapNowMs: isPaused ? paused.atMs : nowMs, mapPass };
}
