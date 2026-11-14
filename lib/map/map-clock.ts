// lib/map/map-clock.ts - The map's clock: live, or paused at an opened
// pass's highest point. The page that owns the pass list pauses and clears
// it; the map, its dots and night shading, and the header clock read it.
// "Back to live" on the map clears it and bumps resumeTick, so the list can
// close the row it was paused for.

import { create } from "zustand";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";

export interface MapPause {
  /** The paused time: the pass's highest point. */
  atMs: number;
  /** The row it is paused for, so a new row reframes the map. */
  key: string;
  /** "5:46 PM", in the place's time zone, for the map's chip. */
  label: string;
}

export interface MapClockState {
  paused: MapPause | null;
  /** Bumped by Back to live (not by clear), so the list closes its row. */
  resumeTick: number;
  /** A live view is open (docked or full screen): the map stays live. */
  liveView: boolean;
  setLiveView(open: boolean): void;
  pause(p: MapPause): void;
  /** The list closed its row, or the page went away. */
  clear(): void;
  /** The viewer asked to go back to live. */
  backToLive(): void;
}

export const useMapClock = create<MapClockState>((set, get) => ({
  paused: null,
  resumeTick: 0,
  liveView: false,
  setLiveView: (open) => {
    if (get().liveView !== open) set({ liveView: open });
  },
  pause: (p) => {
    const cur = get().paused;
    if (cur && cur.key === p.key && cur.atMs === p.atMs && cur.label === p.label) return;
    set({ paused: p });
  },
  clear: () => {
    if (get().paused) set({ paused: null });
  },
  backToLive: () => set((s) => ({ paused: null, resumeTick: s.resumeTick + 1 })),
}));

/** The map's now: the paused time, else the true clock. */
export function mapNow(): number {
  return useMapClock.getState().paused?.atMs ?? trueNow();
}
