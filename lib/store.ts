// lib/store.ts — Zustand store for the triangulate page.
//
// State + mutating actions for everything the page tracks:
//  - the current attempt (manifest or user-created)
//  - the observations array
//  - the TLE in the right-side panel
//  - the refraction toggle
//
// Computed values (triangulation point, residuals) are derived in
// selectors so we don't have to remember to call setters in lockstep
// with their inputs.
//
// localStorage persistence mirrors the legacy scheme so existing
// browser data survives the React port:
//   - USER_ATTEMPTS_KEY: array of UserAttemptEntry (without source).
//   - MANIFEST_OVERRIDES_KEY: { [manifestId]: AttemptData } overlay
//     applied on top of the read-only /data/<file>.json payloads.

import { create } from "zustand";
import type {
  AttemptData,
  AttemptEntry,
  Observation,
  Residual,
  Tle,
  UserAttemptEntry,
} from "./types";

export const USER_ATTEMPTS_KEY = "triangulation-user-attempts";
export const MANIFEST_OVERRIDES_KEY = "triangulation-manifest-overrides";

// Color palette assigned to new observations in rotation. Lifted from
// legacy/app.js so existing attempt JSON keeps its expected colors.
export const PALETTE = [
  "#ff6b6b", "#fcd34d", "#34d399", "#60a5fa",
  "#a78bfa", "#f472b6", "#22d3ee", "#facc15",
];

export interface TriangulateState {
  /** All known attempts (manifest + user), in display order. */
  attempts: AttemptEntry[];
  /** Currently selected attempt id, null while loading. */
  currentAttemptId: string | null;
  /** Time the attempt is centered on (ISO UTC). */
  timestampUTC: string;
  /** Observations being triangulated. */
  observations: Observation[];
  /** TLE in the right-side panel (live edit, not yet committed to attempt). */
  tle: Tle;
  /** Apply Bennett refraction correction to apparent altitudes. */
  refractionEnabled: boolean;
  /** Cached triangulated point (ECEF, meters) — null when degenerate. */
  triangulated: [number, number, number] | null;
  /** Per-observation angular residual in degrees. */
  residuals: Residual[];

  // ---- Actions ----
  setAttempts: (attempts: AttemptEntry[]) => void;
  selectAttempt: (id: string) => void;
  applyAttemptData: (data: AttemptData) => void;
  setTimestamp: (utc: string) => void;
  setRefractionEnabled: (on: boolean) => void;
  setTle: (tle: Partial<Tle>) => void;
  clearTle: () => void;
  setObservations: (next: Observation[]) => void;
  updateObservation: (id: string, patch: Partial<Observation>) => void;
  addObservation: () => void;
  removeObservation: (id: string) => void;
  setTriangulationResult: (
    point: [number, number, number] | null,
    residuals: Residual[],
  ) => void;
}

const EMPTY_TLE: Tle = { name: "", line1: "", line2: "" };

export const useTriangulateStore = create<TriangulateState>((set, get) => ({
  attempts: [],
  currentAttemptId: null,
  timestampUTC: "",
  observations: [],
  tle: EMPTY_TLE,
  refractionEnabled: true,
  triangulated: null,
  residuals: [],

  setAttempts: (attempts) => set({ attempts }),

  selectAttempt: (id) => {
    const e = get().attempts.find((a) => a.id === id);
    if (!e) return;
    set({ currentAttemptId: id });
  },

  applyAttemptData: (data) =>
    set({
      timestampUTC: data.timestampUTC,
      observations: data.observations,
      tle: data.defaultTle ?? EMPTY_TLE,
      triangulated: null,
      residuals: [],
    }),

  setTimestamp: (utc) => set({ timestampUTC: utc }),
  setRefractionEnabled: (on) => set({ refractionEnabled: on }),

  setTle: (patch) => set((s) => ({ tle: { ...s.tle, ...patch } })),
  clearTle: () => set({ tle: EMPTY_TLE }),

  setObservations: (next) => set({ observations: next }),

  updateObservation: (id, patch) =>
    set((s) => ({
      observations: s.observations.map((o) =>
        o.id === id ? { ...o, ...patch } : o,
      ),
    })),

  addObservation: () =>
    set((s) => {
      const idx = s.observations.length;
      const obs: Observation = {
        id: `obs-${Date.now()}-${idx}`,
        name: `Obs ${idx + 1}`,
        color: PALETTE[idx % PALETTE.length],
        latDeg: null,
        lonDeg: null,
        dir: { mode: "radec", raHours: null, decDeg: null },
      };
      return { observations: [...s.observations, obs] };
    }),

  removeObservation: (id) =>
    set((s) => ({ observations: s.observations.filter((o) => o.id !== id) })),

  setTriangulationResult: (point, residuals) =>
    set({ triangulated: point, residuals }),
}));

// ---- localStorage helpers (mirror legacy/app.js so existing browser
// data survives the migration) ---------------------------------------

export function loadUserAttempts(): UserAttemptEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(USER_ATTEMPTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((a) => ({ ...a, source: "user" as const }));
  } catch {
    return [];
  }
}

export function saveUserAttempts(list: UserAttemptEntry[]): void {
  if (typeof localStorage === "undefined") return;
  // Drop transient `source` flag before serializing — it's derived
  // when loading.
  const serializable = list.map(({ source: _s, ...rest }) => rest);
  localStorage.setItem(USER_ATTEMPTS_KEY, JSON.stringify(serializable));
}

export function loadManifestOverrides(): Record<string, AttemptData> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(MANIFEST_OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveManifestOverride(id: string, data: AttemptData): void {
  if (typeof localStorage === "undefined") return;
  const all = loadManifestOverrides();
  all[id] = data;
  localStorage.setItem(MANIFEST_OVERRIDES_KEY, JSON.stringify(all));
}
