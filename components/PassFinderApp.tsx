"use client";

import { useEffect, useRef } from "react";
import { useCesiumViewer } from "@/lib/use-cesium-viewer";
import { CesiumViewerProvider } from "@/lib/cesium-viewer-context";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import ModeToggle from "@/components/passes/ModeToggle";
import MinElevControl from "@/components/passes/MinElevControl";
import TlePanel from "@/components/passes/TlePanel";
import PlaybackControls from "@/components/passes/PlaybackControls";
import AddObserverForm from "@/components/passes/AddObserverForm";
import ObserversList from "@/components/passes/ObserversList";
import WindowsList from "@/components/passes/WindowsList";
import ShareButton from "@/components/passes/ShareButton";
import PolarModal from "@/components/passes/PolarModal";

// Pass-finder composition root. Same shape as TriangulateApp but the
// scene island inside is much bigger (~4.7k lines of imperative
// Cesium / observer / windows-list code, still wrap-and-mounted into
// the JSX skeleton below). A panel-by-panel React refactor —
// matching what we did for triangulate — can follow this file as
// the template; the foundation (viewer hook, scene init, JSX
// skeleton) is in place.
export default function PassFinderApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewer, status } = useCesiumViewer(containerRef);
  const activeWindowIdx = usePassFinderStore((s) => s.activeWindowIdx);
  const panelCollapsed = usePassFinderStore((s) => s.panelCollapsed);
  const setPanelCollapsed = usePassFinderStore((s) => s.setPanelCollapsed);
  const firstSearchComplete = usePassFinderStore((s) => s.firstSearchComplete);

  useEffect(() => {
    if (!viewer) return;
    let teardown: (() => void) | undefined;
    // Dynamic import (not static) because the scene module + its
    // transitive deps capture window.Cesium at module-evaluation time.
    // With a static import the module would evaluate at page load —
    // before Cesium has finished downloading — and freeze in an
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

  // Mirror store-driven UI flags onto body classes — the panel
  // slide-out + the "pass-selected" styling read these in CSS.
  useEffect(() => {
    document.body.classList.toggle("panel-collapsed", panelCollapsed);
    return () => document.body.classList.remove("panel-collapsed");
  }, [panelCollapsed]);

  useEffect(() => {
    document.body.classList.toggle("has-active-pass", activeWindowIdx >= 0);
    return () => document.body.classList.remove("has-active-pass");
  }, [activeWindowIdx]);

  return (
    <CesiumViewerProvider viewer={viewer} status={status}>
      <div id="page-loader" className={firstSearchComplete ? "hidden" : ""}>
        <img className="loader-img" src="/assets/loader.gif" alt="" />
        <span className="loader-label">Loading pass finder…</span>
      </div>

      <div ref={containerRef} id="cesium-container" />

      <div id="observer-icons" />

      <button
        id="panel-toggle"
        type="button"
        aria-label="Toggle side panel"
        onClick={() => setPanelCollapsed(!panelCollapsed)}
      />

      <section id="panel-left" className="panel">
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

        <details id="observers-details">
          <summary><h2>Observers</h2></summary>
          <ObserversList />
          <AddObserverForm />
        </details>

        <details id="tle-details">
          <summary><h2>TLE</h2></summary>
          <TlePanel />
        </details>
      </section>

      <nav id="bottom-controls">
        <PlaybackControls />
        <div id="sim-time">—</div>
        <div id="camera-controls" className="ctl-group">
          <button data-cam="frame" title="Frame all observers">Frame</button>
          <button data-cam="top" title="Top-down view">Top</button>
          <button data-cam="orbit" title="Lock camera to observers' centroid; mouse drag orbits, wheel zooms">Orbit</button>
          <button data-cam="rotate" title="Auto-rotate camera">Rotate</button>
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
          Cesium failed to load — check the console.
        </div>
      )}
    </CesiumViewerProvider>
  );
}
