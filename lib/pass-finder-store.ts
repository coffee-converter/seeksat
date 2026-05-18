// lib/pass-finder-store.ts — Zustand store for the pass-finder page.
//
// Owns the React-visible slices of state: mode toggle, min elevation,
// TLE form. The bulky observer / windows / cloud-forecast state still
// lives inside lib/pass-finder-scene.js for now; future slices will
// migrate one panel at a time, same pattern as the triangulate page.

import { create } from "zustand";
import type { Tle } from "./types";

export type PassMode = "visual" | "radio";

export interface PassFinderState {
  /** Visual = ISS sunlit + observer in twilight; Radio = any sky pass
   *  ≥ minElevDeg with no sun/illumination gate. */
  mode: PassMode;
  /** Lower bound on apparent altitude every observer must clear. */
  minElevDeg: number;
  /** TLE in the right-side panel (live edit, shared across modes). */
  tle: Tle;
  /** Fetch status for the auto-loaded ISS TLE on first paint. */
  tleStatus: "idle" | "fetching" | "ready" | "error";
  /** When true, the next globe-click creates an observer at that
   *  ECEF point instead of doing normal camera interactions. */
  clickToPlace: boolean;

  // ---- Actions ----
  setMode: (mode: PassMode) => void;
  setMinElevDeg: (deg: number) => void;
  setTle: (tle: Partial<Tle>) => void;
  setTleStatus: (status: PassFinderState["tleStatus"]) => void;
  setClickToPlace: (on: boolean) => void;
}

const EMPTY_TLE: Tle = { name: "", line1: "", line2: "" };

export const usePassFinderStore = create<PassFinderState>((set) => ({
  mode: "visual",
  minElevDeg: 10,
  tle: EMPTY_TLE,
  tleStatus: "idle",
  clickToPlace: false,

  setMode: (mode) => set({ mode }),
  setMinElevDeg: (deg) => set({ minElevDeg: deg }),
  setTle: (patch) => set((s) => ({ tle: { ...s.tle, ...patch } })),
  setTleStatus: (status) => set({ tleStatus: status }),
  setClickToPlace: (on) => set({ clickToPlace: on }),
}));
