// lib/pass-finder-store.ts — Zustand store for the pass-finder page.
//
// Owns the React-visible slices of state: mode toggle, min elevation,
// TLE form. The bulky observer / windows / cloud-forecast state still
// lives inside lib/pass-finder-scene.js for now; future slices will
// migrate one panel at a time, same pattern as the triangulate page.

import { create } from "zustand";
import type { Tle } from "./types";

export type PassMode = "visual" | "radio";

/** One pass-finder observer station (lighter than the triangulate
 *  observer — no direction, just a location + cosmetic info). */
export interface PassObserver {
  id: string;
  name: string;
  /** Hex color from PALETTE — used for the polar plot arc + pin. */
  color: string;
  latDeg: number;
  lonDeg: number;
  /** IANA timezone resolved lazily after add; null until then. */
  tz?: string;
}

/** One row in the passes table. The bootstrap pre-computes all the
 *  rating / color / formatted text per cell so the React renderer is
 *  pure presentation — keeps every domain function (passSuccessProb,
 *  altitudeFactor, ratingCssColor, …) inside the scene island. */
export interface WindowCell {
  /** CSS class — drives column-specific styling (rating / time /
   *  dur / alt / mag / sun / cloud). */
  className: string;
  text: string;
  color?: string;
  title?: string;
  /** Set when the cell renders "—" because data isn't available. */
  na?: boolean;
}
export interface WindowDisplayRow {
  startMs: number;
  cells: WindowCell[];
}

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
  /** All observer stations (mirrored from the scene's state object;
   *  the React observers list reads from here). */
  observers: PassObserver[];
  /** Currently locked-in first-person observer (null = free camera). */
  fpsObserverId: string | null;
  /** Headers + pre-computed display rows for the passes table. The
   *  scene publishes here after each search; React renders. */
  windowHeaders: string[];
  windowRows: WindowDisplayRow[];
  /** Drives the placeholder rendered when no rows are present:
   *   loading      → first paint, before any search has run
   *   searching    → search in flight + no prior results to keep
   *   no-observers → user has zero stations placed
   *   empty        → search ran, found zero joint passes
   *   ready        → render windowRows */
  windowsStatus:
    | "loading"
    | "searching"
    | "no-observers"
    | "empty"
    | "ready";
  /** Index into windowRows; -1 = nothing selected. Written by BOTH the
   *  per-frame soft-tracker (reflecting the clock's current window) and
   *  explicit user picks. The scene can't tell those apart from the
   *  index alone, so user picks bump windowSelectNonce too. */
  activeWindowIdx: number;
  /** Bumped on every explicit user selection (row click / keyboard /
   *  Now-deselect). The scene jumps ONLY when this changes, so clicking
   *  the already-soft-tracked row still triggers a jump. */
  windowSelectNonce: number;
  /** When set, the polar-modal renders for this observer id. */
  polarModalObsId: string | null;
  /** Left panel collapsed state — body.panel-collapsed mirror.
   *  Drives both the user-toggleable panel and the auto-collapse on
   *  narrow viewports when a pass is selected. */
  panelCollapsed: boolean;
  /** True once the first runSearch completes (success or empty).
   *  Drives the page loader's fade-out. */
  firstSearchComplete: boolean;
  // ---- Heatmap mode ----
  /** When true, the globe shows the regional pass-quality heatmap. */
  heatmapMode: boolean;
  /** Forecast window for the heatmap, in days. */
  heatmapWindowDays: 1 | 7 | 14;
  /** Which value paints each cell. */
  heatmapMetric: "count" | "bestP";
  /** Max good-pass count across the region — published by the scene
   *  after each compute so the legend can normalize/label. */
  heatmapMaxCount: number;
  /** False when no cloud forecast loaded for the region (legend note). */
  heatmapCloudAvailable: boolean;
  /** True while a heatmap compute is in flight (spinner in the legend). */
  heatmapComputing: boolean;

  // ---- Actions ----
  setMode: (mode: PassMode) => void;
  setMinElevDeg: (deg: number) => void;
  setTle: (tle: Partial<Tle>) => void;
  setTleStatus: (status: PassFinderState["tleStatus"]) => void;
  setClickToPlace: (on: boolean) => void;
  setObservers: (observers: PassObserver[]) => void;
  setFpsObserverId: (id: string | null) => void;
  setWindows: (
    headers: string[],
    rows: WindowDisplayRow[],
    status: PassFinderState["windowsStatus"],
  ) => void;
  setActiveWindowIdx: (idx: number) => void;
  /** Explicit user pick: sets the index AND bumps windowSelectNonce so
   *  the scene always runs jumpToWindow, even when idx is unchanged. */
  selectWindow: (idx: number) => void;
  setPolarModalObsId: (id: string | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setFirstSearchComplete: (done: boolean) => void;
  setHeatmapMode: (on: boolean) => void;
  setHeatmapWindowDays: (days: 1 | 7 | 14) => void;
  setHeatmapMetric: (metric: "count" | "bestP") => void;
  setHeatmapStats: (maxCount: number, cloudAvailable: boolean) => void;
  setHeatmapComputing: (computing: boolean) => void;
}

const EMPTY_TLE: Tle = { name: "", line1: "", line2: "" };

export const usePassFinderStore = create<PassFinderState>((set) => ({
  mode: "visual",
  minElevDeg: 10,
  tle: EMPTY_TLE,
  tleStatus: "idle",
  clickToPlace: false,
  observers: [],
  fpsObserverId: null,
  windowHeaders: [],
  windowRows: [],
  windowsStatus: "loading",
  activeWindowIdx: -1,
  windowSelectNonce: 0,
  polarModalObsId: null,
  panelCollapsed: false,
  firstSearchComplete: false,
  heatmapMode: false,
  heatmapWindowDays: 7,
  heatmapMetric: "count",
  heatmapMaxCount: 0,
  heatmapCloudAvailable: false,
  heatmapComputing: false,

  setMode: (mode) => set({ mode }),
  setMinElevDeg: (deg) => set({ minElevDeg: deg }),
  setTle: (patch) => set((s) => ({ tle: { ...s.tle, ...patch } })),
  setTleStatus: (status) => set({ tleStatus: status }),
  setClickToPlace: (on) => set({ clickToPlace: on }),
  setObservers: (observers) => set({ observers }),
  setFpsObserverId: (id) => set({ fpsObserverId: id }),
  setWindows: (windowHeaders, windowRows, windowsStatus) =>
    set({ windowHeaders, windowRows, windowsStatus }),
  setActiveWindowIdx: (activeWindowIdx) => set({ activeWindowIdx }),
  selectWindow: (idx) =>
    set((s) => ({ activeWindowIdx: idx, windowSelectNonce: s.windowSelectNonce + 1 })),
  setPolarModalObsId: (polarModalObsId) => set({ polarModalObsId }),
  setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
  setFirstSearchComplete: (firstSearchComplete) => set({ firstSearchComplete }),
  setHeatmapMode: (heatmapMode) => set({ heatmapMode }),
  setHeatmapWindowDays: (heatmapWindowDays) => set({ heatmapWindowDays }),
  setHeatmapMetric: (heatmapMetric) => set({ heatmapMetric }),
  setHeatmapStats: (heatmapMaxCount, heatmapCloudAvailable) =>
    set({ heatmapMaxCount, heatmapCloudAvailable }),
  setHeatmapComputing: (heatmapComputing) => set({ heatmapComputing }),
}));
