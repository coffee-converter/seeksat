// lib/scene-bridge.ts — typed boundary between the imperative scene
// island (lib/pass-finder-scene.js) and the React components.
//
// Why a registry instead of `window.__passes*` properties:
//   - Single typed surface — components import wrapper functions
//     instead of fishing functions off `window` with `as any` casts.
//   - One registration call in scene init; one clear on teardown.
//     No proliferation of `window.foo = bar` / `delete window.foo`.
//   - Tests can call setSceneBridge with a mock object directly.
//
// The registry deliberately lives on `globalThis` (not module state)
// so React's dynamic-import boundary doesn't end up with one copy
// in the chunk that holds the components and a separate copy in the
// chunk that holds the scene — there'd be no shared module state to
// register against, and components would always see an empty bridge.

export interface PolarModalRenderResult {
  blobUrl: string;
  filename: string;
}

export interface SceneBridge {
  /** Paint the dynamic groups of a per-observer card's polar-plot SVG
   *  (sun/moon, ISS arc, start/peak/end markers, current ISS dot).
   *  React owns the static skeleton; this fills the empty groups. */
  paintPolarPlot: (svgEl: SVGSVGElement, obsId: string) => void;
  /** Paint the fullscreen polar modal SVG and return a PNG blob URL
   *  + suggested filename. Resolves only after the bitmap fully
   *  decodes, so the caller can wait before unhiding the modal. */
  renderPolarModal: (
    svgEl: SVGSVGElement,
    obsId: string,
  ) => Promise<PolarModalRenderResult | null>;
  /** Rasterize the modal SVG to a PNG Blob and write it to the
   *  system clipboard. Throws if the Clipboard API is unavailable
   *  or the user denies permission. */
  copyPolarPng: (svgEl: SVGSVGElement) => Promise<void>;
  /** Build a shareable URL encoding the current observer set + the
   *  currently-active pass window's start time, if any. */
  buildShareUrl: () => string;
}

// Augment the global Window so the JS scene file can assign to
// `window.__sceneBridge` without `as any`. We only declare the
// property as optional + readonly; mutation happens through the
// setSceneBridge helper below.
declare global {
  // eslint-disable-next-line no-var
  var __sceneBridge: SceneBridge | undefined;
}

// Scene init calls this with a fully-populated bridge; teardown
// calls clearSceneBridge. Either call replaces the prior bridge in
// one assignment — no partial updates.
export function setSceneBridge(bridge: SceneBridge): void {
  globalThis.__sceneBridge = bridge;
}

export function clearSceneBridge(): void {
  globalThis.__sceneBridge = undefined;
}

// Wrappers consumed by React components. Each one throws a clear
// error when the scene isn't initialized yet — better than silently
// no-op'ing, which historically masked bugs (e.g. the polar modal
// silently failing because the scene's import order was wrong).
function bridge(): SceneBridge {
  const b = globalThis.__sceneBridge;
  if (!b) {
    throw new Error(
      "Scene bridge not initialized — the pass-finder scene module " +
      "must call setSceneBridge before any component invokes a bridge fn.",
    );
  }
  return b;
}

export const paintPolarPlot: SceneBridge["paintPolarPlot"] = (svg, obsId) =>
  bridge().paintPolarPlot(svg, obsId);

export const renderPolarModal: SceneBridge["renderPolarModal"] = (svg, obsId) =>
  bridge().renderPolarModal(svg, obsId);

export const copyPolarPng: SceneBridge["copyPolarPng"] = (svg) =>
  bridge().copyPolarPng(svg);

export const buildShareUrl: SceneBridge["buildShareUrl"] = () =>
  bridge().buildShareUrl();

/** True when the scene has registered its bridge. Components can
 *  check this before calling a wrapper if they need to render a
 *  placeholder during the brief window between mount and scene
 *  init. (None do currently — the scene init useEffect runs before
 *  any user interaction can reach the bridge consumers.) */
export function isSceneBridgeReady(): boolean {
  return globalThis.__sceneBridge !== undefined;
}
