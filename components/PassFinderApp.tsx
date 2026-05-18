"use client";

import { useEffect, useRef } from "react";
import { useCesiumViewer } from "@/lib/use-cesium-viewer";
import ModeToggle from "@/components/passes/ModeToggle";
import MinElevControl from "@/components/passes/MinElevControl";
import TlePanel from "@/components/passes/TlePanel";
import PlaybackControls from "@/components/passes/PlaybackControls";

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

  useEffect(() => {
    if (!viewer) return;
    let teardown: (() => void) | undefined;
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
    <>
      <div id="page-loader">
        <img className="loader-img" src="/assets/loader.gif" alt="" />
        <span className="loader-label">Loading pass finder…</span>
      </div>

      <div ref={containerRef} id="cesium-container" />

      <div id="observer-icons" />

      <button id="panel-toggle" type="button" aria-label="Toggle side panel" />

      <section id="panel-left" className="panel">
        <div id="windows-section">
          <div className="section-heading-row">
            <h2 className="section-heading">Passes</h2>
            <div className="passes-controls">
              <ModeToggle />
              <MinElevControl />
            </div>
            <button id="share-btn" type="button" title="Copy a link to this observer setup" aria-label="Copy link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 17H7a5 5 0 0 1 0-10h2" />
                <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
          </div>
          <div id="windows-list" className="result-block">
            <div className="window-empty">loading…</div>
          </div>
        </div>

        <details id="observers-details">
          <summary><h2>Observers</h2></summary>
          <div id="obs-list" />
          <div className="add-row">
            <input
              id="add-latlon"
              type="text"
              placeholder={`lat, lon (e.g. 42°09'15.9"N, 88°11'59.9"W)`}
            />
            <button id="add-latlon-btn" type="button">Add</button>
          </div>
          <div className="add-row">
            <input id="add-geocode" type="text" placeholder="place name (e.g. Brookfield, WI)" />
            <button id="add-geocode-btn" type="button">Geocode</button>
          </div>
          <button id="click-place-toggle" type="button" className="toggle">
            Click on globe to place
          </button>
        </details>

        <details id="tle-details">
          <summary><h2>TLE</h2></summary>
          <TlePanel />
        </details>
      </section>

      <nav id="bottom-controls">
        <PlaybackControls viewer={viewer} />
        <div id="sim-time">—</div>
        <div id="camera-controls" className="ctl-group">
          <button data-cam="frame" title="Frame all observers">Frame</button>
          <button data-cam="top" title="Top-down view">Top</button>
          <button data-cam="orbit" title="Lock camera to observers' centroid; mouse drag orbits, wheel zooms">Orbit</button>
          <button data-cam="rotate" title="Auto-rotate camera">Rotate</button>
        </div>
      </nav>

      <div id="polar-modal" hidden>
        <div className="polar-modal-backdrop" />
        <div className="polar-modal-content">
          <div className="polar-modal-actions">
            <button className="polar-modal-close" type="button" aria-label="Close">✕</button>
            <button className="polar-modal-copy" type="button" title="Copy image to clipboard">Copy</button>
            <button className="polar-modal-save" type="button" title="Download as PNG">Save PNG</button>
          </div>
          <svg className="polar-modal-svg" viewBox="-24 -68 248 278" aria-hidden="true" />
          <a className="polar-modal-png-link" download="iss-pass.png" href="#">
            <img className="polar-modal-png" alt="ISS pass sky chart" />
          </a>
          <p className="polar-modal-hint">Right-click the image to save · click outside or press Esc to close.</p>
        </div>
      </div>

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
    </>
  );
}
