// lib/map/scene-store.ts - The map scene the shared MapShell draws.
//
// A page publishes its scene with usePublishMapScene. The shell, which stays
// mounted across home and satellite pages, reads it from useMapScene.

import type { ReactNode } from "react";
import { useEffect } from "react";
import { create } from "zustand";
import type { FlatMapProps } from "../../components/home/FlatMap";

export interface MapScene extends Pick<
  FlatMapProps,
  "sats" | "observer" | "projectionId" | "onProjectionChange"
  | "selectedId" | "minElevDeg" | "onSelect" | "top" | "chips"
> {
  /** Content above the map, inside .map-shell__map. */
  above?: ReactNode;
  search: { onView(noradId: number): void; onClearFocus(): void };
  notice?: ReactNode;
  offlineFromCache?: boolean;
  /** Extra class for the shell, for example "home-first-visit". */
  shellClass?: string;
}

interface MapSceneState {
  scene: MapScene | null;
  setScene(s: MapScene): void;
}

export const useMapScene = create<MapSceneState>((set) => ({
  scene: null,
  setScene: (s) => set({ scene: s }),
}));

/** Publishes the scene on every render. Never clears it on unmount.
 *  While `ready` is false the previous scene stays, so a page whose state
 *  is still syncing from the URL does not flash a stale scene. */
export function usePublishMapScene(scene: MapScene, ready = true): void {
  const setScene = useMapScene((s) => s.setScene);
  useEffect(() => {
    if (ready) setScene(scene);
  });
}
