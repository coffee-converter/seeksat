// Ambient declaration for the Cesium global. We load Cesium from
// CDN rather than the npm package (see next.config.ts) so TS doesn't
// know about it otherwise. Typed as `any` for now — refine by
// installing `cesium` as a devDependency just for its .d.ts later.
//
// Centralizing the `any` here lets call sites write `window.Cesium`
// directly without per-site `(window as any).Cesium` casts and the
// eslint-disable comments that come with them.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Cesium: any;
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Cesium: any;
  }
}

/** Loose alias for a Cesium.Viewer instance. Anywhere in the app that
 *  receives or stores a viewer reference imports this; lets us swap in
 *  real types if/when @types/cesium becomes available. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CesiumViewer = any;
