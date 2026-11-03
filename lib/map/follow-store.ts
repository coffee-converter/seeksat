// lib/map/follow-store.ts - Whether the map camera follows the focused
// satellite. FlatMap sets and clears it; the focus bar can toggle it.

import { create } from "zustand";

export interface FollowState {
  following: boolean;
  setFollowing(on: boolean): void;
}

export const useFollow = create<FollowState>((set) => ({
  following: false,
  setFollowing: (on) => set({ following: on }),
}));
