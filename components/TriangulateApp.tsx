"use client";

import { useEffect, useRef, useState } from "react";
import ResultPanel from "@/components/triangulate/ResultPanel";
import TlePanel from "@/components/triangulate/TlePanel";

// Wrap-and-mount port of the original ISS triangulation page. The JSX
// below mirrors legacy/index.html exactly (same IDs, same structure,
// same nesting) so the imperative bootstrap in lib/triangulate-bootstrap
// can query/mutate every element it expects to find. React owns nothing
// inside the panel — it just renders the skeleton once, then yields the
// DOM to the bootstrap. State, persistence, event wiring, Cesium scene
// updates, and camera presets all live in the bootstrap.
//
// A future pass can chip individual panels out into idiomatic React
// components (see TlePanel.tsx for an example) — but the first goal is
// feature-parity with the legacy bundle.
export default function TriangulateApp() {
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
            // Dynamic import so module-eval doesn't race the Cesium
            // global. The bootstrap reads window.Cesium at module load.
            const mod = await import("@/lib/triangulate-bootstrap.js");
            if (cancelled) return;
            teardown = await mod.initTriangulate(containerRef.current!);
            setStatus("ready");
          } catch (err) {
            console.error("Triangulate init failed:", err);
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
      <div ref={containerRef} id="cesium-container" />

      <button id="panel-toggle" type="button" aria-label="Toggle side panel" />

      <section id="panel-observations" className="panel panel-left">
        <div id="attempt-picker">
          <label htmlFor="attempt-select">Attempt</label>
          <select id="attempt-select" title="Switch between triangulation attempts" defaultValue="" />
          <button id="attempt-new" type="button" title="Create a new attempt">+</button>
          <button id="attempt-download" type="button" hidden title="Download JSON for this attempt">⬇</button>
          <button id="attempt-delete" type="button" hidden title="Delete this attempt (browser-local only)">✕</button>
        </div>

        <form id="attempt-new-form" hidden>
          <label className="af-row">
            <span>Label</span>
            <input type="text" id="af-label" placeholder="e.g. Wednesday evening" required />
          </label>
          <label className="af-row">
            <span>UTC</span>
            <input type="text" id="af-utc" placeholder="2026-05-16T22:35:00Z" required />
          </label>
          <label className="af-row af-check">
            <input type="checkbox" id="af-copy" />
            <span>Copy current observations</span>
          </label>
          <div className="af-actions">
            <button type="button" id="af-cancel">Cancel</button>
            <button type="submit" id="af-create">Create</button>
          </div>
        </form>

        <details id="result-section" open>
          <summary><h2>Result</h2></summary>
          <ResultPanel />
        </details>

        <details id="obs-details" open>
          <summary><h2>Observations</h2></summary>
          <div className="timestamp-row">
            <label>UTC <input id="ts-utc" type="text" defaultValue="" /></label>
            <span id="ts-local" className="hint" />
          </div>
          <label className="opt-row">
            <input type="checkbox" id="opt-refraction" defaultChecked />
            <span>Correct for atmospheric refraction</span>
            <span className="hint">(Bennett 1982)</span>
          </label>
          <div id="obs-list" />
          <button id="add-obs" type="button">+ Add observation</button>
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
        <div id="imagery-picker">
          <span className="picker-label">Globe</span>
          <select id="imagery-select" defaultValue="" />
        </div>
        <button data-cam="frame">Frame all</button>
        <span id="from-observer-slot" />
        <button data-cam="top">Top down</button>
        <button data-cam="orbit" title="Lock camera to triangulated point; mouse drag orbits, wheel zooms">
          Orbit point
        </button>
        <button data-cam="rotate">Auto-rotate</button>
      </nav>

      <div id="sim-time">—</div>

      {status !== "ready" && (
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
          {status === "waiting" && "Loading Cesium…"}
          {status === "error" && "Initialization failed — check the console."}
        </div>
      )}
    </>
  );
}
