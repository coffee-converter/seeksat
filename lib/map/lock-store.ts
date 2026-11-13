// lib/map/lock-store.ts - Lock on: whether the map camera stays on the
// focused satellite. FlatMap sets and clears it; its Lock on button toggles it.

import { create } from "zustand";

export interface LockState {
  locked: boolean;
  setLocked(on: boolean): void;
  /** Bumped to ask the map to zoom so the followed satellite's footprint
   *  fills the view (the docked live view does, as it locks on). */
  fitTick: number;
  fitFootprint(): void;
  /** Bumped to ask the map to centre on you (the current place picked again). */
  homeTick: number;
  centreHome(): void;
}

export const useLock = create<LockState>((set) => ({
  locked: false,
  setLocked: (on) => set({ locked: on }),
  fitTick: 0,
  fitFootprint: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  homeTick: 0,
  centreHome: () => set((s) => ({ homeTick: s.homeTick + 1 })),
}));
