"use client";

import { useEffect, useRef, useState } from "react";
import { useCesiumViewer } from "@/lib/use-cesium-viewer";
import { CesiumViewerProvider } from "@/lib/cesium-viewer-context";
import { useBodyClass } from "@/lib/use-body-class";
import { useTriangulateAttempts } from "@/lib/use-triangulate-attempts";
import AttemptPicker from "@/components/triangulate/AttemptPicker";
import FromObserverButtons from "@/components/triangulate/FromObserverButtons";
import ImageryPicker from "@/components/triangulate/ImageryPicker";
import ObservationsPanel from "@/components/triangulate/ObservationsPanel";
import ResultPanel from "@/components/triangulate/ResultPanel";
import TlePanel from "@/components/triangulate/TlePanel";

// Composition root for the triangulate page. Three hooks own the
// lifecycle:
//   - useCesiumViewer:        creates / destroys the viewer instance
//   - useTriangulateAttempts: loads manifest + initial attempt
//   - initTriangulateScene:   wires the imperative Cesium island
//                             (entity reconciliation + camera +
//                             persistence) once viewer + attempts
//                             are both ready
// Everything else is React-rendered, store-driven panels.
export default function TriangulateApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewer, status } = useCesiumViewer(containerRef, { imagery: false });
  const { ready: attemptsReady } = useTriangulateAttempts();
  const [sceneReady, setSceneReady] = useState(false);
  // Panel-collapse is local state - nothing else (scene, sibling
  // pages) needs to read or set it, so the triangulate store doesn't
  // get a slice for it. body.panel-collapsed drives the CSS slide-out
  // (globals.css + the scene's camera viewport-inset calc).
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  useBodyClass("panel-collapsed", panelCollapsed);

  useEffect(() => {
    if (!viewer || !attemptsReady) return;
    let teardown: (() => void) | undefined;
    // Dynamic import (not static): the scene module + its transitive
    // deps capture window.Cesium at module-evaluation time. With a
    // static import the module would evaluate at page load - before
    // Cesium has finished downloading - and freeze in an undefined
    // Cesium. The dynamic import defers evaluation until
    // useCesiumViewer has confirmed Cesium is ready.
    (async () => {
      try {
        const mod = await import("@/lib/triangulate-scene.js");
        teardown = mod.initTriangulateScene(viewer);
        setSceneReady(true);
      } catch (err) {
        console.error("Scene init failed:", err);
      }
    })();
    return () => {
      if (teardown) {
        try { teardown(); } catch { /* ignore */ }
      }
      setSceneReady(false);
    };
  }, [viewer, attemptsReady]);

  const showOverlay = status !== "ready" || !attemptsReady || !sceneReady;
  const overlayLabel = status === "error"
    ? "Cesium failed to load. Check the console."
    : !attemptsReady
    ? "Loading attempts…"
    : "Loading Cesium…";

  return (
    <CesiumViewerProvider viewer={viewer} status={status}>
      <div ref={containerRef} id="cesium-container" />

      <button
        id="panel-toggle"
        type="button"
        aria-label="Toggle side panel"
        onClick={() => setPanelCollapsed((p) => !p)}
      />

      <section id="panel-observations" className="panel panel-left">
        <AttemptPicker />

        <details id="result-section" open>
          <summary><h2>Result</h2></summary>
          <ResultPanel />
        </details>

        <details id="obs-details" open>
          <summary><h2>Observations</h2></summary>
          <ObservationsPanel />
        </details>

        <details id="tle-section" open>
          <summary><h2>TLE</h2></summary>
          <TlePanel />
        </details>

        <p className="footnote">
          Edits auto-save to this browser. Built-in attempts overlay a local override on top of <code>data/</code>;
          user-created (<code>+</code>) attempts are pure-local. Click <code>⬇</code> to export the current state
          as a JSON file.
        </p>
      </section>

      <nav id="camera-controls">
        <ImageryPicker />
        <button data-cam="frame">Frame all</button>
        <FromObserverButtons />
        <button data-cam="top">Top down</button>
        <button data-cam="anchor" title="Anchor camera to triangulated point; mouse drag orbits, wheel zooms">
          Anchor
        </button>
      </nav>

      <div id="sim-time">-</div>

      {showOverlay && (
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
            pointerEvents: status === "error" ? "auto" : "none",
            opacity: 0.85,
            zIndex: 1000,
          }}
        >
          {overlayLabel}
        </div>
      )}
    </CesiumViewerProvider>
  );
}
