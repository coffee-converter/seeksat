"use client";

import { useEffect, useRef, useState } from "react";

// Wrap-and-mount port of the pass-finder page. Mirrors legacy/passes.html
// 1:1 so the imperative bootstrap in lib/pass-finder-bootstrap can query
// every element it expects. React renders the skeleton once, then yields
// the DOM to the bootstrap (same pattern as TriangulateApp).
export default function PassFinderApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">(
    "waiting",
  );

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (typeof window.Cesium !== "undefined" && containerRef.current) {
        window.clearInterval(interval);
        (async () => {
          try {
            const mod = await import("@/lib/pass-finder-bootstrap.js");
            if (cancelled) return;
            teardown = await mod.initPassFinder(containerRef.current!);
            setStatus("ready");
          } catch (err) {
            console.error("Pass-finder init failed:", err);
            setStatus("error");
          }
        })();
        return;
      }
      if (Date.now() - start > 10_000) {
        window.clearInterval(interval);
        setStatus("error");
      }
    }, 100);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (teardown) {
        try { teardown(); } catch { /* ignore */ }
      }
    };
  }, []);

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
              <div id="mode-toggle" className="mode-toggle" role="group" aria-label="Pass mode">
                <button type="button" data-mode="visual" className="active">Visual</button>
                <button type="button" data-mode="radio">Radio</button>
              </div>
              <div id="min-elev-control" className="min-elev" hidden title="Minimum elevation every observer must clear">
                <button type="button" className="min-elev-step" data-step="-1" aria-label="Decrease minimum elevation">−</button>
                <span id="min-elev-value" className="min-elev-value">10°</span>
                <button type="button" className="min-elev-step" data-step="1" aria-label="Increase minimum elevation">+</button>
              </div>
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
              placeholder={`lat, lon (e.g. 40°30'30.0"N, 75°15'45.0"W)`}
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
          <div id="tle-status" className="hint">fetching…</div>
          <textarea id="tle-name" placeholder="ISS (ZARYA)" defaultValue="" />
          <textarea id="tle-l1" placeholder="1 25544U ..." defaultValue="" />
          <textarea id="tle-l2" placeholder="2 25544 ..." defaultValue="" />
          <button id="tle-refetch" type="button">Refetch from Celestrak</button>
        </details>
      </section>

      <nav id="bottom-controls">
        <div className="ctl-group playback">
          <button id="play-btn"  type="button" title="Play">▶</button>
          <button id="pause-btn" type="button" title="Pause">⏸</button>
          <button id="reset-btn" type="button" title="Reset to now">⏮</button>
        </div>
        <label className="speed-label">
          Speed
          <select id="speed-select" defaultValue="10">
            <option value="1">×1</option>
            <option value="10">×10</option>
            <option value="60">×60</option>
            <option value="600">×600</option>
            <option value="1000">×1000</option>
            <option value="4000">×4000</option>
            <option value="10000">×10000</option>
            <option value="30000">×30000</option>
          </select>
        </label>
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
          Initialization failed — check the console.
        </div>
      )}
    </>
  );
}
