// lib/map/use-map-pause.ts - Pause the map at an opened pass's highest point.
// Shared by the home and satellite pages: the page reports its open row, and
// this keeps the map clock (lib/map/map-clock.ts) in step with it.
"use client";

import { useEffect, useMemo } from "react";
import { passArc, visibilityRing } from "./pass-arc.mjs";
import { subpoint } from "./geometry.mjs";
import { useMapClock } from "./map-clock";
import { passTime } from "@/components/passes/PassStats";
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
type Arc = { riseMs: number; setMs: number; closestMs: number };
const arcOf = passArc as (
  ecefAt: (d: Date) => number[] | null,
  observer: { latDeg: number; lonDeg: number },
  pass: { startMs: number; endMs: number; peakMs: number },
  minElevDeg: number,
) => Arc;

export function useMapPause(open: OpenPassRow | null, { nowMs, timeZone, live = false, track, observer, minElevDeg = 0 }: {
  nowMs: number | null;
  timeZone?: string;
  live?: boolean;
  /** The open row's satellite, to find the whole arc (rise to set) and its closest point. */
  track?: { ecefAt: (d: Date) => number[] | null } | null;
  observer?: { latDeg: number; lonDeg: number } | null;
  minElevDeg?: number;
}): { mapNowMs: number | null; mapPass: MapPass | null } {
  const pause = useMapClock((s) => s.pause);
  const clear = useMapClock((s) => s.clear);
  const paused = useMapClock((s) => s.paused);
  const row = open?.pass ?? null;
  // The whole arc and the closest point. A visual row's times are only the
  // part you can see, which can start or stop mid-sky.
  const obsLat = observer?.latDeg;
  const obsLon = observer?.lonDeg;
  const arc = useMemo<Arc | null>(() => {
    if (!row || !track || obsLat == null || obsLon == null) return null;
    try {
      return arcOf(track.ecefAt, { latDeg: obsLat, lonDeg: obsLon }, row, minElevDeg);
    } catch {
      return null;
    }
    // The row by its times, not its identity (rows rebuild each minute).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, obsLat, obsLon, minElevDeg, row?.startMs, row?.endMs, row?.peakMs]);
  const p = row && (arc ? { startMs: arc.riseMs, endMs: arc.setMs, peakMs: arc.closestMs } : row);
  // The visibility circle, traced with the same elevation math, at the
  // satellite's mean height where it rises and sets.
  const ring = useMemo(() => {
    if (!arc || !track || obsLat == null || obsLon == null) return null;
    const alts = [arc.riseMs, arc.setMs]
      .map((ms) => track.ecefAt(new Date(ms)))
      .filter((e): e is number[] => e != null)
      .map((e) => (subpoint as (v: number[]) => { altKm: number })(e).altKm);
    if (!alts.length) return null;
    const alt = alts.reduce((a, b) => a + b, 0) / alts.length;
    return (visibilityRing as (o: { latDeg: number; lonDeg: number }, altKm: number, minElevDeg: number) => number[][])(
      { latDeg: obsLat, lonDeg: obsLon }, alt, minElevDeg,
    );
  }, [arc, track, obsLat, obsLon, minElevDeg]);
  const upNow = p != null && nowMs != null && p.startMs <= nowMs && nowMs < p.endMs;
  const key = open && p && !upNow && !live ? open.key : null;
  const peakMs = p?.peakMs ?? null;
  const zone = timeZone ?? open?.timeZone;
  useEffect(() => {
    if (key == null || peakMs == null) clear();
    else pause({ key, atMs: peakMs, label: passTime(peakMs, zone) });
  }, [key, peakMs, zone, pause, clear]);
  useEffect(() => () => useMapClock.getState().clear(), []);
  const isPaused = paused != null && key != null && paused.key === key;
  const mapPass = open && p ? {
    noradId: open.noradId, startMs: p.startMs, endMs: p.endMs, peakMs: p.peakMs,
    paused: isPaused, ring, riseLabel: passTime(p.startMs, zone), setLabel: passTime(p.endMs, zone),
  } : null;
  // Paused only while the store is paused for this very row: closing the row
  // (or Back to live) goes live in the same render that brings the other
  // satellites' tracks back, so they never draw a frame at the paused time.
  const pausedHere = paused != null && key != null && paused.key === key;
  return { mapNowMs: pausedHere ? paused.atMs : nowMs, mapPass };
}
