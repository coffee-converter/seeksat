"use client";

import { useEffect, useRef, useState } from "react";

// Minimum-viable port: a single client component that mounts a Cesium
// Viewer into a ref and waits for window.Cesium to be available
// (loaded async via the <Script> tag in app/layout.tsx). Proves the
// Cesium-in-Next.js plumbing works end-to-end before we port the
// imperative observation-list / TLE-fetch / triangulation logic from
// legacy/app.js into proper React components.
export default function TriangulateApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">(
    "waiting",
  );

  useEffect(() => {
    let cancelled = false;
    // Poll until the CDN <Script> tag has injected window.Cesium.
    // afterInteractive guarantees it lands shortly after first render;
    // 100ms intervals are imperceptible and the loop self-terminates
    // as soon as the global appears or after a 10 s safety cap.
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (typeof window.Cesium !== "undefined" && containerRef.current) {
        window.clearInterval(interval);
        try {
          const C = window.Cesium;
          const viewer = new C.Viewer(containerRef.current, {
            baseLayer: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            animation: false,
            timeline: false,
            fullscreenButton: false,
            infoBox: false,
            selectionIndicator: false,
            shouldAnimate: false,
          });
          viewer.scene.skyAtmosphere.show = true;
          viewer.scene.globe.enableLighting = true;
          viewer.scene.backgroundColor = C.Color.fromCssColorString("#0a0e1a");
          viewer.cesiumWidget.creditContainer.style.display = "none";
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
      <div
        ref={containerRef}
        id="cesium-container"
        style={{ width: "100vw", height: "100vh" }}
      />
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
