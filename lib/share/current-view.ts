// lib/share/current-view.ts - The link for the view on screen now: the map
// type, camera, followed and hidden satellites and mode, never a location.
// Called from click handlers (reads window and the stores).

import { useHomeStore } from "@/lib/home/store";
import { currentCamera } from "@/lib/map/share-camera";
import { linkPath, viewUrl } from "./view-link.mjs";

// The radio chart's picked frequency on a satellite page, for its link.
let freqHz: number | null = null;
export function setLinkFreq(hz: number | null): void {
  freqHz = hz;
}

export function currentViewUrl(pathname = window.location.pathname): string {
  const { prefs } = useHomeStore.getState();
  // Pasted elements are not in the catalog, so the link cannot carry them.
  const pasted = new Set(prefs.custom.map((c) => c.noradId));
  const path = linkPath(pathname);
  const cam = currentCamera();
  // Lock on follows the page's satellite: there is none on the home map.
  const lock = path !== "/" && (cam?.lock ?? false);
  return viewUrl(window.location.origin, path, {
    projection: prefs.projection,
    lock,
    zoom: cam?.zoom ?? null,
    center: cam?.center ?? null,
    following: prefs.following.filter((id) => !pasted.has(id)),
    hidden: prefs.hidden,
    mode: prefs.mode,
    freqHz: path === "/" ? null : freqHz,
  });
}
