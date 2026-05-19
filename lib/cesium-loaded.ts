// lib/cesium-loaded.ts — single source of truth for "has the Cesium
// CDN script finished loading?"
//
// Replaces the prior 100ms-polling-with-10s-timeout pattern in
// useCesiumViewer. Layout renders a CesiumLoader client component
// whose <Script onReady> callback calls markCesiumLoaded(); the
// useCesiumViewer hook awaits cesiumReady() instead of polling.
//
// Module-level state means a single promise services every consumer
// across the whole app, regardless of which page rendered first.

export type CesiumLoadStatus = "waiting" | "ready" | "error";

let status: CesiumLoadStatus = "waiting";
let resolveReady: (() => void) | undefined;
let rejectReady: ((err: Error) => void) | undefined;
const readyPromise = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

export function markCesiumLoaded(): void {
  if (status !== "waiting") return;
  status = "ready";
  resolveReady?.();
}

export function markCesiumError(): void {
  if (status !== "waiting") return;
  status = "error";
  rejectReady?.(new Error("Cesium script failed to load"));
}

/** Promise that resolves once window.Cesium is available. If the
 *  global is already defined (e.g. the consumer mounts AFTER the
 *  <Script onReady> callback fires, or after hot-reload), resolves
 *  synchronously. Rejects if the script tag reported a load error. */
export function cesiumReady(): Promise<void> {
  if (status === "ready") return Promise.resolve();
  if (status === "error") {
    return Promise.reject(new Error("Cesium script failed to load"));
  }
  // Defensive: if the global appeared without our onReady callback
  // firing (e.g. someone preloaded it differently), trust the global.
  if (typeof window !== "undefined" && window.Cesium) {
    markCesiumLoaded();
    return Promise.resolve();
  }
  return readyPromise;
}

export function cesiumStatus(): CesiumLoadStatus {
  return status;
}
