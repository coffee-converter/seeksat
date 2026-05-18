// Ambient declaration for the Cesium global. We load Cesium from CDN
// rather than the npm package (see next.config.ts) so TS doesn't know
// about it otherwise. Typed as `any` for now — refine to real types
// later by installing `cesium` as a devDependency just for its .d.ts.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Cesium: any;
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Cesium: any;
  }
}
export {};
