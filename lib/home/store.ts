// lib/home/store.ts - Zustand store for the home screen.
//
// SSR-safe: nothing touches localStorage at module load. The component calls
// hydrate() once from a client effect. The store has no DOM listeners; wire
// watchVisibility() to document.visibilitychange from the component.

import { create } from "zustand";
import {
  addCustomTo, addObserverTo, createLoadGuard, followIn, isStale, removeObserverFrom, toggleHiddenIn, unfollowIn,
} from "./actions.mjs";
import { PREFS_KEY, defaultPrefs, loadPrefs, parsePrefs, savePrefs } from "./prefs.mjs";
import { localStore } from "../safe-storage.mjs";
import { DEFAULT_PROJECTION, defaultProjectionFor } from "../map/view.mjs";
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
  /** In the store, always the view to draw. Saved only once the visitor
   *  picks one (projectionChosen); until then storage holds null. */
  projection: string;
  /** The sky type the visual rating uses (lib/sky/visual-rating.mjs SKY_TYPES). */
  skyType: string;
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
  /** False while prefs.projection is the device default, not a saved choice. */
  projectionChosen: boolean;
  records: Map<number, SatApiRecord>;
  missing: number[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  lastLoadedMs: number | null;
  /** True when the last load was a copy the service worker saved (offline). */
  fromCache: boolean;
  /** When the server built the snapshot the last load came from. */
  generatedAtMs: number | null;
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
  prefs: { ...defaultPrefs(), projection: DEFAULT_PROJECTION } as Prefs,
  hydrated: false,
  projectionChosen: false,
  records: new Map(),
  missing: [],
  status: "idle",
  error: null,
  lastLoadedMs: null,
  fromCache: false,
  generatedAtMs: null,
  focusId: null,
  viewing: null,

  hydrate: () => {
    if (get().hydrated) return;
    const loaded = loadPrefs() as Omit<Prefs, "projection"> & { projection: string | null };
    // Resolved once per page load: the map persists across pages, so a later
    // resize or rotation never switches the view by itself.
    const projection = loaded.projection
      ?? (typeof window === "undefined" ? DEFAULT_PROJECTION : defaultProjectionFor({ width: window.innerWidth, height: window.innerHeight }));
    set({ prefs: { ...loaded, projection }, projectionChosen: loaded.projection != null, hydrated: true });
  },

  setPrefs: (patch) => {
    get().hydrate();
    // Apply the patch to what is saved now, not to this tab's copy: another
    // tab may have changed other settings since this one loaded.
    const { projection: savedProjection = null, ...saved } = storedPrefs() ?? {};
    const prefs = { ...get().prefs, ...saved, ...patch };
    const projectionChosen = get().projectionChosen || "projection" in patch;
    set({ prefs, projectionChosen });
    // Not yet picked here: keep whatever view another tab saved.
    lastSaveFailed = !savePrefs(projectionChosen ? prefs : { ...prefs, projection: savedProjection });
  },

  loadRecords: async () => {
    get().hydrate();
    const isLatest = loadGuard.begin();
    const { custom, following } = get().prefs;
    const pasted = new Set(custom.map((c) => c.noradId));
    const ids = following.filter((id) => !pasted.has(id));
    set({ status: "loading", error: null });
    try {
      const { records, missing, fromCache, generatedAtMs } = ids.length
        ? await fetchRecords(ids)
        : { records: new Map(), missing: [], fromCache: false, generatedAtMs: null };
      if (isLatest()) set({ records, missing, fromCache, generatedAtMs, status: "ready", lastLoadedMs: Date.now() });
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

// True when this tab's last save did not land (storage full): its copy is
// then newer than storage, so it stands.
let lastSaveFailed = false;

/** The prefs as saved now (projection null when none was picked), or null
 *  when there is nothing to go by: storage out of reach, no saved prefs, an
 *  unreadable value, or this tab's last save failed. This tab's copy stands then. */
function storedPrefs(): (Omit<Prefs, "projection"> & { projection: string | null }) | null {
  const store = localStore();
  if (!store || lastSaveFailed) return null;
  let raw: string | null;
  try {
    raw = store.getItem(PREFS_KEY);
    if (raw == null) return null;
    JSON.parse(raw);
  } catch {
    return null;
  }
  return parsePrefs(raw) as Omit<Prefs, "projection"> & { projection: string | null };
}

/** Take in prefs another tab saved; returns a cleanup. The map's projection
 *  stays this tab's, so another tab never switches the view under it. */
export function watchPrefs(win: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== PREFS_KEY) return;
    const st = useHomeStore.getState();
    if (!st.hydrated) return;
    const { projection: _p, ...rest } = parsePrefs(e.key === null ? null : e.newValue) as Prefs;
    useHomeStore.setState({ prefs: { ...st.prefs, ...rest } });
    // A satellite followed over there needs its record here too.
    if (rest.following.some((id) => !st.prefs.following.includes(id))) void useHomeStore.getState().loadRecords();
  };
  win.addEventListener("storage", onStorage);
  return () => win.removeEventListener("storage", onStorage);
}

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
