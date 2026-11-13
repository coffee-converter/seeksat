// lib/live/dock-store.ts - Which satellite's live view is docked in the
// desktop panel, if any. The live view sets it while docked; the home page
// selects that satellite on the map and the shell locks the camera on it.

import { create } from "zustand";

/** The element in .map-shell__panel the docked live view renders into. */
export const LIVE_DOCK_HOST_ID = "live-dock-host";

export interface LiveDockState {
  noradId: number | null;
  setNoradId(id: number | null): void;
}

export const useLiveDock = create<LiveDockState>((set) => ({
  noradId: null,
  setNoradId: (id) => set({ noradId: id }),
}));
