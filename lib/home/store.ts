// lib/home/store.ts - Zustand store for the home screen.
//
// SSR-safe: nothing touches localStorage at module load. The component calls
// hydrate() once from a client effect. The store has no DOM listeners; wire
// watchVisibility() to document.visibilitychange from the component.

import { create } from "zustand";
import {
  addCustomTo, addObserverTo, createLoadGuard, followIn, isStale, removeObserverFrom, toggleHiddenIn, unfollowIn,
} from "./actions.mjs";
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
export interface ExtraObserver {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
}
export interface Prefs {
  location: HomeLocation | null;
  following: number[];
  custom: CustomElements[];
  mode: "radio" | "visual";
  minElevDeg: number;
  projection: string;
  observers: ExtraObserver[];
  /** Followed ids not drawn on the map unless focused. */
  hidden: number[];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SatApiRecord = Record<string, any>;

const loadGuard = createLoadGuard();
const viewGuard = createLoadGuard();

interface HomeState {
  prefs: Prefs;
  hydrated: boolean;
  records: Map<number, SatApiRecord>;
  missing: number[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  lastLoadedMs: number | null;
  /** The focused satellite (selected means focused). On / it mirrors ?focus=. */
  focusId: number | null;
  /** The record of a focused satellite that is not followed, opened from search. */
  viewing: SatApiRecord | null;
  hydrate: () => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  loadRecords: () => Promise<void>;
  reloadIfStale: (nowMs: number) => Promise<void>;
  setFocusId: (id: number | null) => void;
  /** Make sure a non-followed focus has its record, fetching it when needed. */
  loadViewing: (id: number) => Promise<void>;
  toggleHidden: (id: number) => void;
  follow: (id: number) => void;
  unfollow: (id: number) => void;
  addCustom: (text: string) => { ok: true } | { ok: false; message: string };
  addObserver: (loc: { name: string; latDeg: number; lonDeg: number }) => { ok: true } | { ok: false; message: string };
  removeObserver: (id: string) => void;
}

export const useHomeStore = create<HomeState>((set, get) => ({
  prefs: defaultPrefs() as Prefs,
  hydrated: false,
  records: new Map(),
  missing: [],
  status: "idle",
  error: null,
  lastLoadedMs: null,
  focusId: null,
  viewing: null,

  hydrate: () => {
    if (get().hydrated) return;
    set({ prefs: loadPrefs() as Prefs, hydrated: true });
  },

  setPrefs: (patch) => {
    get().hydrate();
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    savePrefs(prefs);
  },

  loadRecords: async () => {
    get().hydrate();
    const isLatest = loadGuard.begin();
    const { custom, following } = get().prefs;
    const pasted = new Set(custom.map((c) => c.noradId));
    const ids = following.filter((id) => !pasted.has(id));
    set({ status: "loading", error: null });
    try {
      const { records, missing } = ids.length
        ? await fetchRecords(ids)
        : { records: new Map(), missing: [] };
      if (isLatest()) set({ records, missing, status: "ready", lastLoadedMs: Date.now() });
    } catch (e) {
      if (isLatest()) set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  reloadIfStale: async (nowMs) => {
    const { status, lastLoadedMs } = get();
    if (status === "loading" || status === "idle") return;
    if (isStale(lastLoadedMs, nowMs)) await get().loadRecords();
  },

  setFocusId: (id) => {
    if (get().focusId !== id) set({ focusId: id });
  },

  loadViewing: async (id) => {
    get().hydrate();
    const isLatest = viewGuard.begin();
    if (get().prefs.following.includes(id)) return;
    if (get().viewing?.noradId === id) return;
    const known = get().records.get(id);
    if (known) {
      set({ viewing: known });
      return;
    }
    try {
      const { records } = await fetchRecords([id]);
      const rec = records.get(id);
      if (rec && isLatest()) set({ viewing: rec });
    } catch {
      // The focus bar still names it; the map just has nothing to draw.
    }
  },

  toggleHidden: (id) => {
    get().hydrate();
    get().setPrefs({ hidden: toggleHiddenIn(get().prefs, id).hidden });
  },

  follow: (id) => {
    get().hydrate();
    const next = followIn(get().prefs, id);
    if (next === get().prefs) return;
    get().setPrefs({ following: next.following });
    void get().loadRecords();
  },

  unfollow: (id) => {
    get().hydrate();
    const next = unfollowIn(get().prefs, id);
    // A focused satellite stays on the map as a viewing one.
    const rec = get().records.get(id);
    if (rec && get().focusId === id) set({ viewing: rec });
    get().setPrefs({ following: next.following, custom: next.custom, hidden: next.hidden });
  },

  addCustom: (text) => {
    get().hydrate();
    const { prefs, result } = addCustomTo(get().prefs, text);
    if (result.ok) get().setPrefs({ custom: prefs.custom, following: prefs.following });
    return result as { ok: true } | { ok: false; message: string };
  },

  addObserver: (loc) => {
    get().hydrate();
    const r = addObserverTo(get().prefs, loc);
    if (r.error !== undefined) return { ok: false, message: r.error };
    get().setPrefs({ observers: r.prefs.observers });
    return { ok: true };
  },

  removeObserver: (id) => {
    get().hydrate();
    get().setPrefs({ observers: removeObserverFrom(get().prefs, id).observers });
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
