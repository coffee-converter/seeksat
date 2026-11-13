// lib/map/follow-store.ts - Whether the map camera follows the focused
// satellite. FlatMap sets and clears it; the focus bar can toggle it.

import { create } from "zustand";

export interface FollowState {
  following: boolean;
  setFollowing(on: boolean): void;
  /** Bumped to ask the map to zoom so the followed satellite's footprint
   *  fills the view (the docked live view does, as it locks on). */
  fitTick: number;
  fitFootprint(): void;
}

export const useFollow = create<FollowState>((set) => ({
  following: false,
  setFollowing: (on) => set({ following: on }),
  fitTick: 0,
  fitFootprint: () => set((s) => ({ fitTick: s.fitTick + 1 })),
}));
