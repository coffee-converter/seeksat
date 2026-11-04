// lib/map/share-camera.ts - The map camera for a shared view. FlatMap
// registers a reader so a Share button anywhere can put the camera in its
// link, and takes a pending camera that a shared link opened with.

/** zoom is latitude-free on the globe (FlatMap's discZoom); center is [lon, lat]. */
export interface ShareCamera {
  /** null: the untouched home view, so each visitor gets their own. */
  zoom: number | null;
  center: [number, number] | null;
  lock: boolean;
}

export interface PendingCamera extends ShareCamera {
  view: string;
  /** When the link was read: a camera not applied soon after is dropped. */
  at: number;
}

let reader: (() => ShareCamera | null) | null = null;
let pending: PendingCamera | null = null;

export function registerCameraReader(fn: () => ShareCamera | null): () => void {
  reader = fn;
  return () => {
    if (reader === fn) reader = null;
  };
}

export function currentCamera(): ShareCamera | null {
  return reader?.() ?? null;
}

export function setPendingCamera(cam: PendingCamera | null): void {
  pending = cam;
}

export function peekPendingCamera(): PendingCamera | null {
  return pending;
}
