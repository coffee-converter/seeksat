// lib/home/store.ts - Zustand store for the home screen.
//
// SSR-safe: nothing touches localStorage at module load. The component calls
// hydrate() once from a client effect. The store has no DOM listeners; wire
// watchVisibility() to document.visibilitychange from the component.

import { create } from "zustand";
import { ElementsError, parseElements } from "../sat/elements.mjs";
import { defaultPrefs, loadPrefs, savePrefs } from "./prefs.mjs";
import { fetchRecords } from "./records.mjs";

export interface HomeLocation {
  name: string;
  latDeg: number;
  lonDeg: number;
  source: "gps" | "place" | "grid" | "coords";
}
export interface CustomElements {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
}
export interface Prefs {
  location: HomeLocation | null;
  following: number[];
  custom: CustomElements[];
  mode: "radio" | "visual";
  minElevDeg: number;
  projection: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SatApiRecord = Record<string, any>;

export const STALE_AFTER_MS = 60 * 60 * 1000;
const MAX_FOLLOWING = 20;
const MAX_CUSTOM = 10;

interface HomeState {
  prefs: Prefs;
  hydrated: boolean;
  records: Map<number, SatApiRecord>;
  missing: number[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  lastLoadedMs: number | null;
  selectedId: number | null;
  hydrate: () => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  loadRecords: () => Promise<void>;
  reloadIfStale: (nowMs: number) => Promise<void>;
  setSelectedId: (id: number | null) => void;
  follow: (id: number) => void;
  unfollow: (id: number) => void;
  addCustom: (text: string) => { ok: true } | { ok: false; message: string };
}

export const useHomeStore = create<HomeState>((set, get) => ({
  prefs: defaultPrefs() as Prefs,
  hydrated: false,
  records: new Map(),
  missing: [],
  status: "idle",
  error: null,
  lastLoadedMs: null,
  selectedId: null,

  hydrate: () => {
    if (get().hydrated) return;
    set({ prefs: loadPrefs() as Prefs, hydrated: true });
  },

  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    savePrefs(prefs);
  },

  loadRecords: async () => {
    const { custom, following } = get().prefs;
    const pasted = new Set(custom.map((c) => c.noradId));
    const ids = following.filter((id) => !pasted.has(id));
    set({ status: "loading", error: null });
    try {
      const { records, missing } = ids.length
        ? await fetchRecords(ids)
        : { records: new Map(), missing: [] };
      set({ records, missing, status: "ready", lastLoadedMs: Date.now() });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  reloadIfStale: async (nowMs) => {
    const { status, lastLoadedMs } = get();
    if (status === "loading" || lastLoadedMs === null) return;
    if (nowMs - lastLoadedMs > STALE_AFTER_MS) await get().loadRecords();
  },

  setSelectedId: (id) => set({ selectedId: id }),

  follow: (id) => {
    const { following } = get().prefs;
    if (following.includes(id) || following.length >= MAX_FOLLOWING) return;
    get().setPrefs({ following: [...following, id] });
    void get().loadRecords();
  },

  unfollow: (id) => {
    const { following, custom } = get().prefs;
    get().setPrefs({
      following: following.filter((f) => f !== id),
      custom: custom.filter((c) => c.noradId !== id),
    });
    if (get().selectedId === id) set({ selectedId: null });
  },

  addCustom: (text) => {
    let rec;
    try {
      rec = parseElements(text);
    } catch (e) {
      if (e instanceof ElementsError) return { ok: false, message: e.message };
      throw e;
    }
    const { custom, following } = get().prefs;
    const others = custom.filter((c) => c.noradId !== rec.noradId);
    if (others.length >= MAX_CUSTOM) {
      return { ok: false, message: "You can paste up to 10 satellites. Remove one first." };
    }
    const nextFollowing = following.includes(rec.noradId) ? following : [...following, rec.noradId];
    if (nextFollowing.length > MAX_FOLLOWING) {
      return { ok: false, message: "You can follow up to 20 satellites. Unfollow one first." };
    }
    get().setPrefs({
      custom: [...others, { noradId: rec.noradId, name: rec.name, line1: rec.line1, line2: rec.line2 }],
      following: nextFollowing,
    });
    return { ok: true };
  },
}));

/** Wire to document.visibilitychange from the component; returns a cleanup. */
export function watchVisibility(
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
  now: () => number = Date.now,
): () => void {
  const onChange = () => {
    if (doc.visibilityState === "visible") void useHomeStore.getState().reloadIfStale(now());
  };
  doc.addEventListener("visibilitychange", onChange);
  return () => doc.removeEventListener("visibilitychange", onChange);
}
