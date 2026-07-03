"use client";

import { useEffect, useRef } from "react";
import { useCesiumViewer } from "@/lib/use-cesium-viewer";
import { CesiumViewerProvider } from "@/lib/cesium-viewer-context";
import { useBodyClass } from "@/lib/use-body-class";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import type { Tle } from "@/lib/types";
import PageLoader from "@/components/passes/PageLoader";
import ClockSkewBanner from "@/components/passes/ClockSkewBanner";
import ModeToggle from "@/components/passes/ModeToggle";
import MinElevControl from "@/components/passes/MinElevControl";
import SatellitePanel from "@/components/passes/SatellitePanel";
import PlaybackControls from "@/components/passes/PlaybackControls";
import AddObserverForm from "@/components/passes/AddObserverForm";
import ObserversList from "@/components/passes/ObserversList";
import WindowsList from "@/components/passes/WindowsList";
import ShareButton from "@/components/passes/ShareButton";
import PolarModal from "@/components/passes/PolarModal";
import AboutPane from "@/components/AboutPane";
import OnboardingTour from "@/components/OnboardingTour";

// Pass-finder composition root. Same shape as TriangulateApp but the
// scene island inside is much bigger (~4.7k lines of imperative
// Cesium / observer / windows-list code, still wrap-and-mounted into
// the JSX skeleton below). A panel-by-panel React refactor -
// matching what we did for triangulate - can follow this file as
// the template; the foundation (viewer hook, scene init, JSX
// skeleton) is in place.
export default function PassFinderApp(
  { initialSatelliteTles }: { initialSatelliteTles?: Record<number, Tle> },
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  // Server-seed the per-satellite TLE map once on mount, then select the
  // default satellite (ISS) so the scene paints immediately. No-op when
  // the map is empty (e.g. Edge Config unset) - selection still sets the
  // default id and the client fetch fills the TLE in.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const store = usePassFinderStore.getState();
    if (initialSatelliteTles && Object.keys(initialSatelliteTles).length) {
      store.setSatelliteTles(initialSatelliteTles);
    }
    store.setSelectedSatellite(25544);
    if (initialSatelliteTles?.[25544]) store.setTleStatus("ready");
  }, [initialSatelliteTles]);

  const { viewer, status } = useCesiumViewer(containerRef);
  const panelCollapsed = usePassFinderStore((s) => s.panelCollapsed);
  const setPanelCollapsed = usePassFinderStore((s) => s.setPanelCollapsed);
  const firstSearchComplete = usePassFinderStore((s) => s.firstSearchComplete);
  const observerCount = usePassFinderStore((s) => s.observers.length);

  // CSS hook: body.panel-collapsed slides the side panel off and
  // flips the toggle chevron (pass-finder.css + globals.css).
  useBodyClass("panel-collapsed", panelCollapsed);

  useEffect(() => {
    if (!viewer) return;
    let teardown: (() => void) | undefined;
    // Dynamic import (not static) because the scene module + its
    // transitive deps capture window.Cesium at module-evaluation time.
    // With a static import the module would evaluate at page load -
    // before Cesium has finished downloading - and freeze in an
    // undefined Cesium. The dynamic import defers evaluation until
    // useCesiumViewer has confirmed Cesium is ready.
    (async () => {
      try {
        const mod = await import("@/lib/pass-finder-scene.js");
        teardown = mod.initPassFinderScene(viewer);
      } catch (err) {
        console.error("Pass-finder scene init failed:", err);
      }
    })();
    return () => {
      if (teardown) {
        try { teardown(); } catch { /* ignore */ }
      }
    };
  }, [viewer]);


  return (
    <CesiumViewerProvider viewer={viewer} status={status}>
      <PageLoader done={firstSearchComplete} />

      <div ref={containerRef} id="cesium-container" />

      {/* Inconspicuous brand mark, top-right corner of the scene. Mirrors
          the side panel diagonally; pointer-events:none so it never
          intercepts globe drag/zoom. Decorative - hidden from a11y tree. */}
      <div className="brand-mark" aria-hidden="true">
        <span className="seek">Seek</span><span className="sat">Sat</span>
      </div>
      {/* Subtle attribution tucked under the brand mark. Unlike the
          decorative wordmark this is a real link, so it stays in the a11y
          tree and takes pointer events (only the link itself, not a bar). */}
      <a
        className="brand-credit"
        href="https://aaronhanson.dev"
        target="_blank"
        rel="noopener"
      >
        built by Aaron Hanson
      </a>
      <AboutPane />
      <OnboardingTour />

      <div id="observer-icons" />

      <button
        id="panel-toggle"
        type="button"
        aria-label="Toggle side panel"
        onClick={() => setPanelCollapsed(!panelCollapsed)}
      />

      <section id="panel-left" className="panel">
        <ClockSkewBanner />
        <div id="windows-section">
          <div className="section-heading-row">
            <h2 className="section-heading">Passes</h2>
            <div className="passes-controls">
              <ModeToggle />
              <MinElevControl />
            </div>
            <ShareButton />
          </div>
          <WindowsList />
        </div>

        <details id="observers-details" open>
          <summary><h2>Observers ({observerCount})</h2></summary>
          <ObserversList />
          <AddObserverForm />
        </details>

        <details id="satellite-details" open>
          <summary><h2>Satellite</h2></summary>
          <SatellitePanel />
        </details>
      </section>

      <nav id="bottom-controls">
        <PlaybackControls />
        <div id="sim-time">-</div>
        <div id="camera-controls" className="ctl-group">
          <button data-cam="frame" title="Frame all observers">Frame</button>
          <button data-cam="top" title="Top-down view">Top</button>
          <button data-cam="anchor" title="Anchor camera to observers' centroid; mouse drag orbits, wheel zooms">Anchor</button>
        </div>
      </nav>

      <PolarModal />

      {status === "error" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "#0a0e1a",
            color: "#cfe0ff",
            font: "12px / 1.4 -apple-system, BlinkMacSystemFont, sans-serif",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            zIndex: 1000,
          }}
        >
          Cesium failed to load - check the console.
        </div>
      )}
    </CesiumViewerProvider>
  );
}
