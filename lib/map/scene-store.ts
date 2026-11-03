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
  "sats" | "observer" | "selectedSub" | "projectionId" | "onProjectionChange"
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

/** Publishes the scene on every render. Never clears it on unmount. */
export function usePublishMapScene(scene: MapScene): void {
  const setScene = useMapScene((s) => s.setScene);
  useEffect(() => {
    setScene(scene);
  });
}
