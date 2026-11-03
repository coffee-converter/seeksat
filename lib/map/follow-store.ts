// lib/map/follow-store.ts - Whether the map camera follows the focused
// satellite. FlatMap sets and clears it; the focus bar can toggle it.
// satview mirrors FlatMap's effective view: Satellite's view always follows,
// so the focus bar shows the lock as on and fixed there.

import { create } from "zustand";

export interface FollowState {
  following: boolean;
  setFollowing(on: boolean): void;
  satview: boolean;
  setSatview(on: boolean): void;
}

export const useFollow = create<FollowState>((set) => ({
  following: false,
  setFollowing: (on) => set({ following: on }),
  satview: false,
  setSatview: (on) => set({ satview: on }),
}));
