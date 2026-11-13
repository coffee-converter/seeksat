// lib/map/use-map-pause.ts - Pause the map at an opened pass's highest point.
// Shared by the home and satellite pages: the page reports its open row, and
// this keeps the map clock (lib/map/map-clock.ts) in step with it.
"use client";

import { useEffect } from "react";
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
export function useMapPause(open: OpenPassRow | null, { nowMs, timeZone, live = false }: {
  nowMs: number | null;
  timeZone?: string;
  live?: boolean;
}): { mapNowMs: number | null; mapPass: MapPass | null } {
  const pause = useMapClock((s) => s.pause);
  const clear = useMapClock((s) => s.clear);
  const paused = useMapClock((s) => s.paused);
  const p = open?.pass ?? null;
  const upNow = p != null && nowMs != null && p.startMs <= nowMs && nowMs < p.endMs;
  const key = open && p && !upNow && !live ? open.key : null;
  const peakMs = p?.peakMs ?? null;
  const zone = timeZone ?? open?.timeZone;
  useEffect(() => {
    if (key == null || peakMs == null) clear();
    else pause({ key, atMs: peakMs, label: passTime(peakMs, zone) });
  }, [key, peakMs, zone, pause, clear]);
  useEffect(() => () => useMapClock.getState().clear(), []);
  const mapPass = open && p ? { noradId: open.noradId, startMs: p.startMs, endMs: p.endMs, peakMs: p.peakMs } : null;
  return { mapNowMs: paused?.atMs ?? nowMs, mapPass };
}
