"use client";

import { useEffect, useRef, useState } from "react";
import { makeViewer, wireSimTime } from "@/lib/cesium-viewer";
import TlePanel from "@/components/TlePanel";

// Triangulate page shell. The Cesium viewer mounts into a ref inside
// useEffect once window.Cesium loads from the CDN <Script> in the
// root layout. The left side-panel holds the React-ified panels
// (currently just TLE; observation list / attempts / results land in
// follow-up commits). All other DOM is structural so the legacy
// style.css selectors keep working unchanged.
export default function TriangulateApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">(
    "waiting",
  );

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (typeof window.Cesium !== "undefined" && containerRef.current) {
        window.clearInterval(interval);
        try {
          const viewer = makeViewer(containerRef.current);
          wireSimTime(viewer);
          viewerRef.current = viewer;
          setStatus("ready");
        } catch (err) {
          console.error("Cesium init failed:", err);
          setStatus("error");
        }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = viewerRef.current as any;
      if (v && typeof v.destroy === "function") v.destroy();
      viewerRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={containerRef} id="cesium-container" />

      <button id="panel-toggle" type="button" aria-label="Toggle side panel" />

      <section id="panel-observations" className="panel panel-left">
        <TlePanel />
        <p className="footnote">
          React port in progress — observation list, attempts, and results
          panels not yet ported. See <code>legacy/app.js</code> for the
          full feature set.
        </p>
      </section>

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
          }}
        >
          {status === "waiting" && "Loading Cesium…"}
          {status === "error" && "Cesium failed to load. Check the console."}
        </div>
      )}
    </>
  );
}
